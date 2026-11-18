'use strict';
/*
 * handlers/admin.js — Panel Admin GEN SSH STORE
 * /admin: Add Produk (12 field), Delete Produk, Edit Produk, Kelola Stok,
 * List User, Broadcast (teks / teks+gambar / gambar).
 */
let bot, ctx_;
let states; // dibagi dengan index.js

const A = {
  init(b, ctx) {
    bot = b; ctx_ = ctx;
    states = ctx.states;
    return A.onCallback;
  },

  isAdm(id) { return ctx_.isAdmin(id); },

  /* ---------- PANEL ---------- */
  panel(chatId, msgId) {
    const s = ctx_.D.stats();
    const prods = ctx_.D.stockSummary();
    const units = ctx_.D.db.prepare(`SELECT COUNT(*) c FROM units WHERE status='available'`).get().c;
    const text =
      `👑 <b>PANEL ADMIN ${esc(ctx_.CFG.STORE_NAME)}</b>\n━━━━━━━━━━━━━━━\n` +
      `👥 User: <b>${s.users}</b>\n📊 Order done: <b>${s.ordersDone}</b> | Omzet: <b>${ctx_.rp(s.revenue)}</b>\n` +
      `📈 Hari ini: <b>${ctx_.rp(s.revenueToday)}</b> (${s.ordersToday} trx)\n` +
      `⏳ Menunggu bayar: ${s.waiting} | ⚠️ Gagal kirim: ${s.failed}\n` +
      `📦 Produk: ${prods.length} | Unit stok: <b>${units}</b>\n\nPilih menu:`;
    bot.editMessageText(text, { ...ctx_.HTML, chat_id: chatId, message_id: msgId,
      reply_markup: { inline_keyboard: [
        [ctx_.iB('📦 ADD PRODUK', 'adm:add'), ctx_.iB('🗑️ DELETE PRODUK', 'adm:del')],
        [ctx_.iB('📝 EDIT PRODUK', 'adm:edit'), ctx_.iB('📊 KELOLA STOK', 'adm:stock')],
        [ctx_.iB('📋 LIST USER', 'adm:users'), ctx_.iB('📢 BROADCAST', 'adm:bc')],
        [ctx_.iB('🏠 Menu', 'home')],
      ] } }).catch(() => {});
  },

  /* ---------- ADD PRODUK: alur 12 pertanyaan ---------- */
  ADD_FIELDS: [
    ['name', '1/12 — Nama produk VPS:', (v) => v.length >= 3],
    ['ip', '2/12 — IP Address VPS:', (v) => /^\d{1,3}(\.\d{1,3}){3}$/.test(v)],
    ['port', '3/12 — Port VPS:', (v) => /^\d{2,5}$/.test(v)],
    ['username', '4/12 — Username (biasanya root):', (v) => v.length >= 1],
    ['password', '5/12 — Password VPS:', (v) => v.length >= 1],
    ['os', '6/12 — Operating System (mis: Debian 12):', (v) => v.length >= 2],
    ['ram', '7/12 — RAM (mis: 2GB):', (v) => v.length >= 1],
    ['cpu', '8/12 — CPU (mis: 2 vCPU):', (v) => v.length >= 1],
    ['disk', '9/12 — Disk (mis: 40GB):', (v) => v.length >= 1],
    ['masaaktif', '10/12 — Masa aktif dalam HARI (angka, mis: 30):', (v) => /^\d+$/.test(v)],
    ['bandwidth', '11/12 — Bandwidth (mis: Unlimited / 1TB):', (v) => v.length >= 1],
    ['price', '12/12 — Harga jual dalam RUPIAH (angka, mis: 25000):', (v) => /^\d+$/.test(v) && +v >= 0],
  ],

  startAdd(uid, chatId, msgId) {
    states.set(uid, { step: 'adm_add', field: 0, data: {}, _ts: Date.now() });
    bot.editMessageText('📦 <b>ADD PRODUK — tambah 1 unit VPS (stok otomatis +1)</b>\n\n' + A.ADD_FIELDS[0][1],
      { ...ctx_.HTML, chat_id: chatId, message_id: msgId }).catch(() => {});
  },

  async handleAddText(msg, st, text) {
    const chatId = msg.chat.id, uid = msg.from.id;
    const i = st.field;
    const [key, , valid] = A.ADD_FIELDS[i];
    if (!valid(text)) {
      return bot.sendMessage(chatId, `❌ Format tidak valid.\n\n` + A.ADD_FIELDS[i][1]);
    }
    st.data[key] = text;
    st.field++;
    if (st.field < A.ADD_FIELDS.length) {
      return bot.sendMessage(chatId, '✅ Disimpan.\n\n' + A.ADD_FIELDS[st.field][1]);
    }
    // Selesai -> konfirmasi
    st.step = 'adm_add_conf';
    const d = st.data;
    const conf =
      `📋 <b>KONFIRMASI DATA VPS</b>\n━━━━━━━━━━━━━━━\n` +
      `Nama    : ${esc(d.name)}\nIP      : ${esc(d.ip)}:${esc(d.port)}\nUser    : ${esc(d.username)}\nPass    : ${esc(d.password)}\nOS      : ${esc(d.os)}\nRAM     : ${esc(d.ram)} | CPU: ${esc(d.cpu)} | Disk: ${esc(d.disk)}\nBandw.  : ${esc(d.bandwidth)}\nMasa aktif: ${d.masaaktif} hari\nHarga   : ${ctx_.rp(+d.price)}\n\n⚠️ Password TIDAK akan tampil di menu publik.`;
    await bot.sendMessage(chatId, conf, { ...ctx_.HTML,
      reply_markup: { inline_keyboard: [
        [ctx_.iB('✅ SIMPAN VPS', 'adm:addsave'), ctx_.iB('✏️ ULANGI', 'adm:add'), ctx_.iB('❌ BATALKAN', 'adm:cancel')],
      ] } });
  },

  saveAdd(uid, chatId) {
    const st = states.get(uid);
    if (!st || !st.data) return bot.sendMessage(chatId, 'Sesi tidak ditemukan.');
    const d = st.data;
    const r = ctx_.D.addUnit({
      name: d.name, ip: d.ip, port: d.port, username: d.username, password: d.password,
      os: d.os, ram: d.ram, cpu: d.cpu, disk: d.disk, bandwidth: d.bandwidth,
      duration_days: parseInt(d.masaaktif, 10) || 30, price: parseInt(d.price, 10) || 0,
    });
    states.delete(uid);
    bot.sendMessage(chatId,
      `✅ <b>VPS TERSIMPAN!</b>\n\n📦 Produk: ${esc(d.name)}\n🆔 Unit VPS: #${r.unitId}\n📊 Stok produk ini: ${ctx_.D.listUnits(r.productId, 'available').length}\n\n➕ Stok otomatis +1. Tambah lagi? Tekan ADD PRODUK.`, ctx_.HTML);
  },

  /* ---------- DELETE PRODUK ---------- */
  showDeleteList(chatId, msgId) {
    const prods = ctx_.D.stockSummary();
    if (!prods.length) return bot.editMessageText('Tidak ada produk.', { chat_id: chatId, message_id: msgId }).catch(() => {});
    const rows = prods.map(p => [ctx_.iB(`${p.name} (stok ${p.stock})`, `adm:delprod:${p.id}`)]);
    rows.push([ctx_.iB('👑 Panel', 'adm')]);
    bot.editMessageText('🗑️ <b>Pilih produk yang mau dihapus:</b>', { ...ctx_.HTML, chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: rows } }).catch(() => {});
  },

  delProd(chatId, msgId, pid) {
    const p = ctx_.D.getProduct(pid);
    if (!p) return;
    const sold = ctx_.D.listUnits(pid, 'sold').length;
    const available = ctx_.D.listUnits(pid, 'available').length;
    const reserved = ctx_.D.listUnits(pid, 'reserved').length;
    if (sold > 0) {
      return bot.editMessageText(`⚠️ Produk <b>${esc(p.name)}</b> punya <b>${sold} unit TERJUAL</b> (riwayat transaksi aktif).\nTidak boleh dihapus sembarangan.\n\nYang bisa dihapus: ${available} unit belum terjual — pakai 🗑️ KELOLA STOK → HAPUS UNIT.`,
        { ...ctx_.HTML, chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: [[ctx_.iB('👑 Panel', 'adm')]] } }).catch(() => {});
    }
    if (reserved > 0) {
      return bot.editMessageText(`⚠️ Ada ${reserved} unit sedang DIPESAN (menunggu bayar). Tunggu selesai dulu.`, { ...ctx_.HTML, chat_id: chatId, message_id: msgId }).catch(() => {});
    }
    ctx_.D.db.prepare('DELETE FROM units WHERE product_id=?').run(pid);
    ctx_.D.db.prepare('DELETE FROM products WHERE id=?').run(pid);
    bot.editMessageText(`✅ Produk <b>${esc(p.name)}</b> + ${available} unit dihapus.`, { ...ctx_.HTML, chat_id: chatId, message_id: msgId }).catch(() => {});
  },

  /* ---------- EDIT PRODUK ---------- */
  EDIT_FIELDS: [
    ['name', 'Nama produk:'], ['ip', 'IP Address:'], ['port', 'Port:'],
    ['username', 'Username:'], ['password', 'Password:'], ['os', 'OS:'],
    ['ram', 'RAM:'], ['cpu', 'CPU:'], ['disk', 'Disk:'], ['bandwidth', 'Bandwidth:'],
    ['masaaktif', 'Masa aktif (hari):'], ['price', 'Harga (rupiah):'],
  ],
  startEdit(uid, chatId, msgId) {
    const prods = ctx_.D.stockSummary();
    if (!prods.length) return bot.editMessageText('Tidak ada produk.', { chat_id: chatId, message_id: msgId }).catch(() => {});
    const rows = prods.map(p => [ctx_.iB(`${p.name} (stok ${p.stock})`, `adm:editprod:${p.id}`)]);
    rows.push([ctx_.iB('👑 Panel', 'adm')]);
    bot.editMessageText('📝 <b>EDIT — pilih produk:</b>', { ...ctx_.HTML, chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: rows } }).catch(() => {});
  },
  showEditUnits(chatId, msgId, pid) {
    const units = ctx_.D.listUnits(pid);
    const p = ctx_.D.getProduct(pid);
    const rows = units.map(u => [ctx_.iB(`#${u.id} ${u.ip} [${u.status}]`, `adm:editunit:${pid}:${u.id}`)]);
    rows.push([ctx_.iB('⬅️ Produk', 'adm:edit')]);
    bot.editMessageText(`📝 <b>${esc(p.name)}</b> — pilih unit yang diedit:`, { ...ctx_.HTML, chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: rows } }).catch(() => {});
  },
  showEditUnit(chatId, msgId, pid, uid2) {
    const u = ctx_.D.getUnit(uid2);
    const p = ctx_.D.getProduct(pid);
    const text = `📝 <b>Edit Unit #${u.id}</b> (${esc(p.name)})\n━━━━━━━━━━━━━━━\nIP:${esc(u.ip)}:${esc(u.port)} | User:${esc(u.username)} | Pass:${esc(u.password)}\nStatus: ${u.status}\n\nKetik perubahan dengan format:\n<code>field: nilai</code>\n\nField: ${A.EDIT_FIELDS.map(f => f[0]).join(', ')}\n\nContoh: <code>ip: 103.1.2.3</code> atau <code>price: 30000</code>\nKirim beberapa baris sekaligus juga bisa.`;
    bot.editMessageText(text, { ...ctx_.HTML, chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: [[ctx_.iB('⬅️ Unit', `adm:editprod:${pid}`)], [ctx_.iB('👑 Panel', 'adm')]] } }).catch(() => {});
    states.set('edit_' + chatId, { step: 'adm_edit', pid, unitId: uid2, _ts: Date.now() });
  },
  handleEditText(msg, text) {
    const chatId = msg.chat.id;
    const st = states.get('edit_' + chatId);
    if (!st) return false;
    const changes = {};
    for (const line of text.split('\n')) {
      const m = line.match(/^\s*([a-z_]+)\s*:\s*(.+)$/i);
      if (m) {
        const field = m[1].toLowerCase().trim();
        const val = m[2].trim();
        if (field === 'masaaktif' && !/^\d+$/.test(val)) return bot.sendMessage(chatId, '❌ masaaktif harus angka hari.');
        if (field === 'price' && !/^\d+$/.test(val)) return bot.sendMessage(chatId, '❌ price harus angka rupiah.');
        changes[field] = val;
      }
    }
    if (!Object.keys(changes).length) return bot.sendMessage(chatId, '❌ Format: <code>field: nilai</code>', ctx_.HTML);
    const u = ctx_.D.getUnit(st.unitId);
    const p = ctx_.D.getProduct(st.pid);
    const upd = { ip: u.ip, port: u.port, username: u.username, password: u.password, status: u.status };
    const prod = { name: p.name, os: p.os, ram: p.ram, cpu: p.cpu, disk: p.disk, bandwidth: p.bandwidth, duration_days: p.duration_days, price: p.price };
    for (const [k, v] of Object.entries(changes)) {
      if (k === 'name') prod.name = v;
      else if (k === 'os') prod.os = v;
      else if (k === 'ram') prod.ram = v;
      else if (k === 'cpu') prod.cpu = v;
      else if (k === 'disk') prod.disk = v;
      else if (k === 'bandwidth') prod.bandwidth = v;
      else if (k === 'masaaktif') prod.duration_days = +v;
      else if (k === 'price') prod.price = +v;
      else if (k === 'ip') upd.ip = v;
      else if (k === 'port') upd.port = v;
      else if (k === 'username') upd.username = v;
      else if (k === 'password') upd.password = v;
      else if (k === 'status' && ['available', 'reserved', 'sold'].includes(v)) upd.status = v;
    }
    // Pindahkan unit ke kelompok produk yang cocok (jika spec/harga berubah)
    const newProd = ctx_.D.addUnit({ ...prod, ip: upd.ip, port: upd.port, username: upd.username, password: upd.password });
    if (newProd.productId !== st.pid || newProd.unitId !== st.unitId) {
      ctx_.D.db.prepare('DELETE FROM units WHERE id=?').run(st.unitId);
    }
    ctx_.D.db.prepare('UPDATE units SET ip=?, port=?, username=?, password=?, status=? WHERE id=?')
      .run(upd.ip, upd.port, upd.username, upd.password, upd.status, newProd.unitId);
    states.delete('edit_' + chatId);
    bot.sendMessage(chatId, `✅ Perubahan disimpan: ${Object.keys(changes).join(', ')}.`, ctx_.HTML);
    return true;
  },

  /* ---------- KELOLA STOK ---------- */
  stockMenu(chatId, msgId) {
    bot.editMessageText('📊 <b>KELOLA STOK VPS</b>', { ...ctx_.HTML, chat_id: chatId, message_id: msgId,
      reply_markup: { inline_keyboard: [
        [ctx_.iB('➕ TAMBAH STOK', 'adm:add'), ctx_.iB('➖ KURANGI STOK', 'adm:less')],
        [ctx_.iB('📊 CEK STOK', 'adm:check'), ctx_.iB('📋 DAFTAR VPS TERSEDIA', 'adm:avail')],
        [ctx_.iB('🗑️ HAPUS UNIT VPS', 'adm:delunit'), ctx_.iB('👑 Panel', 'adm')],
      ] } }).catch(() => {});
  },
  checkStock(chatId, msgId) {
    const s = ctx_.D.stockSummary();
    let text = '📊 <b>INFORMASI STOK VPS</b>\n━━━━━━━━━━━━━━━\n';
    for (const p of s) {
      text += `\n📦 <b>${esc(p.name)}</b>\n   📊 Total unit: ${p.total}\n   ✅ Tersedia: ${p.stock}\n   🛒 Terjual: ${p.sold}\n`;
    }
    bot.editMessageText(text, { ...ctx_.HTML, chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: [[ctx_.iB('👑 Panel', 'adm')]] } }).catch(() => {});
  },
  listAvailable(chatId, msgId) {
    const units = ctx_.D.db.prepare(`SELECT u.*, p.name FROM units u JOIN products p ON p.id=u.product_id WHERE u.status='available' ORDER BY p.name, u.id`).all();
    if (!units.length) return bot.editMessageText('Stok kosong — semua terjual.', { ...ctx_.HTML, chat_id: chatId, message_id: msgId }).catch(() => {});
    let text = '📋 <b>DAFTAR VPS TERSEDIA</b>\n\n';
    for (const u of units.slice(0, 40)) text += `#${u.id} • ${esc(u.name)} • ${esc(u.ip)}:${esc(u.port)} • ${ctx_.rp(ctx_.D.getProduct(u.product_id).price)}\n`;
    if (units.length > 40) text += `\n...+${units.length - 40} unit lain`;
    bot.editMessageText(text, { ...ctx_.HTML, chat_id: chatId, message_id: msgId }).catch(() => {});
  },
  delUnitMenu(chatId, msgId) {
    const units = ctx_.D.db.prepare(`SELECT u.*, p.name FROM units u JOIN products p ON p.id=u.product_id WHERE u.status='available' ORDER BY u.id`).all();
    if (!units.length) return bot.editMessageText('Tidak ada unit yang bisa dihapus (semua terjual/reserved).', { chat_id: chatId, message_id: msgId }).catch(() => {});
    const rows = units.slice(0, 50).map(u => [ctx_.iB(`🗑 #${u.id} ${esc(u.ip)} • ${esc(u.name)}`, `adm:delunit:${u.id}`)]);
    rows.push([ctx_.iB('👑 Panel', 'adm')]);
    bot.editMessageText('🗑️ <b>Hapus unit yang BELUM terjual:</b>', { ...ctx_.HTML, chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: rows } }).catch(() => {});
  },
  delUnit(chatId, msgId, uid2) {
    const u = ctx_.D.getUnit(uid2);
    if (!u || u.status !== 'available') return bot.editMessageText('Unit tidak ada / sudah terjual.', { chat_id: chatId, message_id: msgId }).catch(() => {});
    ctx_.D.db.prepare('DELETE FROM units WHERE id=? AND status=?').run(uid2, 'available');
    bot.editMessageText(`✅ Unit #${uid2} (${esc(u.ip)}) dihapus dari stok.`, { ...ctx_.HTML, chat_id: chatId, message_id: msgId }).catch(() => {});
  },

  /* ---------- LIST USER ---------- */
  showUsers(chatId, msgId) {
    const users = ctx_.D.allUsers();
    let text = `📋 <b>LIST USER</b> — total <b>${users.length}</b>\n\n`;
    users.slice(-30).forEach((u, i) => {
      text += `${i + 1}. ${esc(u.name || '-')} (@${esc(u.username || '-')})\n   ID: <code>${u.tg_id}</code> | trx: ${u.purchases} | belanja: ${ctx_.rp(u.spent)}\n`;
    });
    bot.editMessageText(text, { ...ctx_.HTML, chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: [[ctx_.iB('👑 Panel', 'adm')]] } }).catch(() => {});
  },

  /* ---------- BROADCAST (3 jenis) ---------- */
  bcMenu(chatId, msgId) {
    bot.editMessageText('📢 <b>BROADCAST</b>\n\nPilih jenis:\n• Teks saja\n• Teks + Gambar\n• Gambar saja\n\nLalu kirim kontennya di chat.',
      { ...ctx_.HTML, chat_id: chatId, message_id: msgId,
        reply_markup: { inline_keyboard: [
          [ctx_.iB('📝 TEKS ONLY', 'adm:bctext'), ctx_.iB('🖼 TEKS+GAMBAR', 'adm:bcimg')],
          [ctx_.iB('🖼 GAMBAR ONLY', 'adm:bcimgonly'), ctx_.iB('👑 Panel', 'adm')],
        ] } }).catch(() => {});
  },

  async doBroadcast(fromId, chatId, content, caption) {
    const users = ctx_.D.allUsers().map(u => u.tg_id).filter(x => x !== String(fromId));
    const statusMsg = await bot.sendMessage(chatId, `📣 Mengirim ke ${users.length} user...`).catch(() => null);
    let ok = 0, fail = 0;
    const seen = new Set();
    for (const id of users) {
      if (seen.has(id)) continue; // anti dobel
      seen.add(id);
      try {
        if (content && content.photo && caption) await bot.sendPhoto(id, content.photo, { caption });
        else if (content && content.photo) await bot.sendPhoto(id, content.photo);
        else await bot.sendMessage(id, caption || content);
        ok++;
      } catch (e) { fail++; }
      await new Promise(r => setTimeout(r, 60)); // anti flood limit
    }
    if (statusMsg) bot.editMessageText(`✅ Broadcast selesai.\n📤 Total penerima: ${users.length}\n✅ Berhasil: ${ok}\n❌ Gagal: ${fail}`, { chat_id: chatId, message_id: statusMsg.message_id }).catch(() => {});
  },

  /* ---------- CALLBACK ROUTER & TEXT ROUTER ---------- */
  async onCallback(cq, o) {
    const { ack, chatId, uid, data } = o;
    const msgId = cq.message.message_id;
    const st = states.get(uid);
    if (data === 'adm') return A.panel(chatId, msgId), ack();
    if (data === 'adm:cancel') { states.delete(uid); return ack('Batal'); }
    if (data === 'adm:add') return A.startAdd(uid, chatId, msgId), ack();
    if (data === 'adm:addsave') return A.saveAdd(uid, chatId), ack();
    if (data === 'adm:del') return A.showDeleteList(chatId, msgId), ack();
    if (data.startsWith('adm:delprod:')) return A.delProd(chatId, msgId, +data.split(':')[2]), ack();
    if (data === 'adm:edit') return A.startEdit(uid, chatId, msgId), ack();
    if (data.startsWith('adm:editprod:')) return A.showEditUnits(chatId, msgId, +data.split(':')[2]), ack();
    if (data.startsWith('adm:editunit:')) { const [, , pid, uid2] = data.split(':'); return A.showEditUnit(chatId, msgId, +pid, +uid2), ack(); }
    if (data === 'adm:stock') return A.stockMenu(chatId, msgId), ack();
    if (data === 'adm:check') return A.checkStock(chatId, msgId), ack();
    if (data === 'adm:avail') return A.listAvailable(chatId, msgId), ack();
    if (data === 'adm:less') return A.delUnitMenu(chatId, msgId), ack();
    if (data === 'adm:delunit') return A.delUnitMenu(chatId, msgId), ack();
    if (data.startsWith('adm:delunit:')) return A.delUnit(chatId, msgId, +data.split(':')[2]), ack();
    if (data === 'adm:users') return A.showUsers(chatId, msgId), ack();
    if (data === 'adm:bc') return A.bcMenu(chatId, msgId), ack();
    if (data === 'adm:bctext') { states.set(uid, { step: 'adm_bc_text', _ts: Date.now() }); await bot.editMessageText('📢 Kirim <b>teks broadcast</b> sekarang:', { ...ctx_.HTML, chat_id: chatId, message_id: msgId }).catch(() => {}); return ack(); }
    if (data === 'adm:bcimg') { states.set(uid, { step: 'adm_bc_img', _ts: Date.now() }); await bot.editMessageText('📢 Kirim <b>foto + caption</b> sekarang:', { ...ctx_.HTML, chat_id: chatId, message_id: msgId }).catch(() => {}); return ack(); }
    if (data === 'adm:bcimgonly') { states.set(uid, { step: 'adm_bc_imgonly', _ts: Date.now() }); await bot.editMessageText('📢 Kirim <b>foto</b> (tanpa caption juga boleh):', { ...ctx_.HTML, chat_id: chatId, message_id: msgId }).catch(() => {}); return ack(); }
    if (data.startsWith('admok:')) {
      const oid = data.slice(6);
      const order = ctx_.D.getOrder(oid);
      if (!order || order.status !== 'waiting') return ack('Sudah diproses');
      ctx_.D.updateOrder(oid, { status: 'paid', paid_at: Date.now() });
      await ctx_.D.markSold(order.unit_id, oid).catch(() => {});
      ack('ACC — mengirim...');
      await bot.sendMessage(chatId, `✅ Order ${oid} di-ACC. Mengirim VPS ke pelanggan...`, ctx_.HTML).catch(() => {});
      return ctx_.delivery.deliver(ctx_.D.getOrder(oid));
    }
    if (data.startsWith('admno:')) {
      const oid = data.slice(6);
      const order = ctx_.D.getOrder(oid);
      if (order && order.status === 'waiting') {
        ctx_.D.updateOrder(oid, { status: 'rejected' });
        await ctx_.D.releaseUnit(order.unit_id, oid).catch(() => {});
        bot.sendMessage(order.user_id, `❌ Pembayaran order ${oid} tidak terverifikasi. Hubungi admin bila keliru.`, ctx_.HTML).catch(() => {});
      }
      return ack('Ditolak');
    }
    return ack();
  },

  onText(msg, text) {
    const uid = msg.from.id, chatId = msg.chat.id;
    const st = states.get(uid);
    if (text === '/admin') {
      if (!A.isAdm(uid)) return bot.sendMessage(chatId, '🔒 Khusus admin.');
      bot.sendMessage(chatId, '👑 Panel admin dibuka.', ctx_.HTML);
      return A.panel(chatId, null);
    }
    if (st && st.step === 'adm_add') return A.handleAddText(msg, st, text);
    if (st && st.step === 'adm_bc_text') { states.delete(uid); return A.doBroadcast(uid, chatId, null, text); }
    if (st && st.step === 'adm_edit') return A.handleEditText(msg, text);
    if (msg.photo && st) {
      const photo = msg.photo[msg.photo.length - 1].file_id;
      if (st.step === 'adm_bc_img') { states.delete(uid); return A.doBroadcast(uid, chatId, { photo }, text || ''); }
      if (st.step === 'adm_bc_imgonly') { states.delete(uid); return A.doBroadcast(uid, chatId, { photo }, ''); }
    }
  },
};

module.exports = A;
