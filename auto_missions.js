import { CONFIG } from './config.js';
import { loadAccounts, authenticateAccount } from './account_manager.js';

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

async function apiRequest(endpoint, accessToken, options = {}) {
  const url = `${CONFIG.BASE_URL}${endpoint}`;
  const method = options.method || 'GET';
  const fetchOptions = {
    method,
    headers: {
      ...CONFIG.getHeaders(),
      'authorization': `Bearer ${accessToken}`,
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

async function getLiveBtcPrice() {
  try {
    const res = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT');
    const data = await res.json();
    return parseFloat(data.price);
  } catch {
    return 80800.0;
  }
}

async function getTodayStats(userId, accessToken) {
  const today = new Date().toISOString().split('T')[0];
  const [lbRes, openRes, histRes, claimRes] = await Promise.all([
    apiRequest(`/rest/v1/leaderboard_daily?user_id=eq.${userId}&date=eq.${today}`, accessToken),
    apiRequest(`/rest/v1/open_positions?user_id=eq.${userId}&leverage=gte.10&limit=1`, accessToken),
    apiRequest(`/rest/v1/trades_history?user_id=eq.${userId}&leverage=gte.10&limit=1`, accessToken),
    apiRequest(`/rest/v1/bonus_claims?user_id=eq.${userId}&select=bonus_type,claimed_at`, accessToken)
  ]);

  const lb = Array.isArray(lbRes.data) && lbRes.data.length > 0 ? lbRes.data[0] : {};
  const claims = new Set((claimRes.data || []).map((c) => c.bonus_type));

  return {
    trade_count: lb.trade_count || 0,
    total_volume: lb.total_volume || 0,
    total_counted_volume: lb.total_counted_volume || 0,
    win_count: lb.win_count || 0,
    high_leverage: (openRes.data?.length > 0 || histRes.data?.length > 0) ? 1 : 0,
    claimedMissions: claims
  };
}

async function claimMission(missionId, accessToken) {
  const res = await apiRequest('/rest/v1/rpc/claim_task_mission', accessToken, {
    method: 'POST',
    body: { p_mission_id: missionId }
  });

  if (res.ok && res.data?.success) {
    logger.success(`Misi [${missionId}] BERHASIL DIKLAIM! (+${res.data.amount} ${res.data.currency})`);
    return true;
  } else {
    const errMsg = res.data?.error || JSON.stringify(res.data);
    logger.warn(`Misi [${missionId}] belum dapat diklaim: ${errMsg}`);
    return false;
  }
}

async function executeQuickTrade(accessToken, margin = 15, leverage = 10) {
  const price = await getLiveBtcPrice();
  logger.info(`Membuka posisi Futures: Margin $${margin}, Leverage ${leverage}x @ $${price}`);

  const openRes = await apiRequest('/rest/v1/rpc/open_trade_atomic', accessToken, {
    method: 'POST',
    body: {
      p_symbol: 'BTCUSDT',
      p_side: 'long',
      p_margin: margin,
      p_leverage: leverage,
      p_entry_price: price,
      p_skip_oil_deduct: false,
      p_margin_mode: 'cross'
    }
  });

  if (!openRes.ok || !openRes.data?.success) {
    logger.error(`Gagal buka posisi: ${JSON.stringify(openRes.data)}`);
    return false;
  }

  const posId = openRes.data.position_id;
  logger.info(`Posisi terbuka (ID: ${posId}). Menahan 12 detik...`);
  await sleep(12000);

  const exitPrice = await getLiveBtcPrice();
  logger.info(`Menutup posisi @ $${exitPrice}...`);
  const closeRes = await apiRequest('/rest/v1/rpc/close_trade_atomic', accessToken, {
    method: 'POST',
    body: {
      p_position_id: posId,
      p_exit_price: exitPrice
    }
  });

  if (closeRes.ok && closeRes.data?.success) {
    logger.success(`Posisi ditutup! PnL: $${Number(closeRes.data.pnl || 0).toFixed(4)}`);
    return true;
  } else {
    logger.warn(`Gagal tutup posisi: ${JSON.stringify(closeRes.data)}`);
    return false;
  }
}

async function processAccountMissions(account, index, total, allAccounts) {
  const accountName = account.name || `Akun #${index + 1}`;
  logger.step(`[${index + 1}/${total}] Memproses Misi: ${accountName}`);

  let session;
  try {
    session = await authenticateAccount(account, index, allAccounts);
    logger.success(`Autentikasi Akun: ${session.email} (ID: ${session.userId})`);
  } catch (err) {
    logger.error(`Autentikasi gagal: ${err.message}`);
    return;
  }

  const { accessToken, userId } = session;

  let stats = await getTodayStats(userId, accessToken);
  console.log(`   ├─ Trade Count         : ${stats.trade_count} / 5 (Target t1)`);
  console.log(`   ├─ Total Volume        : $${stats.total_volume.toFixed(2)} (Target t2: $1,000)`);
  console.log(`   ├─ Total Counted Vol   : $${stats.total_counted_volume}`);
  console.log(`   ├─ Win Trades          : ${stats.win_count} / 1 (Target t3)`);
  console.log(`   └─ High Leverage (10x+): ${stats.high_leverage === 1 ? 'Sudah' : 'Belum'} (Target t4)`);

  // Penuhi trades jika belum 5
  if (stats.trade_count < 5) {
    // Cek saldo Futures dan auto-transfer dari Spot jika Futures < 15
    const balRes = await apiRequest(`/rest/v1/balances?select=spot_usdt_balance,futures_usdt_balance&user_id=eq.${userId}`, accessToken);
    const bal = balRes.data?.[0];
    const futBal = Number(bal?.futures_usdt_balance || 0);
    const spotBal = Number(bal?.spot_usdt_balance || 0);

    if (futBal < 15 && spotBal >= 15) {
      const transferAmount = Math.min(spotBal, 50);
      logger.info(`Saldo Futures ($${futBal}) < $15. Auto-transfer $${transferAmount} dari Spot ke Futures...`);
      await apiRequest('/rest/v1/rpc/transfer_usdt', accessToken, {
        method: 'POST',
        body: { p_from: 'spot', p_to: 'futures', p_amount: transferAmount }
      });
      await sleep(2000);
    }

    const remaining = 5 - stats.trade_count;
    logger.info(`Menjalankan ${remaining} trade otomatis agar mencapai target 5 trade...`);
    for (let i = 1; i <= remaining; i++) {
      logger.info(`Trade ${i}/${remaining}...`);
      await executeQuickTrade(accessToken, 15, 10);
      await sleep(4000);
    }
    stats = await getTodayStats(userId, accessToken);
  } else {
    logger.info('Syarat trade_count (>= 5) sudah terpenuhi!');
  }

  // Klaim misi
  logger.info('Mengecek dan mengklaim reward misi...');
  const missions = ['t1', 't3', 't4', 't2'];
  for (const mId of missions) {
    if (stats.claimedMissions.has(`mission_${mId}`)) {
      logger.info(`Misi [${mId}] SUDAH DIKLAIM sebelumnya.`);
    } else {
      await claimMission(mId, accessToken);
      await sleep(1500);
    }
  }
}

async function main() {
  console.log('\x1b[1m\x1b[35m=====================================================\x1b[0m');
  console.log('\x1b[1m\x1b[35m       KIEDEX MULTI-ACCOUNT MISSIONS RESOLVER        \x1b[0m');
  console.log('\x1b[1m\x1b[35m=====================================================\x1b[0m');

  const accounts = loadAccounts();
  const activeAccounts = accounts.filter((acc) => acc.refresh_token && acc.refresh_token.trim() !== '');
  logger.info(`Total Akun Siap Jalan: ${activeAccounts.length} dari ${accounts.length} Slot`);

  for (let i = 0; i < accounts.length; i++) {
    const acc = accounts[i];
    if (!acc.refresh_token || !acc.refresh_token.trim()) continue;

    await processAccountMissions(acc, i, accounts.length, accounts);
    if (i < accounts.length - 1) {
      logger.info('Jeda 4 detik antar akun...');
      await sleep(4000);
    }
  }

  logger.step('Selesai');
  logger.success('Semua akun telah diproses dan file accounts.json terbarui secara aman.');
}

main();
