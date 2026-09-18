import fs from 'fs';
import path from 'path';
import { CONFIG } from './config.js';

/**
 * Parsing payload JWT tanpa verifikasi signature untuk membaca exp
 */
export function getJwtPayload(token) {
  try {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const json = Buffer.from(parts[1], 'base64').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/**
 * Mengecek apakah token sudah kedaluwarsa atau hampir habis (default threshold: 5 menit)
 */
export function isTokenExpired(token, thresholdMinutes = 5) {
  const payload = getJwtPayload(token);
  if (!payload || !payload.exp) return true;
  const nowSec = Math.floor(Date.now() / 1000);
  return payload.exp - nowSec <= thresholdMinutes * 60;
}

/**
 * Menyimpan nilai access token dan refresh token baru ke file .env
 */
function saveTokensToEnv(newAccessToken, newRefreshToken) {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;

  let content = fs.readFileSync(envPath, 'utf8');

  // Replace atau tambahkan USER_BEARER_TOKEN
  if (/USER_BEARER_TOKEN=.*/.test(content)) {
    content = content.replace(/USER_BEARER_TOKEN=.*/, `USER_BEARER_TOKEN=${newAccessToken}`);
  } else {
    content += `\nUSER_BEARER_TOKEN=${newAccessToken}`;
  }

  // Replace atau tambahkan REFRESH_TOKEN
  if (/REFRESH_TOKEN=.*/.test(content)) {
    content = content.replace(/REFRESH_TOKEN=.*/, `REFRESH_TOKEN=${newRefreshToken}`);
  } else {
    content += `\nREFRESH_TOKEN=${newRefreshToken}`;
  }

  fs.writeFileSync(envPath, content, 'utf8');
}

/**
 * Melakukan refresh session ke Supabase Auth
 */
export async function refreshSession() {
  const refreshToken = CONFIG.REFRESH_TOKEN;
  if (!refreshToken || refreshToken === 'your_refresh_token_here') {
    return false;
  }

  try {
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
      console.log(`\x1b[33m[AUTH WARN] Gagal me-refresh token (${response.status}): ${errData.error_description || errData.message || 'Unknown'}\x1b[0m`);
      return false;
    }

    const data = await response.json();
    if (data?.access_token) {
      CONFIG.BEARER_TOKEN = data.access_token;
      if (data.refresh_token) {
        CONFIG.REFRESH_TOKEN = data.refresh_token;
      }

      // Simpan perubahan ke file .env
      saveTokensToEnv(data.access_token, data.refresh_token || refreshToken);

      const expDate = new Date((data.expires_at || Math.floor(Date.now() / 1000) + 3600) * 1000)
        .toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta' });
      console.log(`\x1b[32m[AUTH] Access Token berhasil diperbarui otomatis! (Aktif hingga ${expDate} WIB)\x1b[0m`);
      return true;
    }
  } catch (error) {
    console.log(`\x1b[31m[AUTH ERROR] Exception saat refresh token: ${error.message}\x1b[0m`);
  }

  return false;
}

/**
 * Memastikan token yang digunakan masih valid sebelum request dijalankan
 */
export async function ensureValidToken() {
  if (isTokenExpired(CONFIG.BEARER_TOKEN, 5)) {
    await refreshSession();
  }
}
