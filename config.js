// Auto-load .env file jika tersedia di Node.js 20.6+
try {
  process.loadEnvFile?.();
} catch {
  // Abaikan error jika file .env belum dibuat
}

export const CONFIG = {
  BASE_URL: 'https://ydvdknhjrdjyfjbuobvi.supabase.co',
  USER_ID: process.env.USER_ID || '',

  // Isi langsung string di bawah ini atau melalui file .env
  ANON_KEY: process.env.SUPABASE_ANON_KEY || 'YOUR_SUPABASE_ANON_KEY',
  BEARER_TOKEN: process.env.USER_BEARER_TOKEN || 'YOUR_USER_BEARER_TOKEN',
  REFRESH_TOKEN: process.env.REFRESH_TOKEN || '',

  // Konfigurasi jeda waktu acak per request (milidetik)
  DELAY: {
    MIN_MS: 1500,
    MAX_MS: 3000
  },

  // Helper untuk generate headers standar
  getHeaders() {
    return {
      'apikey': this.ANON_KEY,
      'authorization': `Bearer ${this.BEARER_TOKEN}`,
      'origin': 'https://www.kiedex.app',
      'referer': 'https://www.kiedex.app/',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
      'x-client-info': 'supabase-js-web/2.106.2',
      'x-supabase-api-version': '2024-01-01',
      'content-profile': 'public',
      'content-type': 'application/json'
    };
  }
};
