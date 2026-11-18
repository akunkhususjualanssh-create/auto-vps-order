'use strict';
/*
 * lib/delivery.js — Pengiriman informasi VPS ke pembeli (retry 5x, pin pesan).
 */
const TRIES = new Map();
let bot, dep;

function init(b, deps) { bot = b; dep = deps; }

async function deliver(order) {
  const D = dep.D, CFG = dep.CFG;
  const prod = D.getProduct(order.product_id);
  const unit = D.getUnit(order.unit_id);
  if (!prod || !unit) return false;
  const dateID = dep.dateID;
  const text =
    `🖥️ <b>INFORMASI VPS ANDA</b>\n━━━━━━━━━━━━━━━\n` +
    `🆔 ID VPS : <code>${order.id}</code>\n` +
    `🌐 IP ADDRESS : <code>${unit.ip}</code>\n` +
    `🔑 USERNAME : <code>${unit.username || 'root'}</code>\n` +
    `🔐 PASSWORD : <code>${unit.password || '-'}</code>\n` +
    `🔌 PORT SSH : <code>${unit.port || '22'}</code>\n` +
    `💻 OPERATING SYSTEM : ${prod.os || '-'}\n\n` +
    `⚙️ <b>SPESIFIKASI VPS</b>\nRAM : ${prod.ram || '-'}\nCPU : ${prod.cpu || '-'}\nDISK : ${prod.disk || '-'}\nBANDWIDTH : ${prod.bandwidth || '-'}\n\n` +
    `📅 TANGGAL PEMBELIAN\n${dateID(order.paid_at || order.created_at)}\n\n` +
    `⏳ MASA AKTIF\n${prod.duration_days} hari\n\n` +
    `📆 EXPIRED\n${dateID((order.paid_at || order.created_at) + prod.duration_days * 86400000)}\n\n` +
    `📊 STATUS : AKTIF\n\n━━━━━━━━━━━━━━━\n👑 ${dep.esc(CFG.STORE_NAME)}\nTerima kasih telah membeli VPS!`;
  try {
    const m = await bot.sendMessage(order.user_id, text, { parse_mode: 'HTML', protect_content: true });
    try { await bot.pinChatMessage(order.user_id, m.message_id).catch(() => {}); } catch (e) {}
    D.updateOrder(order.id, { status: 'delivered', delivered_at: Date.now(), delivered_msg: text.slice(0, 200) });
    D.markPurchase(order.user_id, order.total);
    TRIES.delete(order.id);
    if (CFG.ADMIN_ID) bot.sendMessage(CFG.ADMIN_ID,
      `🔔 <b>TRANSAKSI BARU</b>\n🧾 ${order.id}\n👤 ${dep.esc(order.user_name || '-')} (${order.user_id})\n📦 ${dep.esc(prod.name)}\n💰 ${dep.rp(order.total)}\n🌐 Unit #${unit.id} (${dep.esc(unit.ip)})\n✅ TERKIRIM`, { parse_mode: 'HTML' }).catch(() => {});
    return true;
  } catch (e) {
    console.error('[DELIVER]', e.message);
    const t = (TRIES.get(order.id) || 0) + 1;
    TRIES.set(order.id, t);
    if (t < 5) setTimeout(() => deliver(D.getOrder(order.id)), 15000);
    return false;
  }
}

module.exports = { init, deliver };
