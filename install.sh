#!/bin/bash
# ============================================================
#  GEN SSH STORE — Installer Interaktif Bot Auto Order VPS
#  Pakai: git clone <repo> && cd auto-vps-order && bash install.sh
#  Installer nanya semua data (token, admin, QRIS) lalu bot langsung jalan.
# ============================================================
set -e
cd "$(dirname "$0")"

C_G='\033[1;32m'; C_Y='\033[1;33m'; C_R='\033[1;31m'; C_N='\033[0m'
ask() { # ask "pertanyaan" "default" -> jawaban di $REPLY
  local q="$1" def="$2"
  if [ -n "$def" ]; then read -rp "$(printf "${C_G}➜${C_N} %s [${C_Y}%s${C_N}]: " "$q" "$def")" REPLY; REPLY="${REPLY:-$def}"
  else read -rp "$(printf "${C_G}➜${C_N} %s: " "$q")" REPLY; fi
}
ask_secret() {
  read -rsp "$(printf "${C_G}➜${C_N} %s (tersembunyi): " "$1")" REPLY; echo; REPLY="${REPLY:-$2}"
}
ok()   { printf "${C_G}✅${C_N} %s\n" "$1"; }
warn() { printf "${C_Y}⚠️${C_N} %s\n" "$1"; }
err()  { printf "${C_R}❌${C_N} %s\n" "$1"; exit 1; }

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║   👑 GEN SSH STORE — INSTALLER BOT           ║"
echo "║   Bot Telegram Auto Order VPS                ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# ---------- 1. Instalasi dependency sistem ----------
echo "━━━ 1/5 Instalasi sistem ━━━"
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg zbar-tools >/dev/null 2>&1 || warn "zbar-tools gagal — input QRIS lewat string/gambar mungkin terbatas"
ok "curl, ca-certificates, zbar-tools (QR decoder)"

if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -dv -f2 | cut -d. -f1)" -lt 22 ]; then
  echo "   Node.js < 22 / belum ada, menginstal Node 22 LTS..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null 2>&1
  apt-get install -y -qq nodejs >/dev/null 2>&1
fi
ok "Node.js $(node -v)"

if ! command -v pm2 >/dev/null 2>&1; then npm install -g pm2 >/dev/null 2>&1; fi
ok "PM2 $(pm2 -v)"

# ---------- 2. Data bot ----------
echo ""
echo "━━━ 2/5 Data Bot Telegram ━━━"
ask "BOT_TOKEN (dari @BotFather)" ""
BOT_TOKEN="$REPLY"
while [ -z "$BOT_TOKEN" ] || [ "$BOT_TOKEN" = "ISI_TOKEN_DARI_BOTFATHER" ]; do
  err "BOT_TOKEN wajib diisi!"; ask "BOT_TOKEN" ""; BOT_TOKEN="$REPLY"
done

ask "ADMIN_ID (Telegram ID lo, dari @userinfobot)" ""
ADMIN_ID="$REPLY"
while ! [[ "$ADMIN_ID" =~ ^[0-9]+$ ]]; do
  err "ADMIN_ID harus angka (Telegram ID)!"; ask "ADMIN_ID" ""; ADMIN_ID="$REPLY"
done

ask "Nama toko" "GEN SSH STORE"
STORE_NAME="$REPLY"

# ---------- 3. Data QRIS GoMerch ----------
echo ""
echo "━━━ 3/5 Pembayaran GoMerch (GoPay) ━━━"
echo "   (bisa dilewati dulu — bot akan jalan mode MANUAL/ACC admin,"
echo "    kredensial bisa diisi nanti di file .env)"
echo ""
ask "GOMERCH_MERCHANT_ID   (kosongkan jika belum ada)" ""
GOMERCH_MERCHANT_ID="$REPLY"
ask_secret "GOMERCH_ACCESS_TOKEN" ""; GOMERCH_ACCESS_TOKEN="$REPLY"
ask_secret "GOMERCH_REFRESH_TOKEN" ""; GOMERCH_REFRESH_TOKEN="$REPLY"

echo ""
echo "   QRIS statis: pilih cara input"
echo "   1) Tempel STRING QRIS  (pindai teks panjang yg mulai 000201...)"
echo "   2) Pilih file GAMBAR QRIS (png/jpg — bot auto-decode)"
echo "   3) Lewati dulu (isi nanti di .env)"
read -rp "$(printf "${C_G}➜${C_N} Pilih [1/2/3]: ")" QR_MODE
GOMERCH_STATIC_QR=""
case "$QR_MODE" in
  1)
    echo "   Tempel string QRIS, Enter dua kali kalau sudah selesai:"
    GOMERCH_STATIC_QR=$(head -n 100 | tr -d '\n' | tr -d '[:space:]')
    ;;
  2)
    ask "Path file gambar QRIS di VPS ini (mis: /root/qris.png)" ""
    QIMG="$REPLY"
    if [ -f "$QIMG" ]; then
      GOMERCH_STATIC_QR=$(zbarimg -q --raw "$QIMG" 2>/dev/null | head -n1 | tr -d '[:space:]')
      [ -n "$GOMERCH_STATIC_QR" ] && ok "QR terbaca: ${GOMERCH_STATIC_QR:0:40}..." || warn "QR tidak terbaca — isi manual nanti di .env"
    else
      warn "File tidak ada — QRIS dilewati."
    fi
    ;;
esac

if [ -n "$GOMERCH_MERCHANT_ID" ] && [ -n "$GOMERCH_ACCESS_TOKEN" ] && [ -n "$GOMERCH_STATIC_QR" ]; then
  MODE="GOMERCH OTOMATIS ✅"
else
  MODE="MANUAL (ACC admin) — kredensial belum lengkap"
  warn "Mode pembayaran: $MODE"
fi

# ---------- 4. Tulis .env ----------
echo ""
echo "━━━ 4/5 Menyimpan konfigurasi (.env) ━━━"
ENV_PATH=".env"
if [ -f "$ENV_PATH" ]; then
  cp "$ENV_PATH" ".env.backup.$(date +%s)"
  warn ".env lama dibackup"
fi
cat > "$ENV_PATH" <<EOF
# ==== BOT TELEGRAM ====
BOT_TOKEN=$BOT_TOKEN
ADMIN_ID=$ADMIN_ID
STORE_NAME=$STORE_NAME

# ==== PEMBAYARAN GOMERCH (GoPay) ====
GOMERCH_MERCHANT_ID=$GOMERCH_MERCHANT_ID
GOMERCH_ACCESS_TOKEN=$GOMERCH_ACCESS_TOKEN
GOMERCH_REFRESH_TOKEN=$GOMERCH_REFRESH_TOKEN
GOMERCH_STATIC_QR=$GOMERCH_STATIC_QR
PAY_TIMEOUT_MIN=15
PAYMENT_INFO=Hubungi admin untuk pembayaran.
EOF
chmod 600 "$ENV_PATH"
ok ".env tersimpan (permission 600, aman)"

# ---------- 5. Install & start ----------
echo ""
echo "━━━ 5/5 Instalasi package & start bot ━━━"
npm install --no-audit --no-fund >/dev/null 2>&1 || npm install
ok "Dependency terpasang"

pm2 delete gen-ssh-store >/dev/null 2>&1 || true
pm2 start index.js --name gen-ssh-store --time
pm2 save >/dev/null 2>&1
pm2 startup 2>/dev/null | tail -1 >/dev/null || true
ok "Bot jalan + auto start saat VPS reboot"

# Verifikasi bot hidup
sleep 3
if pm2 status gen-ssh-store 2>/dev/null | grep -q online; then
  ok "Status: ONLINE — mode: $MODE"
else
  err "Bot gagal start — lihat: pm2 logs gen-ssh-store"
fi

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║   🎉 INSTALASI SELESAI!                      ║"
echo "╚══════════════════════════════════════════════╝"
echo "   Buka bot Telegram lo → /start → gas order!"
echo ""
echo "   Perintah penting:"
echo "     pm2 logs gen-ssh-store   ← lihat log"
echo "     bash restart.sh          ← restart"
echo "     bash stop.sh             ← stop"
echo "     nano .env                ← ubah konfigurasi"
echo ""
