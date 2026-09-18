import { CONFIG } from './config.js';
import { ensureValidToken } from './auth.js';

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

const logger = {
  info: (msg) => console.log(`\x1b[90m[${getTimestamp()}]\x1b[0m \x1b[36m[INFO]\x1b[0m ${msg}`),
  success: (msg) => console.log(`\x1b[90m[${getTimestamp()}]\x1b[0m \x1b[32m[SUCCESS]\x1b[0m ${msg}`),
  warn: (msg) => console.log(`\x1b[90m[${getTimestamp()}]\x1b[0m \x1b[33m[WARN]\x1b[0m ${msg}`),
  error: (msg) => console.log(`\x1b[90m[${getTimestamp()}]\x1b[0m \x1b[31m[ERROR]\x1b[0m ${msg}`),
  step: (title) => console.log(`\n\x1b[90m[${getTimestamp()}]\x1b[0m \x1b[1m\x1b[35m=== ${title} ===\x1b[0m`)
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

  return { ok: response.ok, status: response.status, data: responseData };
}

export async function getLivePrice(symbol = 'BTCUSDT') {
  try {
    const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`);
    const data = await res.json();
    return parseFloat(data.price);
  } catch {
    return 80800.0;
  }
}

/**
 * Transfer saldo USDT antara spot dan futures
 * @param {'spot'|'futures'} from
 * @param {'spot'|'futures'} to
 * @param {number} amount
 */
export async function transferUsdt(from, to, amount) {
  logger.info(`Transfer USDT: ${amount} dari [${from}] ke [${to}]...`);
  const res = await apiRequest('/rest/v1/rpc/transfer_usdt', {
    method: 'POST',
    body: {
      p_from: from,
      p_to: to,
      p_amount: amount
    }
  });

  if (res.ok && res.data?.success !== false) {
    logger.success(`Transfer berhasil: ${JSON.stringify(res.data)}`);
    return true;
  } else {
    logger.error(`Transfer gagal: ${res.data?.error || JSON.stringify(res.data)}`);
    return false;
  }
}

/**
 * Buka posisi Futures (Long / Short)
 */
export async function openFuturesPosition({
  symbol = 'BTCUSDT',
  side = 'long',
  margin = 25,
  leverage = 20,
  marginMode = 'cross',
  skipOilDeduct = false
}) {
  const price = await getLivePrice(symbol);
  logger.info(`Membuka posisi Futures ${side.toUpperCase()} ${symbol}: Margin $${margin}, Lev ${leverage}x (${marginMode}) @ $${price}`);

  const res = await apiRequest('/rest/v1/rpc/open_trade_atomic', {
    method: 'POST',
    body: {
      p_symbol: symbol,
      p_side: side.toLowerCase(),
      p_margin: margin,
      p_leverage: leverage,
      p_entry_price: price,
      p_skip_oil_deduct: skipOilDeduct,
      p_margin_mode: marginMode
    }
  });

  if (!res.ok || !res.data?.success) {
    throw new Error(res.data?.error || `HTTP ${res.status}: Gagal membuka posisi`);
  }

  logger.success(`Posisi terbuka! ID: ${res.data.position_id} (Notional: $${res.data.position_value}, Fee: ${res.data.oil_fee} Oil)`);
  return {
    positionId: res.data.position_id,
    entryPrice: price,
    raw: res.data
  };
}

/**
 * Tutup posisi Futures
 */
export async function closeFuturesPosition(positionId, symbol = 'BTCUSDT') {
  const price = await getLivePrice(symbol);
  logger.info(`Menutup posisi ${positionId} @ $${price}...`);

  const res = await apiRequest('/rest/v1/rpc/close_trade_atomic', {
    method: 'POST',
    body: {
      p_position_id: positionId,
      p_exit_price: price
    }
  });

  if (!res.ok || !res.data?.success) {
    throw new Error(res.data?.error || `HTTP ${res.status}: Gagal menutup posisi`);
  }

  const pnl = Number(res.data.pnl || 0);
  const pnlStr = pnl >= 0 ? `+\x1b[32m$${pnl.toFixed(4)}\x1b[0m` : `-\x1b[31m$${Math.abs(pnl).toFixed(4)}\x1b[0m`;
  logger.success(`Posisi ditutup! PnL: ${pnlStr} (Exit Price: $${price})`);
  return res.data;
}

/**
 * CLI Runner jika dieksekusi langsung
 */
async function main() {
  console.log('\x1b[1m\x1b[34m=====================================================\x1b[0m');
  console.log('\x1b[1m\x1b[34m       KIEDEX FUTURES AUTO-TRADER (CROSS/ISO)        \x1b[0m');
  console.log('\x1b[1m\x1b[34m=====================================================\x1b[0m');

  await ensureValidToken();

  const args = process.argv.slice(2);
  const isTransfer = args.find((a) => a.startsWith('--transfer='));
  if (isTransfer) {
    const [from, to, amount] = isTransfer.split('=')[1].split(':');
    await transferUsdt(from, to, parseFloat(amount));
    return;
  }

  // Siklus buka -> tahan 12 detik -> tutup
  try {
    const pos = await openFuturesPosition({
      symbol: 'BTCUSDT',
      side: 'long',
      margin: 20,
      leverage: 10,
      marginMode: 'cross'
    });

    logger.info('Menahan posisi selama 12 detik...');
    await sleep(12000);

    await closeFuturesPosition(pos.positionId, 'BTCUSDT');
    logger.success('Siklus Futures berhasil diselesaikan.');
  } catch (err) {
    logger.error(`Error: ${err.message}`);
  }
}

// Jalankan jika dipanggil via CLI
if (process.argv[1]?.endsWith('futures_trader.js')) {
  main();
}
