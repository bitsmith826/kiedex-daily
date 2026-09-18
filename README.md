# Kiedex Daily Fetcher & All-in-One Automation

Automasi multi-akun harian untuk platform Kiedex (Supabase backend) menggunakan Node.js (ESM native `fetch`).

---

## ⚡ Fitur Utama

1. **All-in-One Automation (`npm start`)**:
   - 🔄 **Auto Token Rotation & Sync**: Cukup masukkan `refresh_token`, sistem otomatis mengambil token akses baru, mengisi info profil/email, dan menyimpan status token terbaru.
   - 🎁 **Daily Faucet & Oil Claim**: Otomatis klaim jatah harian Faucet USDT dan Oil.
   - 💸 **Smart Balance Transfer**: Otomatis memindahkan saldo dari Spot ke Futures ($50 USDT) jika saldo Futures di bawah batas minimal.
   - 📈 **Automated Futures Mission Trading (t1 - t4)**:
     - 5 siklus order Futures BTCUSDT otomatis dengan leverage 10x ($25 margin = $250 volume per order $\rightarrow$ total $1.250 volume harian).
     - Memenuhi syarat minimal durasi hold (`min_hold_seconds: 10`).
     - **Smart Take-Profit Sniping**: Memantau pergerakan harga pasar real-time untuk mengunci profit sebelum menutup posisi.
     - **Anti-Cooldown Detector**: Deteksi otomatis rate-limit database (`P0001` / delay 2 detik) dengan backoff retry otomatis.
   - 🎯 **Auto-Claim Daily Quests**: Mengklaim otomatis reward misi airdrop harian (`t1`, `t3`, `t4`).
   - 📊 **Clean ASCII Summary Dashboard**: Tampilan visual terminal simetris dengan ringkasan saldo terkini dan status seluruh akun.

2. **Modular Standalone Scripts**:
   - `node spot_trader.js` : Trading Spot (Beli $\rightarrow$ Hold $\rightarrow$ Jual) atau fitur `--sell-all`.
   - `node futures_trader.js` : Trading Futures independen atau transfer manual (`--transfer=spot:futures:50`).
   - `node auto_missions.js` : Pengecekan dan klaim misi terpisah.

---

## 🚀 Panduan Instalasi & Penggunaan

### 1. Prasyarat
- Node.js versi 18.0.0 atau lebih tinggi (rekomendasi Node.js v20+).

### 2. Clone Repository
```bash
git clone https://github.com/USERNAME/REPO_NAME.git
cd REPO_NAME
```

### 3. Konfigurasi Akun
Salin template konfigurasi akun:
```bash
# Windows PowerShell
copy accounts.example.json accounts.json

# Linux / MacOS / Pterodactyl
cp accounts.example.json accounts.json
```

Buka file `accounts.json` dan masukkan nama serta `refresh_token` akun Kiedex Anda:
```json
[
  {
    "name": "Akun 1",
    "refresh_token": "masukkan_refresh_token_di_sini"
  },
  {
    "name": "Akun 2",
    "refresh_token": "masukkan_refresh_token_di_sini"
  }
]
```

> [!NOTE]
> Anda **tidak perlu memasukkan Bearer token** yang panjang. Cukup `refresh_token` saja. Saat dijalankan, bot akan otomatis melengkapi email, ID akun, dan merotasi token baru ke file ini.

### 4. Menjalankan Bot
Cukup jalankan satu perintah berikut:
```bash
npm start
```
Bot akan otomatis membersihkan layar konsol, memproses seluruh akun satu per satu dengan jeda waktu yang aman, dan menampilkan tabel rekapitulasi di akhir.

---

## 🔒 Keamanan & Data Pribadi

Repository ini sudah dilengkapi dengan `.gitignore` ketat:
* File `accounts.json` dan `accounts.backup.json` (berisi token dan email Anda) **TIDAK AKAN** pernah terunggah ke GitHub.
* File `.env` (jika digunakan) juga diabaikan oleh Git.

---

## 🛠️ Perintah Tambahan (Opsional)

* **Jalankan Trading Spot Manual:**
  ```bash
  node spot_trader.js --pair=BTCUSDT --amount=10 --cycles=3
  ```
* **Jual Semua Aset Spot yang Dipegang:**
  ```bash
  node spot_trader.js --sell-all
  ```
* **Transfer Saldo Spot ke Futures:**
  ```bash
  node futures_trader.js --transfer=spot:futures:50
  ```
* **Transfer Saldo Futures ke Spot:**
  ```bash
  node futures_trader.js --transfer=futures:spot:50
  ```
