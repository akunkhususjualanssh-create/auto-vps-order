#!/bin/bash
# Start bot via PM2
cd "$(dirname "$0")"
if ! command -v pm2 >/dev/null 2>&1; then npm install -g pm2 >/dev/null 2>&1; fi
pm2 start index.js --name gen-ssh-store --time || pm2 restart gen-ssh-store
pm2 save
echo "✅ Bot dijalankan. Lihat log: pm2 logs gen-ssh-store"
