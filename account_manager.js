import fs from 'fs';
import path from 'path';
import { CONFIG } from './config.js';

const ACCOUNTS_FILE = path.resolve(process.cwd(), 'accounts.json');
const BACKUP_FILE = path.resolve(process.cwd(), 'accounts.backup.json');

/**
 * Membaca daftar akun dari accounts.json
 * Jika tidak ada accounts.json, buat fallback dari .env
 */
export function loadAccounts() {
  if (fs.existsSync(ACCOUNTS_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
      if (Array.isArray(data) && data.length > 0) {
        return data;
      }
    } catch (err) {
      console.log(`\x1b[31m[ACCOUNTS] Error membaca accounts.json: ${err.message}. Mencoba membaca backup...\x1b[0m`);
      if (fs.existsSync(BACKUP_FILE)) {
        try {
          const backupData = JSON.parse(fs.readFileSync(BACKUP_FILE, 'utf8'));
          if (Array.isArray(backupData) && backupData.length > 0) return backupData;
        } catch {}
      }
    }
  }

  // Fallback ke .env jika accounts.json belum ada
  if (CONFIG.REFRESH_TOKEN || CONFIG.BEARER_TOKEN) {
    return [
      {
        name: 'Akun Default (.env)',
        user_id: CONFIG.USER_ID,
        refresh_token: CONFIG.REFRESH_TOKEN,
        bearer_token: CONFIG.BEARER_TOKEN
      }
    ];
  }

  return [];
}

/**
 * Menyimpan daftar akun ke accounts.json dengan fitur auto-backup
 */
export function saveAccounts(accounts) {
  try {
    const content = JSON.stringify(accounts, null, 2);

    // 1. Simpan backup file terlebih dahulu untuk perlindungan data
    if (fs.existsSync(ACCOUNTS_FILE)) {
      try {
        fs.copyFileSync(ACCOUNTS_FILE, BACKUP_FILE);
      } catch {}
    }

    // 2. Tulis data terbaru ke accounts.json
    fs.writeFileSync(ACCOUNTS_FILE, content, 'utf8');
    return true;
  } catch (err) {
    console.log(`\x1b[31m[ACCOUNTS] Gagal menyimpan accounts.json: ${err.message}\x1b[0m`);
    return false;
  }
}

/**
 * Refresh token untuk sebuah akun secara spesifik
 * Mengembalikan session aktif: { accessToken, userId, email, refreshToken }
 */
export async function authenticateAccount(account, accountIndex, allAccounts) {
  const refreshToken = account.refresh_token;

  if (!refreshToken) {
    // Jika tidak ada refresh token tetapi ada bearer_token statis
    if (account.bearer_token) {
      return {
        accessToken: account.bearer_token,
        userId: account.user_id || CONFIG.USER_ID,
        email: account.email || 'unknown'
      };
    }
    throw new Error(`Akun [${account.name || accountIndex + 1}] tidak memiliki refresh_token atau bearer_token!`);
  }

  const url = `${CONFIG.BASE_URL}/auth/v1/token?grant_type=refresh_token`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'apikey': CONFIG.ANON_KEY,
      'content-type': 'application/json'
    },
    body: JSON.stringify({ refresh_token: refreshToken })
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    const reason = errData.msg || errData.error_description || errData.message || errData.error || 'Token tidak valid';
    throw new Error(`Gagal refresh token (HTTP ${response.status}): ${reason}`);
  }

  const data = await response.json();
  const newAccessToken = data.access_token;
  const newRefreshToken = data.refresh_token || refreshToken;
  const user = data.user || {};

  // Perbarui data akun di memori dan file accounts.json
  account.email = user.email || account.email || '-';
  account.user_id = user.id || account.user_id;
  account.refresh_token = newRefreshToken;
  account.last_updated = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });

  // Simpan update ke accounts.json secara aman dengan membaca ulang file disk agar tidak menimpa editan user
  try {
    const currentOnDisk = loadAccounts();
    if (currentOnDisk && currentOnDisk[accountIndex]) {
      currentOnDisk[accountIndex] = {
        ...currentOnDisk[accountIndex],
        email: account.email,
        user_id: account.user_id,
        refresh_token: newRefreshToken,
        last_updated: account.last_updated
      };
      saveAccounts(currentOnDisk);
    }
  } catch {}

  return {
    accessToken: newAccessToken,
    userId: account.user_id,
    email: account.email
  };
}
