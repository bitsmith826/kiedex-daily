import { CONFIG } from './config.js';
import { ensureValidToken } from './auth.js';

/**
 * Utilitas timestamp lokal format YYYY-MM-DD HH:mm:ss
 */
function getTimestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const year = now.getFullYear();
  const month = pad(now.getMonth() + 1);
  const day = pad(now.getDate());
  const hours = pad(now.getHours());
  const minutes = pad(now.getMinutes());
  const seconds = pad(now.getSeconds());
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * Logger konsol rapi
 */
const logger = {
  info: (msg) => console.log(`\x1b[90m[${getTimestamp()}]\x1b[0m \x1b[36m[INFO]\x1b[0m ${msg}`),
  success: (msg) => console.log(`\x1b[90m[${getTimestamp()}]\x1b[0m \x1b[32m[SUCCESS]\x1b[0m ${msg}`),
  warn: (msg) => console.log(`\x1b[90m[${getTimestamp()}]\x1b[0m \x1b[33m[WARN]\x1b[0m ${msg}`),
  error: (msg) => console.log(`\x1b[90m[${getTimestamp()}]\x1b[0m \x1b[31m[ERROR]\x1b[0m ${msg}`),
  step: (title) => console.log(`\n\x1b[90m[${getTimestamp()}]\x1b[0m \x1b[1m\x1b[35m=== ${title} ===\x1b[0m`)
};

/**
 * Helper jeda waktu dalam milidetik
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Parsing argumen CLI (e.g. node spot_trader.js --cycles=3 --amount=15 --pair=BTCUSDT)
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const params = {
    pair: 'BTCUSDT',
    amount: 10,       // Nominal USDT per order beli
    cycles: 1,        // Jumlah siklus beli -> jual
    holdDelay: 4,     // Waktu tahan posisi sebelum jual (detik)
    cycleDelay: 3,    // Jeda antar siklus (detik)
    sellAllOnly: false // Jika true, hanya menjual sisa aset yang dimiliki
  };

  for (const arg of args) {
    if (arg.startsWith('--pair=')) params.pair = arg.split('=')[1].toUpperCase();
    if (arg.startsWith('--amount=')) params.amount = parseFloat(arg.split('=')[1]);
    if (arg.startsWith('--cycles=')) params.cycles = parseInt(arg.split('=')[1], 10);
    if (arg.startsWith('--hold=')) params.holdDelay = parseFloat(arg.split('=')[1]);
    if (arg.startsWith('--delay=')) params.cycleDelay = parseFloat(arg.split('=')[1]);
    if (arg === '--sell-all') params.sellAllOnly = true;
  }

  return params;
}

/**
 * Ambil harga real-time terkini dari feed Binance
 */
async function getLivePrice(symbol = 'BTCUSDT') {
  try {
    const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return parseFloat(data.price);
  } catch (error) {
    logger.warn(`Gagal fetch harga dari Binance (${error.message}), mencoba fallback...`);
    return 80700.00;
  }
}

/**
 * Request wrapper ke Supabase
 */
async function apiRequest(endpoint, options = {}) {
  const url = `${CONFIG.BASE_URL}${endpoint}`;
  const method = options.method || 'GET';

  const fetchOptions = {
    method,
    headers: {
      ...CONFIG.getHeaders(),
      ...(options.headers || {})
    }
  };

  if (options.body) {
    fetchOptions.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
  }

  const response = await fetch(url, fetchOptions);
  const contentType = response.headers.get('content-type') || '';
  let responseData;

  if (contentType.includes('application/json')) {
    responseData = await response.json().catch(() => null);
  } else {
    responseData = await response.text().catch(() => '');
  }

  return {
    ok: response.ok,
    status: response.status,
    data: responseData
  };
}

/**
 * Mengambil saldo USDT saat ini
 */
async function getUsdtBalance() {
  const endpoint = `/rest/v1/balances?select=spot_usdt_balance,demo_usdt_balance,oil_balance&user_id=eq.${CONFIG.USER_ID}`;
  const res = await apiRequest(endpoint);
  if (res.ok && Array.isArray(res.data) && res.data.length > 0) {
    return {
      spotUsdt: res.data[0].spot_usdt_balance ?? 0,
      demoUsdt: res.data[0].demo_usdt_balance ?? 0,
      oil: res.data[0].oil_balance ?? 0
    };
  }
  return null;
}

/**
 * Mengambil holding aset saat ini (misal BTC)
 */
async function getAssetHolding(symbol = 'BTCUSDT') {
  const endpoint = `/rest/v1/spot_holdings?user_id=eq.${CONFIG.USER_ID}&symbol=eq.${symbol}&select=*`;
  const res = await apiRequest(endpoint);
  if (res.ok && Array.isArray(res.data) && res.data.length > 0) {
    return res.data[0];
  }
  return null;
}

/**
 * Eksekusi Atomic Spot Trade (Buy / Sell)
 */
async function executeSpotTrade(symbol, side, quantity, price, skipOilDeduct = false) {
  // Format desimal presisi (8 digit untuk quantity BTC)
  const formattedQuantity = parseFloat(quantity.toFixed(8));
  const formattedPrice = parseFloat(price.toFixed(2));

  logger.info(`Mengirim order ${side.toUpperCase()}: ${formattedQuantity} ${symbol} @ $${formattedPrice.toLocaleString('en-US')}`);

  const payload = {
    p_symbol: symbol,
    p_side: side.toLowerCase(),
    p_quantity: formattedQuantity,
    p_price: formattedPrice,
    p_skip_oil_deduct: skipOilDeduct
  };

  const res = await apiRequest('/rest/v1/rpc/spot_trade_atomic', {
    method: 'POST',
    body: payload
  });

  if (!res.ok) {
    const errorDetail = res.data?.message || res.data?.error || JSON.stringify(res.data);
    throw new Error(`Gagal eksekusi trade (HTTP ${res.status}): ${errorDetail}`);
  }

  return {
    quantity: formattedQuantity,
    price: formattedPrice,
    rawResult: res.data
  };
}

/**
 * Menjalankan mode Sell-All jika ada sisa aset tertinggal
 */
async function handleSellAll(symbol) {
  logger.step(`Mode Sell-All untuk ${symbol}`);
  const holding = await getAssetHolding(symbol);
  if (!holding || holding.quantity <= 0) {
    logger.info(`Tidak ada aset ${symbol} yang sedang dipegang (Holdings: 0).`);
    return;
  }

  logger.info(`Aset terdeteksi: ${holding.quantity} ${symbol} (Invested: $${holding.total_invested})`);
  const livePrice = await getLivePrice(symbol);
  try {
    const tradeResult = await executeSpotTrade(symbol, 'sell', holding.quantity, livePrice);
    logger.success(`Berhasil menjual semua ${symbol} pada harga $${tradeResult.price.toLocaleString('en-US')}!`);
  } catch (err) {
    logger.error(`Gagal melakukan sell-all: ${err.message}`);
  }
}

/**
 * Main Runner
 */
async function main() {
  console.log('\x1b[1m\x1b[36m=====================================================\x1b[0m');
  console.log('\x1b[1m\x1b[36m        KIEDEX SPOT MARKET AUTO-TRADER (ESM)         \x1b[0m');
  console.log('\x1b[1m\x1b[36m=====================================================\x1b[0m');

  await ensureValidToken();
  const params = parseArgs();
  logger.info(`Target Pair   : ${params.pair}`);
  logger.info(`User ID       : ${CONFIG.USER_ID}`);

  if (params.sellAllOnly) {
    await handleSellAll(params.pair);
    return;
  }

  logger.info(`Order Amount  : $${params.amount} USDT per trade`);
  logger.info(`Total Siklus  : ${params.cycles} cycle (Buy -> Hold ${params.holdDelay}s -> Sell)`);

  // Cek saldo awal
  const initialBalance = await getUsdtBalance();
  if (initialBalance) {
    logger.info(`Saldo Spot USDT : $${initialBalance.spotUsdt.toFixed(2)} | Oil: ${initialBalance.oil.toFixed(2)}`);
    if (initialBalance.spotUsdt < params.amount) {
      logger.error(`Saldo USDT ($${initialBalance.spotUsdt}) tidak mencukupi untuk order sebesar $${params.amount}!`);
      return;
    }
  }

  let successfulCycles = 0;

  for (let i = 1; i <= params.cycles; i++) {
    logger.step(`Siklus ${i} / ${params.cycles}`);

    try {
      // 1. Ambil harga live untuk BUY
      const buyPrice = await getLivePrice(params.pair);
      const buyQuantity = params.amount / buyPrice;

      logger.info(`[Step 1/2] Membuka Market Order (BUY)...`);
      const buyTrade = await executeSpotTrade(params.pair, 'buy', buyQuantity, buyPrice);
      logger.success(`BUY Berhasil! Quantity: ${buyTrade.quantity} ${params.pair} (~$${(buyTrade.quantity * buyTrade.price).toFixed(2)})`);

      // 2. Tahan posisi beberapa detik
      logger.info(`Menahan posisi selama ${params.holdDelay} detik sebelum menutup...`);
      await sleep(params.holdDelay * 1000);

      // 3. Ambil harga live untuk SELL
      const sellPrice = await getLivePrice(params.pair);

      // Ambil kuantitas holding aktual untuk memastikan menjual dengan pas
      const holding = await getAssetHolding(params.pair);
      const sellQuantity = (holding && holding.quantity > 0) ? holding.quantity : buyTrade.quantity;

      logger.info(`[Step 2/2] Menutup Market Order (SELL)...`);
      const sellTrade = await executeSpotTrade(params.pair, 'sell', sellQuantity, sellPrice);
      logger.success(`SELL Berhasil! Terjual: ${sellTrade.quantity} ${params.pair} @ $${sellTrade.price.toLocaleString('en-US')}`);

      const pnl = (sellTrade.price - buyTrade.price) * sellTrade.quantity;
      const pnlText = pnl >= 0 ? `+\x1b[32m$${pnl.toFixed(4)}\x1b[0m` : `-\x1b[31m$${Math.abs(pnl).toFixed(4)}\x1b[0m`;
      logger.info(`Estimasi PnL Siklus ${i}: ${pnlText}`);

      successfulCycles++;

      // Jeda antar siklus jika belum selesai
      if (i < params.cycles) {
        logger.info(`Jeda antar siklus (${params.cycleDelay} detik)...`);
        await sleep(params.cycleDelay * 1000);
      }
    } catch (cycleError) {
      logger.error(`Error pada siklus ${i}: ${cycleError.message}`);
      logger.warn('Melanjutkan ke siklus berikutnya jika ada...');
    }
  }

  // Cek saldo akhir
  const finalBalance = await getUsdtBalance();
  logger.step('Ringkasan Trading Selesai');
  logger.success(`Siklus Selesai: ${successfulCycles} / ${params.cycles}`);
  if (finalBalance) {
    logger.info(`Saldo Akhir Spot USDT: $${finalBalance.spotUsdt.toFixed(2)} | Oil: ${finalBalance.oil.toFixed(2)}`);
  }
}

// Jalankan script
main();
