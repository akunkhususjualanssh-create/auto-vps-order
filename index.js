'use strict';
const path = require('path');
// Muat .env dari folder bot (bukan cwd) — biar PM2 dari mana pun tetap kebaca
require('dotenv').config({ path: path.join(__dirname, '.env') });
const fs = require('fs');
const { Telegraf, Markup } = require('telegraf');
const QRCode = require('qrcode');
const D = require('./lib/db');
const pay = require('./payments/gomerch');

const CFG = {
  BOT_TOKEN: process.env.BOT_TOKEN || '',
  ADMIN_ID: String(process.env.ADMIN_ID || ''),
  STORE_NAME: process.env.STORE_NAME || 'GEN SSH STORE',
  PAY_INFO: process.env.PAYMENT_INFO || 'Transfer manual — hubungi admin.',
};
if (!CFG.BOT_TOKEN || CFG.BOT_TOKEN.startsWith('ISI_')) {
  console.error('ERROR: BOT_TOKEN belum diisi di .env'); process.exit(1);
}

const bot = new Telegraf(CFG.BOT_TOKEN, { handlerTimeout: 90000 });
const HTML = { parse_mode: 'HTML' };
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const rp = (n) => 'Rp ' + Number(n).toLocaleString('id-ID');
const dateID = (ts) => new Date(ts).toLocaleString('id-ID', { dateStyle: 'full', timeStyle: 'short', timeZone: 'Asia/Jakarta' });
const isAdmin = (id) => String(id) === CFG.ADMIN_ID;
const startedAt = Date.now();

/* ================= KEYBOARD ================= */
const homeKb = Markup.inlineKeyboard([
  [Markup.button.callback('💻 ORDER VPS', 'order')],
  [Markup.button.callback('📱 HUBUNGI ADMIN', 'contact')],
  ...(isAdmin ? [[Markup.button.callback('👑 PANEL ADMIN', 'adm')]] : []),
]);
const iB = (t, c) => Markup.button.callback(t, c);

/* ================= PANEL ORDER (STATE) ================= */
// state: userId -> { step, product, ... }
const states = new Map();
const STATE_TTL = 20 * 60 * 1000;
setInterval(() => {
  const t = Date.now();
  for (const [k, v] of states) if (t - (v._ts || 0) > STATE_TTL) states.delete(k);
}, 60 * 1000);

function showProducts(chatId, msgId) {
  const prods = D.stockSummary();
  if (!prods.length) {
    return bot.editMessageText('📭 <b>Belum ada produk VPS.</b>\n\nAdmin belum menambahkan stok. Coba lagi nanti.', { ...HTML, chat_id: chatId, message_id: msgId }).catch(() => {});
  }
  const rows = prods.map(p => {
    const habis = !p.stock;
    const label = `${habis ? '🚫' : '📦'} ${esc(p.name)} — ${rp(p.price)}${habis ? ' (SOLD OUT)' : ` (stok ${p.stock})`}`;
    return [iB(label, habis ? 'noop' : `pick:${p.id}`)];
  });
  rows.push([iB('🏠 Menu Utama', 'home')]);
  bot.editMessageText('💻 <b>ORDER VPS</b>\n\nPilih paket VPS di bawah 👇\nStok dihitung otomatis dari unit yang tersedia.',
    { ...HTML, chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: rows } }).catch(() => {});
}

function showDetail(chatId, msgId, prod) {
  const text =
    `📦 <b>${esc(prod.name)}</b>\n━━━━━━━━━━━━━━━\n` +
    `💰 Harga      : ${rp(prod.price)}\n` +
    `🧠 RAM        : ${esc(prod.ram || '-')}\n` +
    `⚙️ CPU        : ${esc(prod.cpu || '-')}\n` +
    `💾 Disk       : ${esc(prod.disk || '-')}\n` +
    `💻 OS         : ${esc(prod.os || '-')}\n` +
    `🌐 Bandwidth  : ${esc(prod.bandwidth || '-')}\n` +
    `📅 Masa aktif : ${prod.duration_days} hari\n` +
    `📊 Stok       : ${prod.stock} tersedia\n`;
  bot.editMessageText(text, { ...HTML, chat_id: chatId, message_id: msgId,
    reply_markup: Markup.inlineKeyboard([[iB('✅ LANJUTKAN', `go:${prod.id}`), iB('❌ BATALKAN', 'home')]]).reply_markup }).catch(() => {});
}

/* ================= PEMBUATAN ORDER + INVOICE ================= */
async function createOrderAndInvoice(chatId, uid, uname, prod) {
  const unit = await D.reserveUnit('TEMP', prod.id).catch(() => null);
  const payExpireMs = parseInt(process.env.PAY_TIMEOUT_MIN || '15', 10) * 60000;

  if (!unit) {
    return bot.sendMessage(chatId, '🚫 <b>Maaf, stok habis.</b> Unit terakhir baru saja terjual.', { ...HTML, reply_markup: homeKb.reply_markup });
  }

  // Buat order resmi dengan id berurutan, lalu pasang id ke unit yang di-reserve
  const id = D.createOrder({ userId: uid, userName: uname, productId: prod.id, unitId: unit.id, total: prod.price, expireMs: payExpireMs });
  D.db.prepare('UPDATE units SET order_id=? WHERE id=? AND status=?').run(id, unit.id, 'reserved');

  let invText, kbRows;
  if (pay.ready()) {
    const inv = await pay.createInvoice({ total: prod.price, created_at: Date.now() });
    if (inv.ok) {
      D.updateOrder(id, { unique_amount: inv.uniqueAmount, qr_string: inv.qrString });
      try {
        const png = await QRCode.toBuffer(inv.qrString, { width: 600, margin: 2 });
        await bot.sendPhoto(chatId, png, { caption:
          `🧾 <b>INVOICE ${id}</b>\n━━━━━━━━━━━━━━━\n📦 ${esc(prod.name)}\n💰 Total: <b>${rp(inv.uniqueAmount)}</b> (kode unik)\n⏰ Bayar sebelum: ${dateID(Date.now() + payExpireMs)}\n\n📱 Scan QRIS di atas dengan aplikasi GoPay/e-wallet.\n✅ Status dicek otomatis — VPS terkirim setelah pembayaran terverifikasi.`,
          parse_mode: 'HTML' });
      } catch (e) {
        await bot.sendMessage(chatId, `🧾 <b>INVOICE ${id}</b>\n💰 Total: <b>${rp(inv.uniqueAmount)}</b>\n\nQR string:\n<code>${esc(inv.qrString.slice(0, 300))}...</code>`, HTML);
      }
      return;
    } else {
      console.error('[INVOICE]', inv.reason);
    }
  }
  // Fallback manual (gateway belum siap)
  invText =
    `🧾 <b>INVOICE ${id}</b>\n━━━━━━━━━━━━━━━\n📦 ${esc(prod.name)}\n💰 Total: <b>${rp(prod.price)}</b>\n⏰ Bayar sebelum: ${dateID(Date.now() + payExpireMs)}\n\n💳 <b>Cara Pembayaran:</b>\n${esc(CFG.PAY_INFO)}`;
  kbRows = [[iB('✅ SUDAH BAYAR', `paid:${id}`)], [iB('❌ BATALKAN', `cancel:${id}`)]];
  bot.sendMessage(chatId, invText, { ...HTML, reply_markup: { inline_keyboard: kbRows } });
}

/* ================= PENGIRIMAN VPS ================= */
const delivery = require('./lib/delivery');
delivery.init(bot, { CFG, D, esc, rp, dateID, HTML });
async function deliverVPS(order) { return delivery.deliver(order); }

/* ================= PAYMENT POLLER (verifikasi otomatis) ================= */
async function processWaitingOrders() {
  const orders = D.waitingOrders();
  if (!orders.length) return;
  const nowT = Date.now();
  for (const o of orders) {
    if (nowT > o.expire_at) {
      // Expired: batalkan & kembalikan stok
      D.updateOrder(o.id, { status: 'expired' });
      await D.releaseUnit(o.unit_id, o.id).catch(() => {});
      bot.sendMessage(o.user_id, `⏰ Pesanan <b>${o.id}</b> kedaluwarsa (tidak dibayar). Unit dikembalikan ke stok. Silakan order ulang.`, HTML).catch(() => {});
      if (CFG.ADMIN_ID) bot.sendMessage(CFG.ADMIN_ID, `⏰ Order ${o.id} EXPIRED (unit #${o.unit_id} dikembalikan).`, HTML).catch(() => {});
      continue;
    }
    if (pay.ready()) {
      const res = await pay.checkPayment(o);
      if (res === 'PAID') {
        D.updateOrder(o.id, { status: 'paid', paid_at: Date.now() });
        await D.markSold(o.unit_id, o.id).catch(() => {});
        bot.sendMessage(o.user_id, '✅ <b>Pembayaran terverifikasi!</b>\nMengirim informasi VPS Anda...', HTML).catch(() => {});
        await deliverVPS(D.getOrder(o.id));
      }
    }
  }
}
setInterval(() => { processWaitingOrders().catch(e => console.error('[POLL]', e.message)); }, 30 * 1000);

// Recovery: order 'paid' yang belum terkirim (misal bot mati saat kirim) — retry saat boot
async function recoverPendingDeliveries() {
  const rows = D.db.prepare(`SELECT * FROM orders WHERE status='paid'`).all();
  for (const o of rows) { await deliverVPS(o).catch(() => {}); }
  if (rows.length) console.log(`[RECOVERY] ${rows.length} pengiriman tertunda diproses ulang.`);
}

/* ================= ROUTING CALLBACK USER ================= */
bot.on('callback_query', async (cq) => {
  const chatId = cq.message.chat.id, uid = cq.from.id, data = cq.data;
  const ack = (t) => bot.answerCallbackQuery(cq.id, { text: t }).catch(() => {});
  D.upsertUser(cq.from);
  const st = states.get(uid);
  try {
    if (data === 'noop') return ack('SOLD OUT 😢');
    if (data === 'home') { states.delete(uid); await bot.editMessageText(
      `👑 <b>SELAMAT DATANG DI ${esc(CFG.STORE_NAME)}</b>\n\n🏆 TEMPAT JUAL VPS MURAH DAN STABIL\n\nSilakan pilih menu di bawah ini 👇`,
      { ...HTML, chat_id: chatId, message_id: cq.message.message_id, reply_markup: homeKb.reply_markup }).catch(() => {}); return ack(); }
    if (data === 'contact') { await bot.editMessageText('📱 <b>HUBUNGI ADMIN</b>\n\n' + (CFG.ADMIN_ID ? `<a href="tg://user?id=${CFG.ADMIN_ID}">Klik di sini untuk chat admin</a>` : 'Admin belum mengatur kontak.'), { ...HTML, chat_id: chatId, message_id: cq.message.message_id, reply_markup: { inline_keyboard: [[iB('🏠 Menu', 'home')]] } }).catch(() => {}); return ack(); }
    if (data === 'order') { states.set(uid, { step: 'pick', _ts: Date.now() }); showProducts(chatId, cq.message.message_id); return ack(); }
    if (data.startsWith('pick:')) { const p = D.getProduct(+data.slice(5)); if (!p) return ack('Produk tidak ada'); states.set(uid, { step: 'detail', product: p, _ts: Date.now() }); showDetail(chatId, cq.message.message_id, { ...p, stock: D.listUnits(p.id, 'available').length }); return ack(); }
    if (data.startsWith('go:')) {
      const p = D.getProduct(+data.slice(5));
      if (!p) return ack('Produk tidak ada');
      const stock = D.listUnits(p.id, 'available').length;
      if (!stock) return ack('SOLD OUT 😢');
      await bot.editMessageText(
        `📋 <b>KONFIRMASI PESANAN</b>\n━━━━━━━━━━━━━━━\n🆔 ID Pesanan : (dibuat otomatis)\n📦 Paket : ${esc(p.name)}\n⚙️ Spec : ${esc(p.ram || '-')} RAM • ${esc(p.cpu || '-')} • ${esc(p.disk || '-')}\n💻 OS : ${esc(p.os || '-')}\n📅 Masa aktif : ${p.duration_days} hari\n💰 Harga : <b>${rp(p.price)}</b>\n📊 Stok tersedia : ${stock}\n\nTotal pembayaran: <b>${rp(p.price)}</b>`,
        { ...HTML, chat_id: chatId, message_id: cq.message.message_id, reply_markup: { inline_keyboard: [[iB('✅ KONFIRMASI PESANAN', `conf:${p.id}`)], [iB('❌ BATALKAN', 'home')]] } }).catch(() => {});
      return ack();
    }
    if (data.startsWith('conf:')) {
      const p = D.getProduct(+data.slice(5));
      if (!p) return ack('Produk tidak ada');
      await bot.editMessageText('⏳ <b>Memproses pesanan & membuat invoice...</b>', { chat_id: chatId, message_id: cq.message.message_id }).catch(() => {});
      await createOrderAndInvoice(chatId, uid, cq.from.first_name || '', p);
      return ack();
    }
    if (data.startsWith('paid:')) {
      const o = D.getOrder(data.slice(5));
      if (!o || String(o.user_id) !== String(uid) || o.status !== 'waiting') return ack('Order tidak valid');
      o.adminPending = true;
      D.updateOrder(o.id, { status: 'waiting' });
      if (CFG.ADMIN_ID) {
        const prod = D.getProduct(o.product_id);
        bot.sendMessage(CFG.ADMIN_ID, `🔔 <b>KLAIM PEMBAYARAN</b>\n🧾 ${o.id}\n👤 ${esc(cq.from.first_name || '')} (${uid})\n📦 ${esc(prod.name)}\n💰 ${rp(o.total)}\n\nCek pembayaran lalu ACC:`,
          { ...HTML, reply_markup: { inline_keyboard: [[iB('✅ ACC & KIRIM VPS', `admok:${o.id}`), iB('❌ TOLAK', `admno:${o.id}`)]] } }).catch(() => {});
      }
      return ack('Dikirim ke admin ✅');
    }
    if (data.startsWith('cancel:')) {
      const o = D.getOrder(data.slice(7));
      if (o && String(o.user_id) === String(uid) && o.status === 'waiting') {
        D.updateOrder(o.id, { status: 'cancelled' });
        await D.releaseUnit(o.unit_id, o.id).catch(() => {});
        await bot.sendMessage(chatId, `❌ Pesanan ${o.id} dibatalkan. Stok dikembalikan.`, HTML).catch(() => {});
      }
      states.delete(uid);
      return ack('Dibatalkan');
    }
    // Callback admin diproses di handlers/admin.js
    if (isAdmin(uid) && adminHook) return adminHook(cq, { ack, chatId, uid, data });
    return ack();
  } catch (e) {
    console.error('[CB]', e.message || e);
    try { await bot.sendMessage(chatId, '⚠️ Terjadi error: ' + esc(String(e.message || e).slice(0, 120))); } catch (x) {}
    ack('Error');
  }
});

let adminHook = null;
const admin = require('./handlers/admin');
adminHook = admin.init(bot, { CFG, D, esc, rp, dateID, isAdmin, iB, HTML, states, delivery });

/* ================= INPUT TEKS (admin conversation dsb) ================= */
bot.on('text', async (msg) => {
  const uid = msg.from.id, chatId = msg.chat.id, text = (msg.text || '').trim();
  D.upsertUser(msg.from);
  try {
    if (isAdmin(uid) && admin.onText) return admin.onText(msg, text);
    if (text === '/start') return bot.sendMessage(chatId,
      `👑 <b>SELAMAT DATANG DI ${esc(CFG.STORE_NAME)}</b>\n\n🏆 TEMPAT JUAL VPS MURAH DAN STABIL\n\nSilakan pilih menu di bawah ini 👇`,
      { ...HTML, reply_markup: homeKb.reply_markup });
    bot.sendMessage(chatId, '🤖 Gunakan tombol menu. Ketik /start untuk membuka menu utama.');
  } catch (e) {
    console.error('[TXT]', e.message || e);
    bot.sendMessage(chatId, '⚠️ Error memproses pesan.').catch(() => {});
  }
});

/* ================= START & STABILITAS ================= */
// Handler diagnosa didaftarkan SEBELUM polling supaya semua pesan tercatat.
bot.on('message', (ctx, next) => {
  console.log(`[RECV] dari ${ctx.from?.id} (${ctx.from?.username || ctx.from?.first_name || '?'}): ${String(ctx.message?.text || ctx.message?.caption || '[bukan teks]').slice(0, 60)}`);
  return next();
});

console.log(`[BOT] ${CFG.STORE_NAME} jalan | mode pembayaran: ${pay.ready() ? 'GOMERCH OTOMATIS' : 'MANUAL (ACC admin)'}`);

// Polling manual (bukan bot.launch) — full kontrol offset & log, tahan 409/502.
let __offset = 0;
let __pollCount = 0;
let __errors = 0;

async function pollLoop() {
  try { await bot.telegram.deleteWebhook({ drop_pending_updates: false }); } catch (_) {}
  console.log('[POLL] Loop polling manual aktif (long-poll 25s).');
  for (;;) {
    try {
      const updates = await bot.telegram.callApi('getUpdates', {
        offset: __offset, timeout: 25, limit: 100,
        allowed_updates: ['message', 'callback_query']
      });
      __pollCount++;
      if (__pollCount % 40 === 0) console.log(`[POLL] hidup | siklus ${__pollCount} | offset ${__offset} | error ${__errors}`);
      if (Array.isArray(updates)) {
        for (const u of updates) {
          __offset = u.update_id + 1;
          bot.handleUpdate(u).catch((e) => console.error('[UPDATE-ERR]', e.message || e));
        }
      }
    } catch (e) {
      __errors++;
      const msg = e.message || String(e);
      if (msg.includes('409') || msg.includes('Conflict')) {
        console.error('[POLL] 409 Conflict — token dipakai instance lain. Coba lagi 15 detik...');
        await new Promise(r => setTimeout(r, 15000));
      } else if (msg.includes('502') || msg.includes('504') || msg.includes('ETIMEDOUT') || msg.includes('ECONNRESET') || msg.includes('socket hang up')) {
        console.error('[POLL] Gangguan jaringan/Telegram:', msg, '— ulang 3 detik.');
        await new Promise(r => setTimeout(r, 3000));
      } else {
        console.error('[POLL] Error:', msg, '— ulang 5 detik.');
        await new Promise(r => setTimeout(r, 5000));
      }
    }
  }
}

pollLoop().catch((e) => { console.error('[POLL] Fatal:', e.message || e); process.exit(1); });
recoverPendingDeliveries().catch((e) => console.error('[RECOVER]', e.message || e));

bot.on('polling_error', (e) => console.error('[POLLING]', e.message || e));
process.on('uncaughtException', (err) => console.error('[UNCAUGHT]', err && err.stack ? err.stack : err));
process.on('unhandledRejection', (r) => console.error('[UNHANDLED]', r && r.stack ? r.stack : r));
process.once('SIGINT', () => process.exit(0));
process.once('SIGTERM', () => process.exit(0));

// Memory guard
setInterval(() => {
  try {
    const mb = process.memoryUsage().rss / 1048576;
    if (mb > 380) { states.clear(); if (global.gc) { try { global.gc(); } catch (e) {} }
      if (process.memoryUsage().rss / 1048576 > 450) { console.error('[MEMORY GUARD] restart bersih...'); process.exit(1); } }
  } catch (e) {}
}, 5 * 60 * 1000);
console.log('[BOOT] GEN SSH STORE bot initializing...');
