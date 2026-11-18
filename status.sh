#!/bin/bash
pm2 status
echo "--- Log terakhir ---"
pm2 logs gen-ssh-store --lines 20 --nostream
