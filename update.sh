#!/bin/bash
# ============================================================
#  GEN SSH STORE — UPDATE BOT (aman: data & .env tidak disentuh)
#  Jalankan di VPS:
#    bash <(curl -fsSL https://raw.githubusercontent.com/akunkhususjualanssh-create/bot-auto-order-vps/main/update.sh)
#  atau:
#    wget -q -O /root/update-bot.sh https://raw.githubusercontent.com/akunkhususjualanssh-create/bot-auto-order-vps/main/update.sh && bash /root/update-bot.sh
# ============================================================
set -e
DIR="/root/bot-auto-order-vps"
C_G='\033[1;32m'; C_Y='\033[1;33m'; C_R='\033[1;31m'; C_N='\033[0m'
ok() { printf "${C_G}✅${C_N} %s\n" "$1"; }
warn() { printf "${C_Y}⚠️${C_N} %s\n" "$1"; }
err() { printf "${C_R}❌${C_N} %s\n" "$1"; exit 1; }

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  👑 GEN SSH STORE — UPDATE BOT                ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

[ -d "$DIR/.git" ] || err "Bot belum terinstall di $DIR. Jalankan installer dulu."
cd "$DIR"

echo "[1/5] Cek dependency..."
command -v git >/dev/null 2>&1 || apt-get install -y -qq git >/dev/null 2>&1
command -v node >/dev/null 2>&1 || err "Node.js belum ada. Jalankan installer dulu."
ok "Node $(node -v)"

echo "[2/5] Backup .env & database..."
BK="/root/bot-backup-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BK"
[ -f .env ] && cp .env "$BK/.env"
[ -d data ] && cp -r data "$BK/data"
ok "Backup di $BK"

echo "[3/5] Tarik kode terbaru dari GitHub..."
git fetch origin >/dev/null 2>&1 || err "Gagal hubungi GitHub (cek koneksi)."
git reset --hard origin/main >/dev/null 2>&1 || err "Gagal update kode."
ok "Kode terbaru: $(git log -1 --pretty=%s | cut -c1-60)"

echo "[4/5] Install dependency..."
rm -rf node_modules package-lock.json
npm install --no-audit --no-fund >/dev/null 2>&1 || npm install
ok "Dependency terpasang"

echo "[5/5] Restart bot..."
if pm2 describe gen-ssh-store >/dev/null 2>&1; then
  pm2 restart gen-ssh-store --update-env >/dev/null 2>&1
else
  pm2 start index.js --name gen-ssh-store --time >/dev/null 2>&1
fi
pm2 save >/dev/null 2>&1
sleep 4

if pm2 status gen-ssh-store 2>/dev/null | grep -q online; then
  ok "Bot ONLINE"
  echo ""
  echo "--- log terakhir ---"
  pm2 logs gen-ssh-store --lines 8 --nostream 2>/dev/null | tail -10
else
  err "Bot gagal start — cek: pm2 logs gen-ssh-store --lines 30 --nostream"
fi

echo ""
echo "$(printf "${C_G}🎉 UPDATE SELESAI${C_N}") — data pelanggan & konfigurasi aman."
echo "   Rollback kalau perlu: cp -r $BK/.env $DIR/.env && cp -r $BK/data $DIR/data"
echo ""
