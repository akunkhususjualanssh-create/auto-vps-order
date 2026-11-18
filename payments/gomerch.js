'use strict';
/*
 * payments/gomerch.js — Integrasi GoMerch (GoPay) QRIS dinamis.
 * Docs: https://qris.adijayavpnpedia.cloud/gomerch/
 * Alur: generate QRIS (static QR + nominal unik) -> polling mutasi (SETTLEMENT,
 * cocok nominal + waktu) -> PAID. Refresh token otomatis saat 401.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { db, updateOrder } = require('../lib/db');

const BASE_URL = 'https://qris.adijayavpnpedia.cloud';
const CFG = {
  MERCHANT_ID: process.env.GOMERCH_MERCHANT_ID || '',
  ACCESS_TOKEN: process.env.GOMERCH_ACCESS_TOKEN || '',
  REFRESH_TOKEN: process.env.GOMERCH_REFRESH_TOKEN || '',
  STATIC_QR: process.env.GOMERCH_STATIC_QR || '',
  PAY_TIMEOUT_MIN: parseInt(process.env.PAY_TIMEOUT_MIN || '15', 10),
  POLL_MS: 30000, // interval cek mutasi global
};

const state = {
  accessToken: CFG.ACCESS_TOKEN,
  refreshToken: CFG.REFRESH_TOKEN,
  merchantId: CFG.MERCHANT_ID,
};

async function post(pathx, body, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(BASE_URL + pathx, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch (e) { data = { raw: text.slice(0, 300) }; }
    return { status: res.status, data };
  } finally { clearTimeout(t); }
}

async function refreshToken() {
  if (!state.refreshToken) return false;
  try {
    const { data } = await post('/gomerch/api/auth/refresh', { refresh_token: state.refreshToken });
    if (data && data.success && data.data && data.data.access_token) {
      state.accessToken = data.data.access_token;
      if (data.data.refresh_token) state.refreshToken = data.data.refresh_token;
      persistTokens();
      console.log('[GOMERCH] Token di-refresh OK');
      return true;
    }
  } catch (e) { /* abaikan */ }
  return false;
}

// Simpan token terbaru ke .env biar bot restart tidak kehilangan sesi
function persistTokens() {
  try {
    const envPath = path.join(__dirname, '..', '.env');
    let env = '';
    try { env = fs.readFileSync(envPath, 'utf8'); } catch (e) {}
    const setVar = (src, name, val) => {
      const re = new RegExp('^' + name + '=.*$', 'm');
      if (re.test(src)) return src.replace(re, name + '=' + val);
      return src.trimEnd() + '\n' + name + '=' + val + '\n';
    };
    env = setVar(env, 'GOMERCH_ACCESS_TOKEN', state.accessToken || '');
    env = setVar(env, 'GOMERCH_REFRESH_TOKEN', state.refreshToken || '');
    fs.writeFileSync(envPath, env);
  } catch (e) { /* abaikan */ }
}
const fs = require('fs');

/* Nominal unik: tambah 100-200 agar mutasi bisa dicocokkan unik */
function uniqueAmount(base) {
  const n = 100 + Math.floor(Math.random() * 101);
  return { unique: Math.floor(base) + n, suffix: n };
}

/* Generate QRIS dinamis utk satu order */
async function createInvoice(order) {
  if (!CFG.STATIC_QR || !state.accessToken) {
    return { ok: false, reason: 'Kredensial GoMerch belum lengkap di .env' };
  }
  const { unique } = uniqueAmount(order.total);
  try {
    const { status, data } = await post('/gomerch/api/qris/generate', {
      amount: unique, static_qr: CFG.STATIC_QR,
    });
    if (status === 401) {
      const ok = await refreshToken();
      if (ok) return createInvoice(order);
      return { ok: false, reason: 'Token expired & gagal refresh' };
    }
    // Respons umum: { success, data: { qris_string | qr_string | qr_url } }
    const qr = (data && (data.qris_string || data.qr_string || (data.data && (data.data.qris_string || data.data.qr_string)))) || null;
    if (qr) return { ok: true, uniqueAmount: unique, qrString: qr };
    return { ok: false, reason: (data && (data.message || data.raw)) || 'respons QRIS tidak dikenal' };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

/* Ambil mutasi hari ini (auto refresh token saat 401) */
async function getMutasi() {
  const d = new Date();
  const s = new Date(d); s.setHours(0, 0, 0, 0);
  const e = new Date(d); e.setHours(23, 59, 59, 999);
  const body = {
    access_token: state.accessToken,
    merchant_id: state.merchantId,
    start_time: s.toISOString(),
    end_time: e.toISOString(),
  };
  let { status, data } = await post('/gomerch/api/mutasi', body);
  if (status === 401) {
    if (await refreshToken()) {
      body.access_token = state.accessToken;
      ({ data } = await post('/gomerch/api/mutasi', body));
    } else return { success: false, message: 'token expired' };
  }
  if (data && data.success) return data;
  return { success: false, message: (data && (data.message || data.raw)) || 'mutasi gagal' };
}

/* Cek pembayaran satu order: cocokkan nominal unik + waktu >= dibuat + SETTLEMENT */
async function checkPayment(order) {
  if (!order.unique_amount) return 'SKIP';
  try {
    const data = await getMutasi();
    if (!data.success) return 'ERROR';
    const txs = data.data && data.data.transactions;
    if (!Array.isArray(txs)) return 'ERROR';
    const expected = Math.floor(order.unique_amount);
    const tStart = order.created_at;
    const match = txs.find(t => {
      const amount = Math.floor(t.gross_amount || 0);
      const time = new Date(t.transaction_time).getTime();
      return amount === expected && time >= tStart && t.transaction_status === 'SETTLEMENT';
    });
    return match ? 'PAID' : 'UNPAID';
  } catch (e) {
    return 'ERROR';
  }
}

const ready = () => !!(CFG.STATIC_QR && state.accessToken && state.merchantId);
module.exports = { createInvoice, checkPayment, ready, CFG, state };
