'use strict';
/*
 * lib/db.js — SQLite permanen memakai modul BAWAAN Node (node:sqlite).
 * TANPA dependency native (tidak perlu g++, tidak ada compile, aman di semua VPS).
 * Butuh Node >= 22 (node:sqlite bawaan, tanpa compile).
 *
 * ATURAN STOK: 1 unit VPS di-add admin = stok +1. Tidak ada input stok manual.
 */
const fs = require('fs');
const path = require('path');
let DatabaseSync;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch (e) {
  console.error('\n❌ Node.js kamu terlalu lama. Modul SQLite bawaan butuh Node >= 22.');
  console.error('   Fix: curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt install -y nodejs\n');
  process.exit(1);
}

const DATA_DIR = path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'store.db'));
try { db.exec('PRAGMA journal_mode = WAL'); } catch (e) {}

db.exec(`
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pkey TEXT UNIQUE,
  name TEXT NOT NULL,
  ram TEXT, cpu TEXT, disk TEXT, os TEXT, bandwidth TEXT,
  duration_days INTEGER NOT NULL DEFAULT 30,
  price INTEGER NOT NULL,
  created_at INTEGER
);
CREATE TABLE IF NOT EXISTS units (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  ip TEXT NOT NULL,
  port TEXT DEFAULT '22',
  username TEXT,
  password TEXT,
  status TEXT NOT NULL DEFAULT 'available',
  order_id TEXT,
  created_at INTEGER
);
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  seq INTEGER,
  user_id TEXT NOT NULL,
  user_name TEXT,
  product_id INTEGER NOT NULL,
  unit_id INTEGER,
  total INTEGER NOT NULL,
  unique_amount INTEGER,
  status TEXT NOT NULL DEFAULT 'waiting',
  qr_string TEXT,
  created_at INTEGER, paid_at INTEGER, delivered_at INTEGER, expire_at INTEGER,
  delivered_msg TEXT
);
CREATE TABLE IF NOT EXISTS users (
  tg_id TEXT PRIMARY KEY,
  name TEXT, username TEXT,
  joined_at INTEGER,
  purchases INTEGER DEFAULT 0,
  spent INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE INDEX IF NOT EXISTS idx_units_product ON units(product_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
`);

const now = () => Date.now();
const row = (r) => (r ? Object.assign({}, r) : r); // node:sqlite -> objek normal

/* ================= STOK OTOMATIS ================= */
function productKey(p) {
  return [p.name, p.ram, p.cpu, p.disk, p.os, p.bandwidth, p.duration_days, p.price]
    .map(x => String(x ?? '').trim().toLowerCase()).join('|');
}

function addUnit(data) {
  const key = productKey(data);
  let prod = row(db.prepare('SELECT * FROM products WHERE pkey = ?').get(key));
  if (!prod) {
    const r = db.prepare(`INSERT INTO products (pkey,name,ram,cpu,disk,os,bandwidth,duration_days,price,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(key, data.name, data.ram, data.cpu, data.disk, data.os, data.bandwidth, data.duration_days, data.price, now());
    prod = row(db.prepare('SELECT * FROM products WHERE id = ?').get(r.lastInsertRowid));
  }
  const r = db.prepare(`INSERT INTO units (product_id,ip,port,username,password,status,created_at)
    VALUES (?,?,?,?,?,'available',?)`).run(prod.id, data.ip, data.port || '22', data.username, data.password, now());
  return { productId: prod.id, unitId: r.lastInsertRowid };
}

function stockSummary() {
  return db.prepare(`SELECT p.*,
      SUM(CASE WHEN u.status='available' THEN 1 ELSE 0 END) AS stock,
      SUM(CASE WHEN u.status='sold' THEN 1 ELSE 0 END) AS sold,
      COUNT(u.id) AS total
    FROM products p LEFT JOIN units u ON u.product_id = p.id
    GROUP BY p.id ORDER BY p.name`).all().map(row);
}
const getProduct = (id) => row(db.prepare('SELECT * FROM products WHERE id=?').get(id));
const getUnit = (id) => row(db.prepare('SELECT * FROM units WHERE id=?').get(id));
function listUnits(productId, status) {
  return (status
    ? db.prepare('SELECT * FROM units WHERE product_id=? AND status=? ORDER BY id').all(productId, status)
    : db.prepare('SELECT * FROM units WHERE product_id=? ORDER BY id').all(productId)).map(row);
}

/* ================= LOCKING ANTI DOUBLE-SELL ================= */
let stockLock = false;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function withStockLock(fn) {
  let tries = 0;
  while (stockLock) { await sleep(25); if (++tries > 400) throw new Error('Stock lock timeout'); }
  stockLock = true;
  try { return await fn(); } finally { stockLock = false; }
}

async function reserveUnit(orderId, productId) {
  return withStockLock(() => {
    const u = row(db.prepare(`SELECT * FROM units WHERE product_id=? AND status='available' ORDER BY id LIMIT 1`).get(productId));
    if (!u) return null;
    const r = db.prepare(`UPDATE units SET status='reserved', order_id=? WHERE id=? AND status='available'`).run(orderId, u.id);
    if (r.changes !== 1) return null;
    return u;
  });
}

async function releaseUnit(unitId, orderId) {
  return withStockLock(() => {
    db.prepare(`UPDATE units SET status='available', order_id=NULL WHERE id=? AND status='reserved' AND order_id=?`).run(unitId, orderId);
  });
}

async function markSold(unitId, orderId) {
  return withStockLock(() => {
    db.prepare(`UPDATE units SET status='sold', order_id=? WHERE id=? AND order_id=?`).run(orderId, unitId, orderId);
  });
}

/* ================= ORDER ================= */
function createOrder(o) {
  const last = db.prepare('SELECT seq FROM orders ORDER BY seq DESC LIMIT 1').get();
  const seq = (last ? last.seq : 0) + 1;
  const id = 'ORD-' + String(seq).padStart(5, '0');
  db.prepare(`INSERT INTO orders (id,seq,user_id,user_name,product_id,unit_id,total,unique_amount,status,qr_string,created_at,expire_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, seq, o.userId, o.userName, o.productId, o.unitId, o.total, o.uniqueAmount || null,
    o.unitId ? 'waiting' : 'no_stock', o.qrString || null, now(), now() + o.expireMs);
  return id;
}
const getOrder = (id) => row(db.prepare('SELECT * FROM orders WHERE id=?').get(id));
const updateOrder = (id, fields) => {
  const keys = Object.keys(fields);
  db.prepare(`UPDATE orders SET ${keys.map(k => k + '=?').join(',')} WHERE id=?`)
    .run(...keys.map(k => fields[k]), id);
};
const waitingOrders = () => db.prepare(`SELECT * FROM orders WHERE status='waiting'`).all().map(row);
const todayStart = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };

/* ================= USER ================= */
function upsertUser(u) {
  const id = String(u.id);
  const old = row(db.prepare('SELECT * FROM users WHERE tg_id=?').get(id));
  if (old) db.prepare('UPDATE users SET name=?, username=? WHERE tg_id=?').run(u.first_name || old.name, u.username || old.username || '', id);
  else db.prepare('INSERT INTO users (tg_id,name,username,joined_at) VALUES (?,?,?,?)').run(id, u.first_name || '', u.username || '', now());
}
const allUsers = () => db.prepare('SELECT * FROM users ORDER BY joined_at').all().map(row);
const getUser = (id) => row(db.prepare('SELECT * FROM users WHERE tg_id=?').get(String(id)));
function markPurchase(userId, amount) {
  db.prepare('UPDATE users SET purchases=purchases+1, spent=spent+? WHERE tg_id=?').run(amount, String(userId));
}

/* ================= STATS ================= */
function stats() {
  const q = (sql, ...p) => row(db.prepare(sql).get(...p));
  const today = q(`SELECT COALESCE(SUM(total),0) s, COUNT(*) c FROM orders WHERE status='delivered' AND paid_at>=?`, todayStart());
  return {
    users: q('SELECT COUNT(*) c FROM users').c,
    ordersDone: q(`SELECT COUNT(*) c FROM orders WHERE status='delivered'`).c,
    revenue: q(`SELECT COALESCE(SUM(total),0) s FROM orders WHERE status='delivered'`).s,
    revenueToday: today.s, ordersToday: today.c,
    waiting: q(`SELECT COUNT(*) c FROM orders WHERE status='waiting'`).c,
    failed: q(`SELECT COUNT(*) c FROM orders WHERE status='failed'`).c,
  };
}

module.exports = {
  db, addUnit, stockSummary, getProduct, getUnit, listUnits,
  reserveUnit, releaseUnit, markSold,
  createOrder, getOrder, updateOrder, waitingOrders,
  upsertUser, allUsers, getUser, markPurchase, stats, productKey,
};
