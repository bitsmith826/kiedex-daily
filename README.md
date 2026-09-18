# Kiedex Daily Fetcher & All-in-One Automation

Automasi multi-akun harian untuk platform Kiedex (Supabase backend) menggunakan Node.js (ESM native `fetch`).

> [!WARNING]
> **DISCLAIMER / PERNYATAAN EDUKASI:**  
> Proyek dan kode dalam repositori ini dibuat murni untuk **tujuan edukasi, pembelajaran pemrograman automasi Node.js, eksplorasi REST/RPC API Supabase, dan riset teknologi Web3**.  
> Penulis/kontributor tidak bertanggung jawab atas segala kerugian finansial, penalti, pemblokiran akun, atau dampak apa pun yang mungkin timbul akibat penggunaan skrip ini. Segala risiko sepenuhnya ditanggung oleh masing-masing pengguna (**Use at your own risk**).

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
git clone https://github.com/bitsmith826/kiedex-daily.git
cd kiedex-daily
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

> [!TIP]
> **Cara Mendapatkan `refresh_token` dari Browser:**
> 1. Buka dan login ke website [kiedex.app](https://www.kiedex.app/) di browser (Chrome / Edge / Brave).
> 2. Tekan tombol **F12** (atau klik kanan $\rightarrow$ **Inspect**) untuk membuka Developer Tools.
> 3. Buka tab **Application** (atau **Penyimpanan / Storage** di Firefox).
> 4. Di menu sebelah kiri, pilih **Local Storage** $\rightarrow$ `https://www.kiedex.app`.
> 5. Cari item dengan nama key berawalan `sb-...-auth-token`.
> 6. Di dalam value JSON-nya, cari teks `"refresh_token": "xxxx"`.
> 7. Salin kode token tersebut (string ~12-16 karakter) dan tempel ke `accounts.json`.
>
> *Catatan: Anda **tidak perlu** menyalin Bearer token yang panjang. Bot akan otomatis menghasilkan Bearer token baru secara otomatis dari `refresh_token`.*

### 4. Menjalankan Bot
Cukup jalankan satu perintah berikut:
```bash
npm start
```
Bot akan otomatis membersihkan layar konsol, memproses seluruh akun satu per satu dengan jeda waktu yang aman, dan menampilkan tabel rekapitulasi di akhir.

---

## 🔒 Keamanan & Data Pribadi

Repository ini sudah dilengkapi dengan `.gitignore` ketat:
* File `accounts.json` dan `accounts.backup.json` (berisi token dan email Anda) **TIDAK AKAN** pernah terunggah ke Git.
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
