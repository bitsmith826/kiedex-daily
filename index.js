import { CONFIG } from './config.js';
import { loadAccounts, authenticateAccount } from './account_manager.js';

// ==========================================
// FORMATTING & ANSI HELPERS (PRECISION LAYOUT)
// ==========================================

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[90m',
  cyan: '\x1b[36m',
  blue: '\x1b[34m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
  white: '\x1b[37m'
};

function stripAnsi(str) {
  return String(str || '').replace(/\x1b\[[0-9;]*m/g, '');
}

function pad(str, targetWidth, align = 'left') {
  const plain = stripAnsi(str);
  const diff = Math.max(0, targetWidth - plain.length);
  if (diff <= 0) return str;
  if (align === 'right') return ' '.repeat(diff) + str;
  if (align === 'center') {
    const left = Math.floor(diff / 2);
    const right = diff - left;
    return ' '.repeat(left) + str + ' '.repeat(right);
  }
  return str + ' '.repeat(diff);
}

function truncate(str, maxLen) {
  if (!str) return '';
  return str.length > maxLen ? str.slice(0, maxLen - 3) + '...' : str;
}

function num(val, decimals = 2) {
  const n = Number(val || 0);
  return n.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ==========================================
// UI COMPONENT HELPERS
// ==========================================

function printHeaderBanner(title, subtitle, width = 76) {
  const innerW = width - 4;
  console.log(`\n${C.cyan}╔${'═'.repeat(width - 2)}╗${C.reset}`);
  console.log(`${C.cyan}║ ${C.bold}${pad(title, innerW, 'center')}${C.reset}${C.cyan} ║${C.reset}`);
  if (subtitle) {
    console.log(`${C.cyan}║ ${C.dim}${pad(subtitle, innerW, 'center')}${C.reset}${C.cyan} ║${C.reset}`);
  }
  console.log(`${C.cyan}╚${'═'.repeat(width - 2)}╝${C.reset}`);
}

function printAccountBanner(index, total, name, width = 76) {
  const innerW = width - 4;
  const label = `[${index}/${total}] MEMPROSES: ${name.toUpperCase()}`;
  console.log(`\n${C.blue}┌${'─'.repeat(width - 2)}┐${C.reset}`);
  console.log(`${C.blue}│ ${C.bold}${C.white}${pad(label, innerW, 'left')}${C.reset}${C.blue} │${C.reset}`);
  console.log(`${C.blue}└${'─'.repeat(width - 2)}┘${C.reset}`);
}

function formatBadge(type, text, width = 13) {
  const inner = pad(text, width - 2, 'center');
  if (type === 'success') return `${C.green}[${inner}]${C.reset}`;
  if (type === 'warn')    return `${C.yellow}${C.bold}[${inner}]${C.reset}`;
  if (type === 'audit')   return `${C.yellow}[${inner}]${C.reset}`;
  if (type === 'info')    return `${C.cyan}[${inner}]${C.reset}`;
  if (type === 'error')   return `${C.red}[${inner}]${C.reset}`;
  return `${C.dim}[${inner}]${C.reset}`;
}

function printBalanceCard(bal) {
  const W1 = 34;
  const W2 = 34;

  const top = `        ${C.dim}┌${'─'.repeat(W1)}┬${'─'.repeat(W2)}┐${C.reset}`;
  const bot = `        ${C.dim}└${'─'.repeat(W1)}┴${'─'.repeat(W2)}┘${C.reset}`;

  const leftLines = [
    `  Demo USDT    : ${C.yellow}$${num(bal.demo_usdt_balance)}${C.reset}`,
    `  Futures USDT : ${C.yellow}$${num(bal.futures_usdt_balance)}${C.reset}`,
    `  KDX Token    : ${C.magenta}${num(bal.kdx_balance, 0)} KDX${C.reset}`
  ];

  const rightLines = [
    `  Spot USDT    : ${C.yellow}$${num(bal.spot_usdt_balance)}${C.reset}`,
    `  Oil Balance  : ${C.cyan}${num(bal.oil_balance)} Oil${C.reset}`,
    `  ETH Balance  : ${C.dim}${num(bal.eth_balance, 4)} ETH${C.reset}`
  ];

  console.log(top);
  for (let i = 0; i < leftLines.length; i++) {
    const col1 = pad(leftLines[i], W1);
    const col2 = pad(rightLines[i], W2);
    console.log(`        ${C.dim}│${C.reset}${col1}${C.dim}│${C.reset}${col2}${C.dim}│${C.reset}`);
  }
  console.log(bot);
}

function renderTable(cols, rows) {
  const top = C.dim + '┌' + cols.map(c => '─'.repeat(c.width)).join('┬') + '┐' + C.reset;
  const header = C.dim + '│' + cols.map(c => {
    return C.bold + C.cyan + pad(` ${c.title} `, c.width, c.align || 'left') + C.reset + C.dim;
  }).join('│') + '│' + C.reset;
  const mid = C.dim + '├' + cols.map(c => '─'.repeat(c.width)).join('┼') + '┤' + C.reset;
  const body = rows.map(r => {
    return C.dim + '│' + cols.map(c => {
      const rawVal = r[c.key] !== undefined ? String(r[c.key]) : '-';
      const cellVal = c.format ? c.format(rawVal, r) : ` ${rawVal} `;
      return pad(cellVal, c.width, c.align || 'left') + C.dim;
    }).join('│') + '│' + C.reset;
  }).join('\n');
  const bot = C.dim + '└' + cols.map(c => '─'.repeat(c.width)).join('┴') + '┘' + C.reset;

  return [top, header, mid, body, bot].join('\n');
}

// ==========================================
// API REQUEST HELPER
// ==========================================

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

  return {
    ok: response.ok,
    status: response.status,
    data: responseData
  };
}

// ==========================================
// TRADING & MISSIONS AUTOMATION HELPERS
// ==========================================

async function getLiveBtcPrice() {
  try {
    const res = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT');
    if (res.ok) {
      const data = await res.json();
      return parseFloat(data.price);
    }
  } catch {}
  try {
    const res = await fetch('https://api.coinbase.com/v2/prices/BTC-USD/spot');
    if (res.ok) {
      const data = await res.json();
      return parseFloat(data.data.amount);
    }
  } catch {}
  return 85000.0;
}

async function executeQuickTrade(accessToken, margin = 25, leverage = 10, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const entryPrice = await getLiveBtcPrice();
    const openRes = await apiRequest('/rest/v1/rpc/open_trade_atomic', accessToken, {
      method: 'POST',
      body: {
        p_symbol: 'BTCUSDT',
        p_side: 'long',
        p_margin: margin,
        p_leverage: leverage,
        p_entry_price: entryPrice,
        p_skip_oil_deduct: false,
        p_margin_mode: 'cross'
      }
    });

    if (!openRes.ok || !openRes.data?.success) {
      const errMsg = openRes.data?.message || openRes.data?.error || JSON.stringify(openRes.data);
      const lower = String(errMsg).toLowerCase();
      if (lower.includes('insufficient oil')) {
        if (margin > 2 || leverage > 2) {
          margin = 2;
          leverage = 2;
          await sleep(1500);
          continue;
        }
        return { success: false, error: errMsg };
      }
      if (lower.includes('wait') || lower.includes('before opening')) {
        await sleep(3500);
        continue;
      }
      return { success: false, error: errMsg };
    }

    const posId = openRes.data.position_id;
    // Tahan minimal 11 detik (syarat aturan min_hold_seconds: 10 dari Kiedex)
    await sleep(11000);

    // Smart Take-Profit Sniping: Cek harga live hingga 6 kali (maks 10 detik) untuk mengunci profit
    let exitPrice = await getLiveBtcPrice();
    for (let check = 0; check < 6; check++) {
      if (exitPrice >= entryPrice) {
        break; // Harga sudah hijau/profit, langsung kunci keuntungan!
      }
      await sleep(1500);
      exitPrice = await getLiveBtcPrice();
    }

    const closeRes = await apiRequest('/rest/v1/rpc/close_trade_atomic', accessToken, {
      method: 'POST',
      body: {
        p_position_id: posId,
        p_exit_price: exitPrice
      }
    });

    if (closeRes.ok && closeRes.data?.success) {
      const pnl = Number(closeRes.data.pnl || 0);
      return { success: true, pnl, posId, isWin: pnl > 0, margin, leverage };
    } else {
      const err = closeRes.data?.message || closeRes.data?.error || JSON.stringify(closeRes.data);
      return { success: false, error: err };
    }
  }

  return { success: false, error: 'Batas cooldown server' };
}

async function claimTaskMission(missionId, accessToken) {
  const res = await apiRequest('/rest/v1/rpc/claim_task_mission', accessToken, {
    method: 'POST',
    body: { p_mission_id: missionId }
  });
  if (res.ok && res.data?.success) {
    return { success: true, amount: res.data.amount, currency: res.data.currency };
  }
  const err = res.data?.error || res.data?.message || 'Belum memenuhi syarat';
  return { success: false, error: err };
}

// ==========================================
// PROCESS 1 ACCOUNT (SIMPLIFIED & CLEAN LAYOUT)
// ==========================================

async function processAccount(account, index, total, allAccounts) {
  const accountName = account.name || `Akun #${index + 1}`;
  printAccountBanner(index + 1, total, accountName);

  // 1. Autentikasi Token
  console.log(`  ${C.bold}[1/5] Autentikasi Token${C.reset}`);
  let session;
  try {
    session = await authenticateAccount(account, index, allAccounts);
    console.log(`        • Sesi Akun     : ${formatBadge('success', 'AKTIF')} ${session.email}`);
  } catch (err) {
    console.log(`        • Sesi Akun     : ${formatBadge('error', 'GAGAL')} ${C.red}${err.message}${C.reset}`);
    return {
      no: index + 1,
      name: accountName,
      email: account.email || 'Error Auth',
      usdt: '0.00',
      oil: '0.00',
      kdx: '0',
      streak: '0'
    };
  }

  const { accessToken, userId } = session;

  // 2. Klaim Harian (Faucet & Oil Bonus)
  await sleep(600);
  console.log(`\n  ${C.bold}[2/5] Klaim Harian${C.reset}`);

  // Faucet USDT
  const faucetRes = await apiRequest('/rest/v1/rpc/claim_daily_faucet', accessToken, { method: 'POST', body: {} });
  if (faucetRes.ok && faucetRes.data?.success !== false) {
    console.log(`        • Faucet USDT   : ${formatBadge('success', 'BERHASIL')} +50 USDT berhasil diklaim`);
  } else {
    console.log(`        • Faucet USDT   : ${formatBadge('info', 'SUDAH KLAIM')} Sudah diklaim hari ini`);
  }

  await sleep(600);

  // Oil Bonus
  const oilRes = await apiRequest('/rest/v1/rpc/claim_daily_oil', accessToken, { method: 'POST', body: {} });
  if (oilRes.ok && oilRes.data?.success !== false) {
    console.log(`        • Oil Bonus     : ${formatBadge('success', 'BERHASIL')} +40 Oil berhasil diklaim`);
  } else {
    console.log(`        • Oil Bonus     : ${formatBadge('info', 'SUDAH KLAIM')} Sudah diklaim hari ini`);
  }

  // 3. Misi Trading (t1 - t4)
  await sleep(600);
  console.log(`\n  ${C.bold}[3/5] Misi Trading (t1 - t4)${C.reset}`);

  const todayUtc = new Date().toISOString().split('T')[0];
  let [lbRes, openRes, histRes] = await Promise.all([
    apiRequest(`/rest/v1/leaderboard_daily?user_id=eq.${userId}&date=eq.${todayUtc}`, accessToken),
    apiRequest(`/rest/v1/open_positions?user_id=eq.${userId}&leverage=gte.10&limit=1`, accessToken),
    apiRequest(`/rest/v1/trades_history?user_id=eq.${userId}&leverage=gte.10&limit=1`, accessToken)
  ]);

  let lbData = Array.isArray(lbRes.data) && lbRes.data.length > 0 ? lbRes.data[0] : {};
  let tradeCount = Number(lbData.trade_count || 0);
  let totalVol = Number(lbData.total_volume || 0);
  let winCount = Number(lbData.win_count || 0);

  if (tradeCount >= 5 && totalVol >= 1000 && winCount >= 1) {
    console.log(`        • Status        : ${formatBadge('success', 'SELESAI')} Misi trading t1 - t4 sudah terpenuhi`);
  } else {
    // Cek saldo Futures dan auto-transfer jika < $10
    const balCheckRes = await apiRequest(`/rest/v1/balances?select=spot_usdt_balance,futures_usdt_balance,oil_balance&user_id=eq.${userId}`, accessToken);
    const curBal = balCheckRes.data?.[0];
    let futBal = Number(curBal?.futures_usdt_balance || 0);
    const spotBal = Number(curBal?.spot_usdt_balance || 0);
    const oilBal = Number(curBal?.oil_balance || 0);

    if (futBal < 10 && spotBal >= 10) {
      const transferAmount = Math.min(spotBal, 50);
      console.log(`        • Auto-Transfer : ${formatBadge('info', 'TRANSFER')} $${transferAmount} Spot -> Futures`);
      await apiRequest('/rest/v1/rpc/transfer_usdt', accessToken, {
        method: 'POST',
        body: { p_from: 'spot', p_to: 'futures', p_amount: transferAmount }
      });
      futBal += transferAmount;
      await sleep(1500);
    }

    // Hitung sisa trade yang diperlukan (target 5 trade harian & minimal 1x win)
    const tradesNeededForCount = Math.max(0, 5 - tradeCount);
    let totalNeeded = tradesNeededForCount;
    if (totalNeeded === 0 && winCount === 0) totalNeeded = 1;

    // Adaptasi dinamis Margin & Leverage berdasarkan ketersediaan saldo Oil
    // Biaya Oil = (Margin * Leverage) * 2.0
    let tradeMargin = 25;
    let tradeLeverage = 10;

    if (oilBal < 8) {
      console.log(`        • Status Oil    : ${formatBadge('warn', 'OIL RENDAH')} Saldo Oil (${oilBal.toFixed(1)}) tidak cukup untuk fee gas (< 8 Oil)`);
      totalNeeded = 0;
    } else {
      const oilPerTrade = Math.floor(oilBal / Math.max(1, totalNeeded));
      const maxNotional = Math.floor(oilPerTrade / 2);

      if (maxNotional >= 250 && futBal >= 25) {
        tradeMargin = 25; tradeLeverage = 10;
      } else if (maxNotional >= 100 && futBal >= 10) {
        tradeMargin = 10; tradeLeverage = 10;
      } else if (maxNotional >= 40 && futBal >= 8) {
        tradeMargin = 8; tradeLeverage = 5;
      } else if (maxNotional >= 20 && futBal >= 5) {
        tradeMargin = 5; tradeLeverage = 4;
      } else if (maxNotional >= 10 && futBal >= 5) {
        tradeMargin = 5; tradeLeverage = 2;
      } else {
        tradeMargin = 2; tradeLeverage = 2;
      }
    }

    for (let t = 1; t <= totalNeeded; t++) {
      process.stdout.write(`        • Trade [${t}/${totalNeeded}]   : Menahan posisi & mencari profit...`);
      const tradeRes = await executeQuickTrade(accessToken, tradeMargin, tradeLeverage);
      if (tradeRes.success) {
        if (tradeRes.isWin) winCount++;
        const pnl = tradeRes.pnl;
        const pnlStr = pnl >= 0 ? `${C.green}+$${pnl.toFixed(2)}${C.reset}` : `${C.red}-$${Math.abs(pnl).toFixed(2)}${C.reset}`;
        const usedMargin = tradeRes.margin ?? tradeMargin;
        const usedLev = tradeRes.leverage ?? tradeLeverage;
        process.stdout.write(`\r        • Trade [${t}/${totalNeeded}]   : ${formatBadge('success', 'SELESAI')} Margin $${usedMargin} (${usedLev}x) | PnL: ${pnlStr}        \n`);
      } else {
        process.stdout.write(`\r        • Trade [${t}/${totalNeeded}]   : ${formatBadge('error', 'GAGAL')} ${C.red}${tradeRes.error}${C.reset}           \n`);
      }
      if (t < totalNeeded) await sleep(4500);
    }
  }

  // 4. Klaim Reward Misi
  await sleep(600);
  console.log(`\n  ${C.bold}[4/5] Klaim Reward Misi${C.reset}`);

  const missionsToClaim = ['t1', 't3', 't4', 's1', 's3', 's4', 's5', 's6', 't2'];
  const claimsCheck = await apiRequest(`/rest/v1/bonus_claims?user_id=eq.${userId}&select=bonus_type`, accessToken);
  const claimedSet = new Set((claimsCheck.data || []).map((c) => c.bonus_type.replace('mission_', '')));

  const newlyClaimed = [];
  for (const mId of missionsToClaim) {
    if (claimedSet.has(mId)) continue;
    const claimRes = await claimTaskMission(mId, accessToken);
    if (claimRes.success) {
      newlyClaimed.push(`${mId} (+${claimRes.amount} KDX)`);
      claimedSet.add(mId);
      await sleep(1000);
    }
  }

  if (newlyClaimed.length > 0) {
    console.log(`        • Reward Klaim  : ${formatBadge('success', 'SUKSES')} ${C.green}${newlyClaimed.join(', ')}${C.reset}`);
  } else {
    console.log(`        • Reward Klaim  : ${formatBadge('info', 'LENGKAP')} Semua reward aktif sudah terklaim`);
  }

  // 5. Saldo & Status Akhir
  await sleep(600);
  console.log(`\n  ${C.bold}[5/5] Saldo & Status Misi Akhir${C.reset}`);

  const [balResFinal, streakRes, questsRes, finalClaimsRes, lbFinalRes, posFinalRes, histFinalRes] = await Promise.all([
    apiRequest(`/rest/v1/balances?select=demo_usdt_balance,spot_usdt_balance,futures_usdt_balance,oil_balance,kdx_balance,eth_balance&user_id=eq.${userId}`, accessToken),
    apiRequest(`/rest/v1/trading_streaks?select=current_streak&user_id=eq.${userId}`, accessToken),
    apiRequest('/rest/v1/airdrop_quests?select=*&is_active=eq.true&order=sort_order.asc', accessToken),
    apiRequest(`/rest/v1/bonus_claims?user_id=eq.${userId}&select=bonus_type,claimed_at`, accessToken),
    apiRequest(`/rest/v1/leaderboard_daily?user_id=eq.${userId}&date=eq.${todayUtc}`, accessToken),
    apiRequest(`/rest/v1/open_positions?user_id=eq.${userId}&leverage=gte.10&limit=1`, accessToken),
    apiRequest(`/rest/v1/trades_history?user_id=eq.${userId}&leverage=gte.10&limit=1`, accessToken)
  ]);

  const balFinal = Array.isArray(balResFinal.data) && balResFinal.data.length > 0 ? balResFinal.data[0] : null;
  if (balFinal) {
    printBalanceCard(balFinal);
  }

  const streak = streakRes.ok && streakRes.data?.[0]?.current_streak !== undefined ? streakRes.data[0].current_streak : 0;
  console.log(`\n        • Trading Streak    : ${C.yellow}${C.bold}🔥 ${streak} Hari Berturut-turut${C.reset}`);

  const updatedClaimedSet = new Set((finalClaimsRes.data || []).map((c) => c.bonus_type.replace('mission_', '')));
  const lbFinalData = Array.isArray(lbFinalRes.data) && lbFinalRes.data.length > 0 ? lbFinalRes.data[0] : {};

  const finalStats = {
    trade_count: Number(lbFinalData.trade_count || 0),
    total_volume: Number(lbFinalData.total_volume || 0),
    total_counted_volume: Number(lbFinalData.total_counted_volume || 0),
    win_count: Number(lbFinalData.win_count || 0),
    high_leverage: (posFinalRes.data?.length > 0 || histFinalRes.data?.length > 0) ? 1 : 0
  };

  if (questsRes.ok && Array.isArray(questsRes.data)) {
    const tradingQuests = questsRes.data.filter((q) => q.category === 'trading');
    const socialQuests = questsRes.data.filter((q) => q.category === 'social');

    const getQuestBadge = (q) => {
      if (updatedClaimedSet.has(q.id)) return formatBadge('success', 'SELESAI');
      if (q.category === 'trading') {
        if (q.id === 't1') {
          return finalStats.trade_count >= 5 ? formatBadge('warn', 'SIAP KLAIM') : formatBadge('default', `${finalStats.trade_count}/5 TRADE`);
        }
        if (q.id === 't2') {
          if (finalStats.total_counted_volume >= 1000) return formatBadge('warn', 'SIAP KLAIM');
          if (finalStats.total_volume >= 1000) return formatBadge('audit', 'AUDIT SRV');
          return formatBadge('default', `$${Math.floor(finalStats.total_volume)}/1000`);
        }
        if (q.id === 't3') {
          return finalStats.win_count >= 1 ? formatBadge('warn', 'SIAP KLAIM') : formatBadge('default', '0/1 WIN');
        }
        if (q.id === 't4') {
          return finalStats.high_leverage >= 1 ? formatBadge('warn', 'SIAP KLAIM') : formatBadge('default', 'BELUM 10x');
        }
      }
      return formatBadge('default', 'BELUM');
    };

    console.log(`\n        ${C.dim}── Misi Trading ───────────────────────────────────────────────────${C.reset}`);
    tradingQuests.forEach((q) => {
      const idCol = `${C.dim}[${C.cyan}${q.id}${C.dim}]${C.reset}`;
      const badgeCol = getQuestBadge(q);
      const titleCol = pad(q.title, 34, 'left');
      const rewardCol = pad(`+${q.reward_kdx} KDX`, 10, 'right');
      console.log(`        ${idCol}  ${badgeCol}  ${titleCol}  ${C.magenta}${rewardCol}${C.reset}`);
    });

    console.log(`\n        ${C.dim}── Misi Sosial ────────────────────────────────────────────────────${C.reset}`);
    socialQuests.forEach((q) => {
      const idCol = `${C.dim}[${C.cyan}${q.id}${C.dim}]${C.reset}`;
      const badgeCol = getQuestBadge(q);
      const titleCol = pad(q.title, 34, 'left');
      const rewardCol = pad(`+${q.reward_kdx} KDX`, 10, 'right');
      console.log(`        ${idCol}  ${badgeCol}  ${titleCol}  ${C.magenta}${rewardCol}${C.reset}`);
    });
  }

  return {
    no: index + 1,
    name: accountName,
    email: session.email,
    usdt: balFinal ? num(balFinal.demo_usdt_balance) : '0.00',
    oil: balFinal ? num(balFinal.oil_balance) : '0.00',
    kdx: balFinal ? String(num(balFinal.kdx_balance, 0)) : '0',
    streak: String(streak)
  };
}

// ==========================================
// MAIN CONTROLLER
// ==========================================

async function main() {
  console.clear();
  const now = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
  const accounts = loadAccounts();
  const activeAccounts = accounts.filter((acc) => acc.refresh_token && acc.refresh_token.trim() !== '');

  printHeaderBanner(
    'KIEDEX ALL-IN-ONE FETCHER & TRADING AUTOMATION',
    `Waktu: ${now} WIB  |  Total Akun Siap: ${activeAccounts.length} dari ${accounts.length} Slot`
  );

  if (activeAccounts.length === 0) {
    console.log(`\n${C.red}Tidak ada akun dengan refresh_token aktif di accounts.json!${C.reset}\n`);
    return;
  }

  const results = [];

  for (let i = 0; i < accounts.length; i++) {
    const acc = accounts[i];
    if (!acc.refresh_token || !acc.refresh_token.trim()) continue;

    const res = await processAccount(acc, i, accounts.length, accounts);
    results.push(res);

    if (i < accounts.length - 1 && results.length < activeAccounts.length) {
      console.log(`\n${C.dim}────────────────────────────────────────────────────────────────────────────${C.reset}`);
      console.log(`${C.dim}  Menunggu jeda 4 detik sebelum memproses akun berikutnya...${C.reset}`);
      console.log(`${C.dim}────────────────────────────────────────────────────────────────────────────${C.reset}`);
      await sleep(4000);
    }
  }

  // ==========================================
  // RINGKASAN AKHIR (SUMMARY TABLE)
  // ==========================================
  printHeaderBanner('RINGKASAN SEMUA AKUN', `Total Selesai: ${results.length} Akun Diproses`);

  const summaryCols = [
    { key: 'no', title: '#', width: 4, align: 'center' },
    { key: 'email', title: 'Akun / Email', width: 25, align: 'left', format: (v) => ` ${truncate(v, 23)} ` },
    { key: 'usdt', title: 'USDT Total', width: 13, align: 'right', format: (v) => `${C.yellow} $${v} ${C.reset}` },
    { key: 'oil', title: 'Saldo Oil', width: 14, align: 'right', format: (v) => `${C.cyan} ${v} Oil ${C.reset}` },
    { key: 'kdx', title: 'KDX Token', width: 11, align: 'right', format: (v) => `${C.magenta} ${v} KDX ${C.reset}` },
    { key: 'streak', title: 'Streak', width: 9, align: 'center', format: (v) => `${C.yellow} ${v} H ${C.reset}` }
  ];

  console.log(renderTable(summaryCols, results));
  console.log(`\n${C.green}✔ Seluruh akun selesai diproses secara otomatis dan token aman diperbarui.${C.reset}\n`);
}

main();


