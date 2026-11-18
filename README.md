# 👑 GEN SSH STORE — Bot Telegram Auto Order VPS

Bot toko VPS otomatis: pelanggan pilih paket → bayar (QRIS GoPay otomatis) → bot kirim data VPS (IP, user, password) langsung ke chat. **Stok dihitung otomatis** dari jumlah unit VPS yang admin tambahkan — tidak ada input stok manual.


---

## ⚡ INSTALASI CEPAT (SATU PERINTAH)

**Install bot (interaktif — nanya BOT_TOKEN, ADMIN_ID, QRIS):**
```bash
bash <(curl -fsSL https://raw.githubusercontent.com/akunkhususjualanssh-create/bot-auto-order-vps/main/installer.sh)
```
atau:
```bash
wget -q -O /root/install-bot.sh https://raw.githubusercontent.com/akunkhususjualanssh-create/bot-auto-order-vps/main/installer.sh && bash /root/install-bot.sh
```

**Update bot (tanpa hilang data & .env):**
```bash
bash <(curl -fsSL https://raw.githubusercontent.com/akunkhususjualanssh-create/bot-auto-order-vps/main/update.sh)
```
atau:
```bash
wget -q -O /root/update-bot.sh https://raw.githubusercontent.com/akunkhususjualanssh-create/bot-auto-order-vps/main/update.sh && bash /root/update-bot.sh
```

---

## A. PENDAHULUAN

**GEN SSH STORE** adalah bot jualan VPS otomatis di Telegram.

**Fitur:**
- 💻 Order VPS 4 langkah (produk → detail → konfirmasi → bayar)
- 📊 Stok otomatis: 1 data VPS di-add admin = stok +1
- 🔐 Anti double-sell: unit di-reserve & dikunci saat order dibuat
- 💳 Payment QRIS GoMerch (GoPay) otomatis + fallback manual (ACC admin)
- 📨 Kirim VPS otomatis setelah pembayaran terverifikasi (pin pesan + retry)
- 👑 Panel admin: add/edit/delete produk, kelola stok, list user, broadcast
- 🛡 Keamanan: password VPS tidak tampil di menu publik, hanya pembayar yang terima

**Cara kerja:** Admin menambahkan data unit VPS (IP, user, pass, spec, harga) → bot mengelompokkan unit yang spec/harganya sama jadi 1 produk → stok = jumlah unit yang belum terjual → pelanggan order → unit di-reserve → bayar → bot verifikasi → kirim unit yang di-reserve → stok berkurang 1.

---

## B. PERSYARATAN VPS

- OS: **Ubuntu 20.04/22.04/24.04** atau **Debian 11/12**
- RAM minimal **512 MB** (rekomendasi 1 GB)
- Koneksi internet aktif
- Akses **root** VPS (SSH)
- **Bukan** Pterodactyl / Docker / panel — jalan langsung di terminal VPS

## C. PERSIAPAN

**1. Buat bot Telegram:**
- Chat [@BotFather](https://t.me/BotFather) → kirim `/newbot` → beri nama → salin **BOT_TOKEN**

**2. Dapatkan Telegram ID:**
- Chat [@userinfobot](https://t.me/userinfobot) → salin **Id** (ini ADMIN_ID)

**3. Kredensial payment GoMerch (GoPay):**
- Buka https://qris.adijayavpnpedia.cloud/gomerch/
- STEP 1: isi nomor HP merchant GoBiz → **Kirim OTP** → masukkan OTP → dapatkan `access_token`, `refresh_token`, `merchant_id`
- Siapkan **QRIS statis** (string QR atau scan QRIS statis kamu) → `GOMERCH_STATIC_QR`

---

## D. INSTALASI (dari nol)

```bash
# 1. Login VPS
ssh root@IP_VPS

# 2. Upload source (contoh via scp, dari komputer lo)
scp BOT_AUTO_ORDER_VPS.zip root@IP_VPS:/root/

# 3. Di VPS: extract
apt update && apt install -y unzip
unzip BOT_AUTO_ORDER_VPS.zip -d /root/bot
cd /root/bot

# 4. Jalankan installer (instal Node.js 20, PM2, dependency, auto start)
bash install.sh

# 5. Isi konfigurasi
nano .env
# isi minimal:
#   BOT_TOKEN=token dari BotFather
#   ADMIN_ID=telegram id lo
#   GOMERCH_MERCHANT_ID / ACCESS_TOKEN / REFRESH_TOKEN / STATIC_QR
# simpan: CTRL+O, Enter, CTRL+X

# 6. Jalankan bot
bash restart.sh
```

> **Tanpa kredensial GoMerch?** Bot jalan dalam **mode manual**: pelanggan klik "Sudah Bayar" → admin terima notifikasi → ACC → VPS terkirim otomatis. Gateway bisa diaktifkan kapan saja cukup isi `.env` lalu `bash restart.sh`.

---

## E. DATABASE

- Lokasi: `data/store.db` (SQLite, tersimpan permanen, aman saat restart)
- **Backup:**
  ```bash
  cp data/store.db backup-$(date +%F).db
  ```
- **Restore:**
  ```bash
  pm2 stop gen-ssh-store
  cp backup-2026-11-18.db data/store.db
  pm2 restart gen-ssh-store
  ```
- Riwayat transaksi ada di tabel `orders` (bisa dilihat via panel admin / sqlite3)

## F. MENJALANKAN BOT

```bash
bash start.sh      # mulai bot
bash stop.sh       # hentikan
bash restart.sh    # restart (wajib setelah edit .env)
bash status.sh     # cek status + log terakhir
pm2 logs gen-ssh-store          # lihat log langsung
pm2 logs gen-ssh-store --lines 50
pm2 save && pm2 startup        # auto start saat VPS reboot (sudah dijalankan installer)
```

## G. PANDUAN ADMIN

Buka bot → `/admin` (hanya ADMIN_ID).

- **📦 ADD PRODuk** → bot tanya 12 data (nama, IP, port, user, pass, OS, RAM, CPU, disk, masa aktif, bandwidth, harga) → konfirmasi → SIMPAN → **stok otomatis +1**
- Tambah 5 unit? Jalankan ADD PRODUK 5× (atau duplikat data, IP beda). Unit spec+harga+masa aktif sama otomatis masuk produk yang sama.
- **🗑️ DELETE PRODUK** → hapus produk; produk yang punya unit terjual tidak boleh dihapus (pake HAPUS UNIT untuk satuan)
- **📝 EDIT PRODUK** → pilih produk → pilih unit → ketik perubahan `field: nilai` (contoh `ip: 103.1.2.3`, `price: 30000`)
- **📊 KELOLA STOK** → TAMBAH STOK (→ ADD PRODUK), KURANGI STOK (hapus unit belum terjual), CEK STOK, DAFTAR VPS TERSEDIA, HAPUS UNIT
- **📋 LIST USER** → semua pengguna + jumlah transaksi
- **📢 BROADCAST** → teks / teks+gambar / gambar saja, laporan berhasil-gagal, anti flood

## H. PANDUAN PELANGGAN

1. `/start` → menu utama
2. **💻 ORDER VPS** → pilih paket (lihat stok & harga)
3. Lihat detail spesifikasi → **✅ LANJUTKAN**
4. Konfirmasi pesanan → **✅ KONFIRMASI PESANAN**
5. Scan QRIS yang dikirim bot (nominal ada kode unik)
6. Bot cek otomatis → begitu lunas, data VPS (IP/user/pass) dikirim + dipin

## I. KONFIGURASI PAYMENT

- Semua di `.env`: `GOMERCH_MERCHANT_ID`, `GOMERCH_ACCESS_TOKEN`, `GOMERCH_REFRESH_TOKEN`, `GOMERCH_STATIC_QR`
- Tidak perlu webhook — bot **polling mutasi** tiap 30 detik, cocokkan nominal unik + status SETTLEMENT
- **Menguji:** order paket termurah → bayar via GoPay → tunggu max 30 detik → VPS harus terkirim
- Token expired? Bot **refresh otomatis** dan menyimpan token baru ke `.env`
- Kalau gagal verifikasi >15 menit → order expired, unit kembali ke stok

## J. TROUBLESHOOTING

| Masalah | Solusi |
|---|---|
| Bot tidak merespons | `bash status.sh` → kalau stopped: `bash start.sh`. Cek `pm2 logs` |
| Bot berhenti sendiri | PM2 auto-restart. Kalau crash berulang, cek log: biasanya `.env` salah |
| Token salah / 401 unauthorized | BOT_TOKEN salah, atau token GoMerch expired → login ulang di dashboard GoMerch, update `.env`, `bash restart.sh` |
| Database error | `sqlite3 data/store.db "PRAGMA integrity_check;"` — jika rusak, restore dari backup |
| Payment tidak terdeteksi | Pastikan nominal terbayar **persis sama** (ada kode unik +100–200). Cek mutasi di dashboard merchant |
| VPS tidak terkirim | Bot retry 5× otomatis. Cek `pm2 logs`. Order `paid` yang belum terkirim diproses ulang saat bot start |
| Stok tidak berkurang | Stok hanya berkurang setelah payment PAID & ACC. Cek status order di panel admin |
| Tidak jalan setelah reboot | `pm2 save` lalu `pm2 startup` (jalankan sekali sebagai root) |

## K. KEAMANAN

- 🔐 **Jangan bagikan** `BOT_TOKEN`, `GOMERCH_*` — semua di `.env`
- 🛡 `chmod 600 .env` agar hanya root yang bisa baca
- 💾 Backup `data/store.db` berkala (cron: `0 2 * * * cp /root/bot/data/store.db /root/backup/`)
- 👤 Password VPS pelanggan hanya muncul di pesan pengiriman (protected content), tidak di menu
- 🚫 Jangan pernah ACC pembayaran tanpa cek mutasi/bukti transfer

## L. UPDATE BOT

```bash
pm2 stop gen-ssh-store
# timpa file source yang berubah (JANGAN hapus folder data/ dan file .env)
pm2 restart gen-ssh-store
```
Database & konfigurasi tidak terganggu karena terpisah dari source (`data/store.db` + `.env`).

---

👑 **GEN SSH STORE** — Stabil 24 jam: PM2 auto-restart, memory guard, watchdog API, graceful shutdown.
