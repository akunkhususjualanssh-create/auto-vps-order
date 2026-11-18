#!/bin/bash
# ============================================================
#  GEN SSH STORE — INSTALLER SATU PERINTAH (remote)
#  Jalankan di VPS:
#    bash <(curl -fsSL https://raw.githubusercontent.com/akunkhususjualanssh-create/auto-vps-order/main/installer.sh)
#  atau:
#    wget -q -O /root/install-bot.sh https://raw.githubusercontent.com/akunkhususjualanssh-create/auto-vps-order/main/installer.sh && bash /root/install-bot.sh
# ============================================================
set -e
REPO="https://github.com/akunkhususjualanssh-create/auto-vps-order.git"
DIR="/root/auto-vps-order"
C_G='\033[1;32m'; C_Y='\033[1;33m'; C_N='\033[0m'
ok() { printf "${C_G}✅${C_N} %s\n" "$1"; }

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  👑 GEN SSH STORE — INSTALL BOT VPS           ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

echo "[1/3] Cek dependency..."
apt-get update -qq
apt-get install -y -qq git curl ca-certificates gnupg zbar-tools >/dev/null 2>&1 || true
ok "git, curl, zbar-tools"

echo "[2/3] Ambil source dari GitHub..."
if [ -d "$DIR/.git" ]; then
  cd "$DIR"
  git fetch origin >/dev/null 2>&1 && git reset --hard origin/main >/dev/null 2>&1 || { echo "Gagal update repo"; exit 1; }
  ok "Repo di-update (data & .env tetap aman)"
else
  rm -rf "$DIR"
  git clone -q "$REPO" "$DIR" || { echo "Gagal clone repo"; exit 1; }
  ok "Repo ter-clone ke $DIR"
fi
cd "$DIR"

echo "[3/3] Jalankan installer interaktif..."
echo "$(printf "${C_Y}Sekarang jawab pertanyaan (BOT_TOKEN, ADMIN_ID, QRIS)${C_N}")"
echo ""
# Jalankan sebagai FILE (bukan pipe) supaya stdin interaktif tetap hidup
exec bash "$DIR/install.sh"
