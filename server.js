const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const multer = require('multer');
const ffmpegStatic = require('ffmpeg-static');
const dotenv = require('dotenv');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { spawn } = require('child_process');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const root = __dirname;
dotenv.config({ path: path.resolve(root, '.env') });
const app = express();
const port = Number(process.env.PORT || 3000);
const isRailway = Boolean(process.env.RAILWAY_ENVIRONMENT_NAME || process.env.RAILWAY_PROJECT_ID || process.env.RAILWAY_SERVICE_ID);
const isProduction = process.env.NODE_ENV === 'production' || isRailway;
const googleClientId = String(process.env.GOOGLE_CLIENT_ID || '').trim();
const googleClientSecret = String(process.env.GOOGLE_CLIENT_SECRET || '').trim();
const publicBaseUrl = String(process.env.PUBLIC_BASE_URL || '').trim().replace(/\/$/, '');
const paymentAdminEmail = String(process.env.PAYMENT_ADMIN_EMAIL || '').trim().toLowerCase();
if (!String(process.env.GOOGLE_REDIRECT_URI || '').trim()) console.error('Google OAuth belum aktif: GOOGLE_REDIRECT_URI wajib diatur di environment variable.');
if (!publicBaseUrl) console.error('Google OAuth callback belum lengkap: PUBLIC_BASE_URL wajib diatur di environment variable.');
const configuredSessionSecret = String(process.env.SESSION_SECRET || '').trim();
const hasConfiguredSessionSecret = configuredSessionSecret && configuredSessionSecret !== 'replace-with-a-long-random-value';
if (isProduction && !hasConfiguredSessionSecret) {
  throw new Error('SESSION_SECRET wajib diatur di environment variable saat production.');
}
const effectiveSessionSecret = hasConfiguredSessionSecret ? configuredSessionSecret : crypto.randomBytes(32).toString('hex');
const configuredRobloxKeySecret = String(process.env.ROBLOX_API_KEY_SECRET || '').trim();
const robloxKeySecretReady = Boolean(configuredRobloxKeySecret);
const effectiveRobloxKeySecret = configuredRobloxKeySecret || crypto.randomBytes(32).toString('hex');
app.set('trust proxy', 1);
const uploadDir = path.join(root, 'uploads');
const outputDir = path.join(root, 'converted');
const paymentDatabaseFile = path.join(root, 'database', 'payments.sqlite');
const ffmpegCommand = String(process.env.FFMPEG_PATH || ffmpegStatic || 'ffmpeg').trim();
fs.mkdirSync(uploadDir, { recursive: true });
fs.mkdirSync(outputDir, { recursive: true });
fs.mkdirSync(path.dirname(paymentDatabaseFile), { recursive: true });
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  name: 'rival.sid',
  secret: effectiveSessionSecret,
  resave: false,
  saveUninitialized: false,
  proxy: true,
  store: isProduction ? new SQLiteStore({ db: 'sessions.sqlite', dir: path.join(root, 'database') }) : undefined,
  cookie: { httpOnly: true, sameSite: 'lax', secure: isProduction, maxAge: 7 * 24 * 60 * 60 * 1000 }
}));
const allowedRequestOrigins = new Set([publicBaseUrl, 'http://localhost:3000', 'http://localhost:5173'].filter(Boolean));
app.use((req, res, next) => {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) || !req.path.startsWith('/api/')) return next();
  const origin = String(req.get('Origin') || '').replace(/\/$/, '');
  const referer = String(req.get('Referer') || '');
  if (origin && !allowedRequestOrigins.has(origin)) return res.status(403).json({ error: 'Origin request tidak diizinkan.' });
  if (!origin && referer) {
    try {
      if (!allowedRequestOrigins.has(new URL(referer).origin)) return res.status(403).json({ error: 'Referer request tidak diizinkan.' });
    } catch { return res.status(403).json({ error: 'Referer request tidak valid.' }); }
  }
  next();
});
const clientDist = path.join(root, 'client', 'dist');
if (fs.existsSync(clientDist)) app.use(express.static(clientDist, { dotfiles: 'deny', index: false }));

const sessions = new Map();
const robloxApiConnections = new Map();
const history = [];
const paymentOrders = [];
const chatRooms = [];
const outputOwners = new Map();
const robloxOperations = new Map();
const paymentDatabase = new sqlite3.Database(paymentDatabaseFile);
function databaseRun(sql, parameters = []) {
  return new Promise((resolve, reject) => paymentDatabase.run(sql, parameters, function onRun(error) { if (error) reject(error); else resolve(this); }));
}
function databaseAll(sql, parameters = []) {
  return new Promise((resolve, reject) => paymentDatabase.all(sql, parameters, (error, rows) => error ? reject(error) : resolve(rows)));
}
function normalizeOrderStatus(status) {
  const value = String(status || 'PENDING').trim().toLowerCase();
  if (['pending', 'waiting_payment', 'payment_uploaded'].includes(value)) return 'PENDING';
  if (['approved', 'approved_payment'].includes(value)) return 'APPROVED';
  if (['rejected', 'rejected_payment'].includes(value)) return 'REJECTED';
  return String(status || 'PENDING').trim().toUpperCase() || 'PENDING';
}
function calculateNormalPlaybackSpeed(remixSpeed) {
  const value = Number(remixSpeed);
  if (!Number.isFinite(value) || value <= 0) return null;
  return 1 / value;
}
async function initializePaymentDatabase() {
  await databaseRun('PRAGMA journal_mode = WAL');
  await databaseRun(`CREATE TABLE IF NOT EXISTS payment_orders (
    id TEXT PRIMARY KEY, order_number TEXT NOT NULL UNIQUE, customer_name TEXT NOT NULL,
    customer_email TEXT NOT NULL, plan_id TEXT NOT NULL DEFAULT '1-month', plan_name TEXT NOT NULL, amount INTEGER NOT NULL, duration TEXT NOT NULL DEFAULT '1 bulan', credits INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'PENDING', created_at TEXT NOT NULL, payment_target TEXT NOT NULL,
    qr_image TEXT, notes TEXT NOT NULL DEFAULT '', proof_url TEXT, uploaded_at TEXT, admin_notes TEXT NOT NULL DEFAULT '',
    transaction_id TEXT, reviewed_at TEXT, reviewed_by TEXT, username TEXT, subscription_start TEXT, subscription_expiry TEXT
  )`);
  await databaseRun('ALTER TABLE payment_orders ADD COLUMN plan_id TEXT NOT NULL DEFAULT "1-month"').catch(() => {});
  await databaseRun('ALTER TABLE payment_orders ADD COLUMN duration TEXT NOT NULL DEFAULT "1 bulan"').catch(() => {});
  await databaseRun('ALTER TABLE payment_orders ADD COLUMN transaction_id TEXT').catch(() => {});
  await databaseRun('ALTER TABLE payment_orders ADD COLUMN reviewed_at TEXT').catch(() => {});
  await databaseRun('ALTER TABLE payment_orders ADD COLUMN reviewed_by TEXT').catch(() => {});
  await databaseRun('ALTER TABLE payment_orders ADD COLUMN username TEXT').catch(() => {});
  await databaseRun('ALTER TABLE payment_orders ADD COLUMN subscription_start TEXT').catch(() => {});
  await databaseRun('ALTER TABLE payment_orders ADD COLUMN subscription_expiry TEXT').catch(() => {});
  await databaseRun(`CREATE TABLE IF NOT EXISTS user_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    username TEXT NOT NULL,
    email TEXT NOT NULL,
    plan_id TEXT NOT NULL,
    plan_name TEXT NOT NULL,
    duration TEXT NOT NULL,
    amount INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    start_date TEXT NOT NULL,
    expiry_date TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    transaction_id TEXT,
    UNIQUE(user_id, plan_id)
  )`);
  await databaseRun(`CREATE TABLE IF NOT EXISTS payment_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT NOT NULL, sender TEXT NOT NULL,
    text TEXT NOT NULL, sent_at TEXT NOT NULL, FOREIGN KEY(order_id) REFERENCES payment_orders(id)
  )`);
  await databaseRun(`CREATE TABLE IF NOT EXISTS feature_usage (
    usage_key TEXT PRIMARY KEY, usage_count INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
  )`);
  await databaseRun(`CREATE TABLE IF NOT EXISTS usage_events (
    event_key TEXT PRIMARY KEY, usage_key TEXT NOT NULL, route TEXT NOT NULL, created_at TEXT NOT NULL
  )`);
  await databaseRun(`CREATE TABLE IF NOT EXISTS roblox_asset_history (
    owner_email TEXT NOT NULL, asset_id TEXT NOT NULL, name TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL,
    remix_metadata TEXT, PRIMARY KEY (owner_email, asset_id)
  )`);
  await databaseRun(`CREATE TABLE IF NOT EXISTS credit_balances (
    customer_email TEXT PRIMARY KEY, credits INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
  )`);
  await databaseRun(`CREATE TABLE IF NOT EXISTS credit_grants (
    order_id TEXT PRIMARY KEY, customer_email TEXT NOT NULL, credits INTEGER NOT NULL, granted_at TEXT NOT NULL
  )`);
  await databaseRun(`CREATE TABLE IF NOT EXISTS payment_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1), payment_target TEXT NOT NULL, qr_image TEXT, updated_at TEXT NOT NULL
  )`);
  await databaseRun(`CREATE TABLE IF NOT EXISTS converted_files (
    file_name TEXT PRIMARY KEY, owner_email TEXT NOT NULL, created_at TEXT NOT NULL
  )`);
  await databaseRun('INSERT OR IGNORE INTO payment_settings (id, payment_target, qr_image, updated_at) VALUES (1, ?, ?, ?)', [String(process.env.PAYMENT_TARGET || ''), String(process.env.PAYMENT_QR_FILE || ''), new Date().toISOString()]);
  await databaseRun('UPDATE payment_settings SET payment_target = ?, qr_image = ? WHERE id = 1 AND payment_target = ? AND qr_image = ?', ['', '', 'Transfer manual - tujuan pembayaran belum diatur admin', 'qr_ID1026535357986_22.09.26_1790094652_1790094652329.jpg']);
  const orders = await databaseAll('SELECT * FROM payment_orders ORDER BY created_at DESC');
  const messages = await databaseAll('SELECT order_id, sender, text, sent_at FROM payment_messages ORDER BY id ASC');
  const savedAssets = await databaseAll('SELECT owner_email, asset_id, name, status, created_at, remix_metadata FROM roblox_asset_history ORDER BY created_at DESC');
  const convertedFiles = await databaseAll('SELECT file_name, owner_email FROM converted_files');
  convertedFiles.forEach((item) => outputOwners.set(item.file_name, item.owner_email));
  savedAssets.forEach((item) => {
    let remixMetadata = null;
    try { remixMetadata = item.remix_metadata ? JSON.parse(item.remix_metadata) : null; } catch { remixMetadata = null; }
    history.push({ id: item.asset_id, name: item.name, status: item.status, ownerEmail: item.owner_email, createdAt: item.created_at, remixMetadata });
  });
  paymentOrders.push(...orders.map((item) => ({
    id: item.id,
    orderNumber: item.order_number,
    customerName: item.customer_name,
    customerEmail: item.customer_email,
    planId: item.plan_id || '1-month',
    planName: item.plan_name,
    amount: item.amount,
    duration: item.duration || '1 bulan',
    credits: item.credits || 0,
    status: normalizeOrderStatus(item.status),
    createdAt: item.created_at,
    paymentTarget: item.payment_target,
    qrImage: item.qr_image,
    notes: item.notes,
    proofUrl: item.proof_url,
    uploadedAt: item.uploaded_at,
    adminNotes: item.admin_notes,
    transactionId: item.transaction_id,
    reviewedAt: item.reviewed_at,
    reviewedBy: item.reviewed_by,
    username: item.username,
    subscriptionStart: item.subscription_start,
    subscriptionExpiry: item.subscription_expiry
  })));
  messages.forEach((message) => {
    let room = chatRooms.find((item) => item.orderId === message.order_id);
    if (!room) { room = { orderId: message.order_id, participants: [], messages: [] }; chatRooms.push(room); }
    room.messages.push({ sender: message.sender, text: message.text, sentAt: message.sent_at });
  });
}
const paymentDatabaseReady = initializePaymentDatabase().catch((error) => { console.error('Payment database initialization failed:', error); throw error; });
const usageLimit = 5;
function usageKey(req) { return requestEmail(req) || `ip:${req.ip}`; }
async function getActiveSubscription(email) {
  if (!email) return null;
  const rows = await databaseAll('SELECT * FROM user_subscriptions WHERE email = ? ORDER BY expiry_date DESC LIMIT 1', [email]);
  const subscription = rows[0];
  if (!subscription) return null;
  if (subscription.status !== 'ACTIVE' || new Date(subscription.expiry_date).getTime() <= Date.now()) {
    if (subscription.status === 'ACTIVE') await databaseRun('UPDATE user_subscriptions SET status = ?, updated_at = ? WHERE id = ?', ['EXPIRED', new Date().toISOString(), subscription.id]);
    return null;
  }
  return subscription;
}
async function getUsageState(req) {
  await paymentDatabaseReady;
  const key = usageKey(req);
  await databaseRun('INSERT OR IGNORE INTO feature_usage (usage_key, usage_count, updated_at) VALUES (?, 0, ?)', [key, new Date().toISOString()]);
  const rows = await databaseAll('SELECT usage_count FROM feature_usage WHERE usage_key = ?', [key]);
  const used = Number(rows[0]?.usage_count || 0);
  const subscription = await getActiveSubscription(requestEmail(req));
  if (isPaymentAdmin(req) || subscription) return { allowed: true, used, limit: null, unlimited: true, planName: subscription?.plan_name || 'Admin' };
  return { allowed: used < usageLimit, used, limit: usageLimit, freeRemaining: Math.max(0, usageLimit - used), unlimited: false, source: 'free' };
}
async function commitUsage(req) {
  if (req.usageState?.unlimited || !req.usageState?.allowed) return req.usageState;
  const eventKey = req.get('Idempotency-Key') || req.get('X-Request-ID') || req.usageEventKey;
  await paymentDatabaseReady;
  const result = await databaseRun('INSERT OR IGNORE INTO usage_events (event_key, usage_key, route, created_at) VALUES (?, ?, ?, ?)', [eventKey, usageKey(req), req.path, new Date().toISOString()]);
  if (result.changes !== 1) return req.usageState;
  await databaseRun('UPDATE feature_usage SET usage_count = usage_count + 1, updated_at = ? WHERE usage_key = ? AND usage_count < ?', [new Date().toISOString(), usageKey(req), usageLimit]);
  const rows = await databaseAll('SELECT usage_count FROM feature_usage WHERE usage_key = ?', [usageKey(req)]);
  return { ...req.usageState, used: Number(rows[0]?.usage_count || 0), freeRemaining: Math.max(0, usageLimit - Number(rows[0]?.usage_count || 0)) };
}
async function usageGuard(req, res, next) {
  try {
    const usage = await getUsageState(req);
    if (!usage.allowed) return res.status(429).json({ error: 'Free limit kamu sudah habis. Kamu sudah menggunakan 5 dari 5 upload gratis. Beli Plan untuk melanjutkan.', code: 'FREE_LIMIT_REACHED', usage });
    req.usageState = usage;
    req.usageEventKey = crypto.randomUUID();
    res.setHeader('X-Usage-Count', String(usage.used));
    if (usage.limit) res.setHeader('X-Usage-Limit', String(usage.limit));
    res.once('finish', () => {
      if (res.statusCode === 200 || res.statusCode === 201) commitUsage(req).catch((error) => console.error('Usage commit failed:', error));
    });
    next();
  } catch (error) {
    console.error('Usage limit check failed:', error);
    res.status(503).json({ error: 'Batas penggunaan belum siap.' });
  }
}
async function persistPaymentData() {
  await paymentDatabaseReady;
  await databaseRun('BEGIN TRANSACTION');
  try {
    await databaseRun('DELETE FROM payment_orders');
    await databaseRun('DELETE FROM payment_messages');
    for (const order of paymentOrders) await databaseRun('INSERT INTO payment_orders (id, order_number, customer_name, customer_email, plan_id, plan_name, amount, duration, credits, status, created_at, payment_target, qr_image, notes, proof_url, uploaded_at, admin_notes, transaction_id, reviewed_at, reviewed_by, username, subscription_start, subscription_expiry) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [order.id, order.orderNumber, order.customerName, order.customerEmail, order.planId || '1-month', order.planName, order.amount, order.duration || '1 bulan', order.credits || 0, normalizeOrderStatus(order.status), order.createdAt, order.paymentTarget, order.qrImage, order.notes || '', order.proofUrl || null, order.uploadedAt || null, order.adminNotes || '', order.transactionId || null, order.reviewedAt || null, order.reviewedBy || null, order.username || order.customerName, order.subscriptionStart || null, order.subscriptionExpiry || null]);
    for (const room of chatRooms) for (const message of room.messages) await databaseRun('INSERT INTO payment_messages (order_id, sender, text, sent_at) VALUES (?, ?, ?, ?)', [room.orderId, message.sender, message.text, message.sentAt]);
    await databaseRun('COMMIT');
  } catch (error) {
    await databaseRun('ROLLBACK');
    throw error;
  }
}
let paymentSaveChain = Promise.resolve();
function savePaymentData() {
  const next = paymentSaveChain.then(() => persistPaymentData());
  paymentSaveChain = next.catch(() => {});
  return next;
}
async function saveRobloxAsset(ownerEmail, assetId, name, remixMetadata) {
  await paymentDatabaseReady;
  await databaseRun('INSERT OR IGNORE INTO roblox_asset_history (owner_email, asset_id, name, status, created_at, remix_metadata) VALUES (?, ?, ?, ?, ?, ?)', [ownerEmail, String(assetId), name, 'Uploaded', new Date().toISOString(), remixMetadata ? JSON.stringify(remixMetadata) : null]);
}
async function saveOutputOwner(fileName, ownerEmail) {
  await paymentDatabaseReady;
  await databaseRun('INSERT OR REPLACE INTO converted_files (file_name, owner_email, created_at) VALUES (?, ?, ?)', [fileName, ownerEmail, new Date().toISOString()]);
}
const activeVisitors = new Map();
app.post('/api/presence', (req, res) => {
  const visitorId = String(req.body.visitorId || '').trim();
  if (!visitorId) return res.status(400).json({ error: 'visitorId wajib diisi.' });
  activeVisitors.set(visitorId, Date.now());
  res.json({ online: activeVisitors.size });
});
app.get('/api/online', (req, res) => res.json({ online: activeVisitors.size }));
setInterval(() => {
  const cutoff = Date.now() - 45 * 1000;
  for (const [visitorId, lastSeen] of activeVisitors) if (lastSeen < cutoff) activeVisitors.delete(visitorId);
}, 15 * 1000).unref();
app.use(['/api/payments', '/api/chats'], async (req, res, next) => {
  try { await paymentDatabaseReady; next(); } catch (error) { res.status(503).json({ error: 'Database pembayaran belum siap.' }); }
});
app.use(['/api/convert', '/api/optimize', '/api/remix', '/api/source/download', '/api/roblox/upload-audio'], (req, res, next) => {
  if (!requireUser(req, res)) return;
  usageGuard(req, res, next);
});
app.use('/api/youtube/validate', (req, res, next) => {
  if (!requireUser(req, res)) return;
  next();
});
app.use('/api/source/detect', (req, res, next) => {
  if (!requireUser(req, res)) return;
  next();
});
const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, file.mimetype.startsWith('audio/') || file.mimetype.startsWith('video/') || /\.(mp3|wav|ogg|m4a|flac|aac|mp4|mov|mkv|webm|avi)$/i.test(file.originalname))
});
const imageUpload = multer({
  dest: uploadDir,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\/(png|jpe?g|webp)$/.test(file.mimetype))
});
async function getPaymentSettings() {
  await paymentDatabaseReady;
  const rows = await databaseAll('SELECT payment_target, qr_image, updated_at FROM payment_settings WHERE id = 1');
  return rows[0] || { payment_target: '', qr_image: '', updated_at: null };
}
function paymentSettingsPayload(settings) {
  return { paymentTarget: settings.payment_target, qrUrl: settings.qr_image ? '/api/payments/qr' : null, updatedAt: settings.updated_at };
}
const sourcePlatformHosts = {
  youtube: new Set(['youtube.com', 'www.youtube.com', 'youtu.be', 'www.youtube-nocookie.com']),
  soundcloud: new Set(['soundcloud.com', 'www.soundcloud.com', 'on.soundcloud.com']),
  tiktok: new Set(['tiktok.com', 'www.tiktok.com', 'vm.tiktok.com']),
  spotify: new Set(['open.spotify.com', 'spotify.link']),
  appleMusic: new Set(['music.apple.com', 'itunes.apple.com'])
};
function detectSourcePlatform(parsedUrl) {
  const hostname = parsedUrl.hostname.toLowerCase();
  return Object.entries(sourcePlatformHosts).find(([, hosts]) => hosts.has(hostname))?.[0] || null;
}
async function fetchSourceJson(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: controller.signal });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`Metadata provider returned HTTP ${response.status}.`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}
function sourceMetadataPayload(platform, sourceUrl, data) {
  return {
    platform,
    url: sourceUrl,
    metadata: {
      title: String(data.title || data.trackName || data.collectionName || '').trim() || null,
      thumbnail: String(data.thumbnail_url || data.artworkUrl100 || '').trim() || null,
      durationSeconds: Number.isFinite(Number(data.trackTimeMillis)) ? Math.round(Number(data.trackTimeMillis) / 1000) : null,
      creator: String(data.author_name || data.artistName || '').trim() || null
    },
    audio: { available: false, status: 'NOT_CONNECTED', reason: 'Metadata is available, but this server has no official audio source/download integration.' }
  };
}
async function probeDirectMediaSource(sourceUrl) {
  let parsedUrl;
  try { parsedUrl = new URL(sourceUrl); } catch { throw new Error('URL sumber tidak valid.'); }
  if (!['http:', 'https:'].includes(parsedUrl.protocol) || isBlockedRemoteHost(parsedUrl.hostname)) throw new Error('URL sumber harus berupa alamat HTTP/HTTPS publik.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(parsedUrl, { method: 'HEAD', redirect: 'follow', signal: controller.signal });
    if (!response.ok) throw new Error(`Sumber mengembalikan HTTP ${response.status}.`);
    const contentType = String(response.headers.get('content-type') || '').split(';')[0].toLowerCase();
    if (!contentType.startsWith('audio/') && !contentType.startsWith('video/')) throw new Error('URL tidak mengembalikan file audio/video langsung.');
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > 100 * 1024 * 1024) throw new Error('Ukuran sumber melebihi batas 100 MB.');
    const name = decodeURIComponent(path.basename(parsedUrl.pathname)) || 'remote-audio';
    return { platform: 'direct-media', url: parsedUrl.toString(), metadata: { title: name, thumbnail: null, durationSeconds: null, creator: null }, audio: { available: true, status: 'AVAILABLE', contentType, reason: 'Direct media source is available for server-side processing.' } };
  } finally {
    clearTimeout(timer);
  }
}
function isBlockedRemoteHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  return host === 'localhost' || host === '::1' || host === '0.0.0.0' || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) || host === 'metadata.google.internal';
}
async function downloadRemoteSource(sourceUrl) {
  let parsedUrl;
  try { parsedUrl = new URL(sourceUrl); } catch { throw new Error('URL sumber tidak valid.'); }
  if (!['http:', 'https:'].includes(parsedUrl.protocol) || isBlockedRemoteHost(parsedUrl.hostname)) throw new Error('URL sumber harus berupa alamat HTTP/HTTPS publik.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  const sourcePath = path.join(uploadDir, `${crypto.randomUUID()}.remote`);
  try {
    const response = await fetch(parsedUrl, { redirect: 'follow', signal: controller.signal });
    if (!response.ok) throw new Error(`Sumber mengembalikan HTTP ${response.status}.`);
    const contentType = String(response.headers.get('content-type') || '').split(';')[0].toLowerCase();
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > 100 * 1024 * 1024) throw new Error('Ukuran sumber melebihi batas 100 MB.');
    if (contentType.startsWith('text/html') || contentType === 'application/json') throw new Error('URL tidak mengembalikan file media langsung. Gunakan URL audio/video langsung.');
    if (!response.body) throw new Error('Sumber tidak mengembalikan isi file.');
    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(sourcePath));
    const stat = fs.statSync(sourcePath);
    if (!stat.size || stat.size > 100 * 1024 * 1024) throw new Error('File sumber kosong atau melebihi batas 100 MB.');
    return { path: sourcePath, originalName: safeName(path.basename(parsedUrl.pathname)) || 'remote-audio', contentType };
  } catch (error) {
    cleanup(sourcePath);
    if (error.name === 'AbortError') throw new Error('Download sumber timeout setelah 30 detik.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function googleReady() {
  return [googleClientId, googleClientSecret, process.env.GOOGLE_REDIRECT_URI, publicBaseUrl].every((value) => value && !value.startsWith('your-') && !value.startsWith('PASTE_'));
}
function sessionSecret() { return effectiveSessionSecret; }
function signSession(sessionId) { const signature = crypto.createHmac('sha256', sessionSecret()).update(sessionId).digest('hex'); return `${sessionId}.${signature}`; }
function readCookie(req, name) { const cookies = String(req.headers.cookie || '').split(';').map((item) => item.trim()); const value = cookies.find((item) => item.startsWith(`${name}=`)); return value ? decodeURIComponent(value.slice(name.length + 1)) : ''; }
function authSession(req) {
  const value = readCookie(req, 'rival_auth');
  if (!value || !sessionSecret()) return null;
  const separator = value.lastIndexOf('.'); const sessionId = value.slice(0, separator); const signature = value.slice(separator + 1);
  if (!sessionId || !signature) return null;
  const expected = crypto.createHmac('sha256', sessionSecret()).update(sessionId).digest('hex');
  if (signature.length !== expected.length) return null;
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected)) ? sessions.get(sessionId) : null;
}
function requestEmail(req) {
  return String(req.session?.googleUser?.email || authSession(req)?.user?.email || '').trim().toLowerCase();
}
function isPaymentAdmin(req) { return requestEmail(req) === paymentAdminEmail; }
function canAccessPayment(req, order) { return Boolean(order && (isPaymentAdmin(req) || requestEmail(req) === String(order.customerEmail || '').trim().toLowerCase())); }
function authCookie(value, maxAge = 7 * 24 * 60 * 60) { return `rival_auth=${encodeURIComponent(value)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${isProduction ? '; Secure' : ''}`; }
function googleStateCookie(value, maxAge = 10 * 60) {
  const payload = value ? `${value}.${crypto.createHmac('sha256', sessionSecret()).update(`google:${value}`).digest('hex')}` : '';
  return `rival_google_oauth_state=${encodeURIComponent(payload)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${isProduction ? '; Secure' : ''}`;
}
function readSignedCookie(req, name, prefix) {
  const raw = readCookie(req, name);
  if (!raw || !sessionSecret()) return null;
  const separator = raw.lastIndexOf('.');
  if (separator <= 0) return null;
  const value = raw.slice(0, separator);
  const signature = raw.slice(separator + 1);
  if (!value || !signature) return null;
  const expected = crypto.createHmac('sha256', sessionSecret()).update(`${prefix}:${value}`).digest('hex');
  if (signature.length !== expected.length) return null;
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected)) ? value : null;
}
function safeName(value) { return String(value || 'audio').replace(/[^a-z0-9._-]/gi, '-').slice(0, 80); }
function deriveRobloxApiKeyEncryptionKey() { return crypto.createHash('sha256').update(effectiveRobloxKeySecret).digest(); }
function encryptRobloxApiKey(value) {
  const key = deriveRobloxApiKeyEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(String(value)), cipher.final()]);
  return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${encrypted.toString('hex')}`;
}
function decryptRobloxApiKey(value) {
  if (!value) return '';
  const [ivHex, tagHex, encryptedHex] = String(value).split(':');
  if (!ivHex || !tagHex || !encryptedHex) return '';
  try {
    const key = deriveRobloxApiKeyEncryptionKey();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(encryptedHex, 'hex')), decipher.final()]).toString('utf8');
  } catch (error) {
    return '';
  }
}
function requireUser(req, res) { if (!req.session?.googleUser?.id) { res.status(401).json({ error: 'Login Google diperlukan untuk menggunakan fitur ini.' }); return false; } return true; }
function requireRobloxSecret(res) { if (!robloxKeySecretReady) { res.status(503).json({ error: 'Roblox integration belum aktif. Admin harus mengatur ROBLOX_API_KEY_SECRET sebagai Railway Environment Variable.' }); return false; } return true; }
function getRobloxApiSession(req) {
  const connectionId = req.session?.robloxApiConnectionId;
  if (!connectionId) return null;
  const connection = robloxApiConnections.get(connectionId);
  return connection ? { ...connection, connectionId } : null;
}
function setRobloxApiSession(req, data) {
  const connectionId = crypto.randomUUID();
  robloxApiConnections.set(connectionId, data);
  req.session.robloxApiConnectionId = connectionId;
  return data;
}
function clearRobloxApiSession(req) {
  const connectionId = req.session?.robloxApiConnectionId;
  if (connectionId) robloxApiConnections.delete(connectionId);
  delete req.session.robloxApiConnectionId;
}
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function robloxResponseHeaders(response) {
  return ['content-type', 'location', 'retry-after', 'x-request-id', 'trace-id']
    .reduce((headers, name) => {
      const value = response.headers.get(name);
      if (value) headers[name] = value.slice(0, 200);
      return headers;
    }, {});
}
function sanitizeRobloxLog(value) {
  return String(value || '')
    .replace(/(x-api-key|authorization|cookie|token|secret|password)\s*[:=]\s*[^,\s}]+/gi, '$1=[redacted]')
    .slice(0, 1500);
}
function logRobloxResponse(label, response, rawBody, data) {
  console.warn(`[Roblox ${label}] response`, {
    status: response.status,
    headers: robloxResponseHeaders(response),
    body: sanitizeRobloxLog(rawBody),
    parsed: summarizeRobloxResponse(data)
  });
}
async function readRobloxResponse(response) {
  const rawBody = await response.text();
  let data = {};
  try { data = rawBody ? JSON.parse(rawBody) : {}; } catch { data = { raw: rawBody }; }
  return { rawBody, data };
}
function extractAssetIdFromValue(value) {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;
  const text = String(value || '').trim();
  if (/^\d+$/.test(text)) return Number(text);
  const match = text.match(/(?:^|\/)assets?\/(\d+)(?:$|[/?#])/i);
  return match ? Number(match[1]) : 0;
}
function audioContentType(file) {
  const knownTypes = new Set(['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/flac', 'audio/aac', 'audio/mp4', 'audio/webm']);
  if (knownTypes.has(String(file?.mimetype || '').toLowerCase())) return String(file.mimetype).toLowerCase() === 'audio/x-wav' ? 'audio/wav' : String(file.mimetype).toLowerCase();
  const extension = path.extname(String(file?.originalname || '')).toLowerCase();
  return ({ '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.flac': 'audio/flac', '.aac': 'audio/aac', '.m4a': 'audio/mp4', '.webm': 'audio/webm' })[extension] || '';
}
function extractRobloxAssetId(data) {
  const directCandidates = [
    data?.assetId, data?.asset_id, data?.asset,
    data?.response?.assetId, data?.response?.asset_id, data?.response?.asset,
    data?.result?.assetId, data?.result?.asset_id, data?.result?.asset,
    data?.operation?.assetId, data?.operation?.asset,
    data?.response?.result?.assetId, data?.response?.result?.asset_id, data?.response?.result?.asset
  ];
  const directValue = directCandidates.map(extractAssetIdFromValue).find(Boolean);
  if (directValue) return directValue;
  const search = (value, path = '', depth = 0) => {
    if (!value || typeof value !== 'object' || depth > 8) return 0;
    for (const [key, nested] of Object.entries(value)) {
      const normalizedKey = key.toLowerCase().replace(/[-_]/g, '');
      const nestedPath = `${path}.${key}`.toLowerCase();
      if (['assetid', 'assetidentifier', 'asset'].includes(normalizedKey)) {
        const assetId = extractAssetIdFromValue(nested);
        if (assetId) return assetId;
      }
      if (key.toLowerCase() === 'id' && /(response|result|asset)/.test(nestedPath)) {
        const assetId = extractAssetIdFromValue(nested);
        if (assetId) return assetId;
      }
      if (key.toLowerCase() === 'path') {
        const assetId = extractAssetIdFromValue(nested);
        if (assetId) return assetId;
      }
      const found = search(nested, nestedPath, depth + 1);
      if (found) return found;
    }
    return 0;
  };
  return search(data);
}
function summarizeRobloxResponse(data) {
  if (!data || typeof data !== 'object') return { type: typeof data };
  const summary = { keys: Object.keys(data).slice(0, 30) };
  if (data.status !== undefined) summary.status = String(data.status);
  if (data.state !== undefined) summary.state = String(data.state);
  if (data.done !== undefined) summary.done = Boolean(data.done);
  return summary;
}
function robloxOperationError(data, fallback = 'Roblox moderation failed.') {
  return data?.error?.message || data?.error?.details || data?.message || data?.detail || data?.result?.error?.message || data?.response?.error?.message || fallback;
}
async function pollRobloxOperation(apiKey, operationId) {
  const maxAttempts = Math.max(1, Number(process.env.ROBLOX_OPERATION_MAX_ATTEMPTS || 60));
  const pollIntervalMs = Math.max(500, Number(process.env.ROBLOX_OPERATION_POLL_INTERVAL_MS || 2000));
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const response = await fetchRobloxWithBackoff(`https://apis.roblox.com/assets/v1/operations/${encodeURIComponent(operationId)}`, { method: 'GET', headers: { 'x-api-key': apiKey, Accept: 'application/json' } });
    const { rawBody, data } = await readRobloxResponse(response);
    if (!response.ok) logRobloxResponse('operation request failed', response, rawBody, data);
    if (response.status === 401) throw new Error('AUTHENTICATION_INVALID');
    if (response.status === 403) throw new Error('PERMISSION_OR_RESOURCE_DENIED');
    if (response.status === 429) throw new Error('Upload limit reached.');
    if (response.status >= 500) throw new Error('Roblox API unavailable.');
    if (!response.ok) {
      throw new Error(robloxOperationError(data));
    }
    console.info('[Roblox operation] poll', { status: response.status, operation: `${operationId.slice(0, 8)}...`, attempt: attempt + 1, response: summarizeRobloxResponse(data) });
    const state = String(data.status || data.state || data.metadata?.status || '').toLowerCase();
    if (data.error || data.response?.error || data.result?.error) throw new Error(robloxOperationError(data));
    if (data.done === true || ['completed', 'complete', 'succeeded', 'success'].includes(state)) return data;
    if (['failed', 'cancelled', 'canceled'].includes(state)) throw new Error(robloxOperationError(data));
    await sleep(pollIntervalMs);
  }
  throw new Error('Roblox is still processing this upload. Please try again in a moment.');
}
async function fetchRobloxWithBackoff(url, options, maxAttempts = 3) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const response = await fetch(url, options);
    if (response.status !== 429 || attempt === maxAttempts - 1) return response;
    await sleep(500 * (2 ** attempt));
  }
  return null;
}
async function verifyRobloxApiKey(apiKey, creatorType, creatorId) {
  const resource = creatorType === 'group' ? 'groups' : 'users';
  const response = await fetchRobloxWithBackoff(`https://apis.roblox.com/cloud/v2/${resource}/${encodeURIComponent(creatorId)}`, { method: 'GET', headers: { 'x-api-key': apiKey, Accept: 'application/json' } });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401) throw new Error('Roblox API key tidak valid atau sudah kedaluwarsa.');
  if (response.status === 403) throw new Error('API key tidak memiliki akses ke target User/Group ini.');
  if (response.status === 404) throw new Error('User/Group ID tidak ditemukan di Roblox.');
  if (!response.ok) throw new Error(payload?.message || payload?.error || 'Roblox gagal memvalidasi API key.');
  return payload;
}
function runFfmpeg(input, output, args) {
  return new Promise((resolve, reject) => {
    const process = spawn(ffmpegCommand, ['-y', '-i', input, ...args, output]);
    let error = '';
    process.stderr.on('data', (chunk) => { error += chunk.toString(); });
    process.on('error', (spawnError) => {
      if (spawnError.code === 'ENOENT') return reject(new Error(`FFmpeg tidak ditemukan pada "${ffmpegCommand}". Pastikan FFmpeg terpasang di deployment atau atur FFMPEG_PATH.`));
      reject(spawnError);
    });
    process.on('close', (code) => code === 0 ? resolve() : reject(new Error(error.slice(-800) || 'Konversi gagal.')));
  });
}
function cleanup(...files) { files.forEach((file) => file && fs.rm(file, { force: true }, () => {})); }

app.get('/api/health', (req, res) => res.json({ ok: true, robloxConfigured: robloxKeySecretReady, ffmpegConfigured: Boolean(ffmpegCommand) }));
app.get('/api/usage', async (req, res) => {
  try {
    if (!requestEmail(req)) return res.status(401).json({ error: 'Login diperlukan.' });
    await paymentDatabaseReady;
    const usage = await getUsageState(req);
    const creditRows = await databaseAll('SELECT credits FROM credit_balances WHERE customer_email = ?', [requestEmail(req)]);
    const subscription = await getActiveSubscription(requestEmail(req));
    res.json({ ...usage, credits: Number(creditRows[0]?.credits || 0), subscription: subscription ? { planName: subscription.plan_name, expiryDate: subscription.expiry_date, status: 'ACTIVE' } : null });
  } catch (error) {
    res.status(503).json({ error: 'Status penggunaan belum siap.' });
  }
});
app.get('/api/session', (req, res) => {
  const email = requestEmail(req);
  if (!email) return res.status(401).json({ error: 'Login diperlukan.' });
  res.json({ connected: true, history: history.filter((item) => item.ownerEmail === email) });
});
const paymentPlans = {
  '1-month': { id: '1-month', name: '1 MONTH', price: 100000, amount: 100000, duration: '1 bulan', durationLabel: '1 month', durationMonths: 1, type: 'subscription', benefits: ['Akses premium 1 bulan', 'Semua fitur audio converter', 'Fitur lanjutan tanpa batasan dasar', 'Prioritas dukungan'], credits: 0 },
  '2-months': { id: '2-months', name: '2 MONTHS', price: 180000, amount: 180000, duration: '2 bulan', durationLabel: '2 months', durationMonths: 2, type: 'subscription', benefits: ['Akses premium 2 bulan', 'Semua fitur audio converter', 'Prioritas pemrosesan', 'Support lebih cepat'], credits: 0 },
  '3-months': { id: '3-months', name: '3 MONTHS', price: 280000, amount: 280000, duration: '3 bulan', durationLabel: '3 months', durationMonths: 3, type: 'subscription', benefits: ['Akses premium 3 bulan', 'Fitur lengkap tanpa batas', 'Pemrosesan cepat', 'Prioritas helpdesk'], credits: 0 },
  '1-year': { id: '1-year', name: '1 YEAR', price: 800000, amount: 800000, duration: '1 tahun', durationLabel: '1 year', durationMonths: 12, type: 'subscription', benefits: ['Akses premium 1 tahun', 'Semua fitur tanpa batas', 'Komitmen hemat', 'Upgrade prioritas permanen'], credits: 0 },
  'join-team': { id: 'join-team', name: 'JOIN TEAM', price: 1800000, amount: 1800000, duration: 'Team', durationLabel: 'Team', durationMonths: 12, type: 'team', benefits: ['Akses tim sampai 5 member', 'Management team', 'Prioritas review cepat', 'Fitur kolaborasi premium'], credits: 0 }
};
app.get('/api/payments/plans', (req, res) => {
  res.json(Object.values(paymentPlans).map((plan) => ({
    ...plan,
    priceDisplay: `Rp${Number(plan.price).toLocaleString('id-ID')}`,
    priceLabel: `Rp${Number(plan.price).toLocaleString('id-ID')}`
  })));
});
app.get('/api/payments/config', async (req, res) => {
  try {
    const settings = await getPaymentSettings();
    res.json(paymentSettingsPayload(settings));
  } catch (error) {
    res.status(503).json({ error: 'Konfigurasi pembayaran belum siap.' });
  }
});
app.get('/api/payments/qr', async (req, res) => {
  try {
    const settings = await getPaymentSettings();
    const fileName = path.basename(String(settings.qr_image || ''));
    const candidates = [path.join(uploadDir, fileName), path.join(root, fileName), path.join(root, 'client', fileName)].filter(Boolean);
    const filePath = candidates.find((candidate) => fs.existsSync(candidate));
    if (!filePath) return res.status(404).json({ error: 'QR pembayaran belum diatur admin.' });
    res.sendFile(filePath);
  } catch (error) {
    res.status(503).json({ error: 'QR pembayaran belum siap.' });
  }
});
app.get('/api/admin/payment-settings', async (req, res) => {
  if (!isPaymentAdmin(req)) return res.status(403).json({ error: 'Khusus admin pembayaran.' });
  try {
    res.json(paymentSettingsPayload(await getPaymentSettings()));
  } catch (error) {
    res.status(503).json({ error: 'Konfigurasi pembayaran belum siap.' });
  }
});
app.put('/api/admin/payment-settings', async (req, res) => {
  if (!isPaymentAdmin(req)) return res.status(403).json({ error: 'Khusus admin pembayaran.' });
  const paymentTarget = String(req.body?.paymentTarget || '').trim().slice(0, 500);
  if (!paymentTarget) return res.status(400).json({ error: 'Tujuan pembayaran wajib diisi.' });
  try {
    await databaseRun('UPDATE payment_settings SET payment_target = ?, updated_at = ? WHERE id = 1', [paymentTarget, new Date().toISOString()]);
    res.json(paymentSettingsPayload(await getPaymentSettings()));
  } catch (error) {
    res.status(503).json({ error: 'Konfigurasi pembayaran gagal disimpan.' });
  }
});
app.post('/api/admin/payment-settings/qr', imageUpload.single('qr'), async (req, res) => {
  if (!isPaymentAdmin(req)) {
    if (req.file) cleanup(req.file.path);
    return res.status(403).json({ error: 'Khusus admin pembayaran.' });
  }
  if (!req.file) return res.status(400).json({ error: 'File QR PNG, JPG, atau WEBP wajib diunggah.' });
  try {
    await databaseRun('UPDATE payment_settings SET qr_image = ?, updated_at = ? WHERE id = 1', [path.basename(req.file.filename), new Date().toISOString()]);
    res.json(paymentSettingsPayload(await getPaymentSettings()));
  } catch (error) {
    cleanup(req.file.path);
    res.status(503).json({ error: 'QR pembayaran gagal disimpan.' });
  }
});
app.get('/api/credits', async (req, res) => {
  const email = requestEmail(req);
  if (!email) return res.status(401).json({ error: 'Login diperlukan.' });
  if (isPaymentAdmin(req)) return res.json({ credits: null, unlimited: true });
  const rows = await databaseAll('SELECT credits FROM credit_balances WHERE customer_email = ?', [email]);
  res.json({ credits: Number(rows[0]?.credits || 0), unlimited: false });
});
app.get('/api/payments', (req, res) => {
  const email = requestEmail(req);
  if (!email) return res.status(401).json({ error: 'Login diperlukan untuk melihat pembelian.' });
  const orders = isPaymentAdmin(req) ? paymentOrders : paymentOrders.filter((order) => String(order.customerEmail || '').toLowerCase() === email);
  res.json(orders.map((order) => ({
    ...order,
    status: normalizeOrderStatus(order.status),
    orderNumber: order.orderNumber || order.id,
    planName: order.planName || order.plan_id,
    amount: Number(order.amount || 0),
    createdAt: order.createdAt || new Date().toISOString()
  })));
});

app.get('/api/payments/:id', async (req, res) => {
  const order = paymentOrders.find((item) => item.id === req.params.id || item.orderNumber === req.params.id);
  if (!order) return res.status(404).json({ error: 'Order tidak ditemukan.' });
  if (!canAccessPayment(req, order)) return res.status(403).json({ error: 'Anda tidak memiliki akses ke order ini.' });
  res.json({ ...order, status: normalizeOrderStatus(order.status) });
});
app.get('/api/admin/payments', async (req, res) => {
  if (!isPaymentAdmin(req)) return res.status(403).json({ error: 'Khusus admin pembayaran.' });
  try {
    await paymentDatabaseReady;
    const orders = await databaseAll('SELECT * FROM payment_orders ORDER BY created_at DESC');
    res.json(orders.map((item) => ({ id: item.id, orderNumber: item.order_number, customerName: item.customer_name, customerEmail: item.customer_email, planName: item.plan_name, amount: item.amount, credits: item.credits || 0, status: item.status, createdAt: item.created_at, paymentTarget: item.payment_target, qrImage: item.qr_image, notes: item.notes, proofUrl: item.proof_url, uploadedAt: item.uploaded_at, adminNotes: item.admin_notes })));
  } catch (error) {
    res.status(503).json({ error: 'Data pembayaran belum siap.' });
  }
});
app.post('/api/payments/create', async (req, res) => {
  const planId = String(req.body?.planId || req.body?.plan?.id || '').trim();
  const plan = paymentPlans[planId];
  const customerName = String(req.session?.googleUser?.name || req.body?.customerName || 'Customer').trim();
  const customerEmail = requestEmail(req);
  if (!customerEmail) return res.status(401).json({ error: 'Login diperlukan untuk membuat order.' });
  if (!plan) return res.status(400).json({ error: 'Paket tidak valid.' });
  const paymentSettings = await getPaymentSettings();
  const orderNumber = `BMK-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
  const order = {
    id: `${orderNumber}`,
    orderNumber,
    customerName,
    customerEmail,
    planId: plan.id,
    planName: plan.name,
    amount: Number(plan.amount),
    duration: plan.duration,
    credits: Number(plan.credits || 0),
    status: 'PENDING',
    createdAt: new Date().toISOString(),
    paymentTarget: paymentSettings.payment_target,
    qrImage: paymentSettings.qr_image ? '/api/payments/qr' : null,
    notes: '',
    proofUrl: null,
    adminNotes: '',
    transactionId: `tx-${crypto.randomUUID().slice(0, 12)}`,
    reviewedAt: null,
    reviewedBy: null,
    username: req.session?.googleUser?.name || customerName,
    subscriptionStart: null,
    subscriptionExpiry: null
  };
  paymentOrders.unshift(order);
  await savePaymentData();
  res.json(order);
});
app.post('/api/payments/:id/proof', imageUpload.single('proof'), async (req, res) => {
  const order = paymentOrders.find((item) => item.id === req.params.id || item.orderNumber === req.params.id);
  if (!order) { cleanup(req.file?.path); return res.status(404).json({ error: 'Order tidak ditemukan.' }); }
  if (!canAccessPayment(req, order)) { cleanup(req.file?.path); return res.status(403).json({ error: 'Anda tidak memiliki akses ke order ini.' }); }
  if (normalizeOrderStatus(order.status) === 'APPROVED') { cleanup(req.file?.path); return res.status(409).json({ error: 'Order yang sudah disetujui tidak dapat diubah.' }); }
  if (!req.file) return res.status(400).json({ error: 'Bukti pembayaran wajib diunggah.' });
  order.proofUrl = `/api/download-proof/${encodeURIComponent(req.file.filename)}`;
  order.notes = String(req.body.notes || '').trim();
  order.status = 'PENDING';
  order.uploadedAt = new Date().toISOString();
  order.reviewedAt = null;
  order.reviewedBy = null;
  await savePaymentData();
  res.json({ ok: true, order });
});
app.get('/api/download-proof/:file', (req, res) => {
  const file = path.basename(req.params.file);
  const order = paymentOrders.find((item) => String(item.proofUrl || '').endsWith(`/${file}`));
  if (!canAccessPayment(req, order)) return res.status(403).json({ error: 'Anda tidak memiliki akses ke bukti pembayaran ini.' });
  const filePath = path.join(uploadDir, file);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Bukti pembayaran tidak ditemukan.' });
  res.download(filePath, file);
});
app.post('/api/payments/:id/status', async (req, res) => {
  const order = paymentOrders.find((item) => item.id === req.params.id || item.orderNumber === req.params.id);
  if (!order) return res.status(404).json({ error: 'Order tidak ditemukan.' });
  if (!isPaymentAdmin(req)) return res.status(403).json({ error: 'Hanya admin pembayaran yang dapat mengubah status order.' });
  const rawStatus = String(req.body.status || '').trim();
  const status = normalizeOrderStatus(rawStatus);
  if (!['PENDING', 'APPROVED', 'REJECTED'].includes(status)) return res.status(400).json({ error: 'Status tidak valid.' });
  if (normalizeOrderStatus(order.status) === 'APPROVED' && status !== 'APPROVED') return res.status(409).json({ error: 'Order yang sudah disetujui tidak dapat dibatalkan.' });
  if (normalizeOrderStatus(order.status) === 'APPROVED' && status === 'APPROVED') return res.status(409).json({ error: 'Order ini sudah disetujui sebelumnya.' });
  order.status = status;
  order.adminNotes = String(req.body.adminNotes || '');
  order.reviewedAt = new Date().toISOString();
  order.reviewedBy = paymentAdminEmail;
  order.transactionId = order.transactionId || `tx-${crypto.randomUUID().slice(0, 12)}`;
  if (status === 'APPROVED') {
    const startDate = new Date();
    const plan = paymentPlans[order.planId] || { durationMonths: 1 };
    const expiryDate = new Date(startDate);
    expiryDate.setMonth(expiryDate.getMonth() + Number(plan.durationMonths || 1));

    const existing = (await databaseAll('SELECT * FROM user_subscriptions WHERE email = ? ORDER BY expiry_date DESC LIMIT 1', [order.customerEmail]))[0];
    let nextStartDate = startDate.toISOString();
    let nextExpiryDate = expiryDate.toISOString();
    if (existing && new Date(existing.expiry_date).getTime() > Date.now()) {
      nextStartDate = new Date(existing.expiry_date).toISOString();
      const extended = new Date(existing.expiry_date);
      extended.setMonth(extended.getMonth() + Number(plan.durationMonths || 1));
      nextExpiryDate = extended.toISOString();
    }

    const subscriptionData = {
      userId: order.customerEmail,
      username: order.username || order.customerName,
      email: order.customerEmail,
      planId: order.planId,
      planName: order.planName,
      duration: order.duration || plan.duration,
      amount: Number(order.amount || plan.amount),
      status: 'ACTIVE',
      startDate: nextStartDate,
      expiryDate: nextExpiryDate,
      transactionId: order.transactionId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const existingSubscription = await databaseAll('SELECT id FROM user_subscriptions WHERE user_id = ? AND email = ?', [subscriptionData.userId, order.customerEmail]);
    if (existingSubscription.length) {
      await databaseRun('UPDATE user_subscriptions SET username = ?, plan_id = ?, plan_name = ?, duration = ?, amount = ?, status = ?, start_date = ?, expiry_date = ?, updated_at = ?, transaction_id = ? WHERE user_id = ? AND email = ?', [subscriptionData.username, subscriptionData.planId, subscriptionData.planName, subscriptionData.duration, subscriptionData.amount, 'ACTIVE', subscriptionData.startDate, subscriptionData.expiryDate, subscriptionData.updatedAt, subscriptionData.transactionId, subscriptionData.userId, order.customerEmail]);
    } else {
      await databaseRun('INSERT INTO user_subscriptions (user_id, username, email, plan_id, plan_name, duration, amount, status, start_date, expiry_date, created_at, updated_at, transaction_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [subscriptionData.userId, subscriptionData.username, subscriptionData.email, subscriptionData.planId, subscriptionData.planName, subscriptionData.duration, subscriptionData.amount, 'ACTIVE', subscriptionData.startDate, subscriptionData.expiryDate, subscriptionData.createdAt, subscriptionData.updatedAt, subscriptionData.transactionId]);
    }
    order.subscriptionStart = subscriptionData.startDate;
    order.subscriptionExpiry = subscriptionData.expiryDate;
    await databaseRun('INSERT OR IGNORE INTO credit_grants (order_id, customer_email, credits, granted_at) VALUES (?, ?, ?, ?)', [order.id, order.customerEmail, order.credits || 0, new Date().toISOString()]);
    if (order.credits > 0) await databaseRun('INSERT INTO credit_balances (customer_email, credits, updated_at) VALUES (?, ?, ?) ON CONFLICT(customer_email) DO UPDATE SET credits = credits + excluded.credits, updated_at = excluded.updated_at', [order.customerEmail, order.credits, new Date().toISOString()]);
    if (!chatRooms.some((room) => room.orderId === order.id)) {
      chatRooms.push({ orderId: order.id, participants: [order.customerName, 'Seller'], messages: [{ sender: 'Seller', text: 'Halo! Pembayaran sudah diterima. Selamat menikmati akses premium.', sentAt: new Date().toISOString() }] });
    }
  }
  if (status === 'REJECTED') {
    order.subscriptionStart = null;
    order.subscriptionExpiry = null;
  }
  await savePaymentData();
  res.json({ ok: true, order });
});
app.get('/api/chats/:orderId', (req, res) => {
  const order = paymentOrders.find((item) => item.id === req.params.orderId || item.orderNumber === req.params.orderId);
  if (!canAccessPayment(req, order)) return res.status(403).json({ error: 'Anda tidak memiliki akses ke chat order ini.' });
  const room = chatRooms.find((item) => item.orderId === order.id);
  if (!room) return res.json({ orderId: order.id, messages: [] });
  res.json(room);
});
app.post('/api/chats/:orderId', async (req, res) => {
  const order = paymentOrders.find((item) => item.id === req.params.orderId || item.orderNumber === req.params.orderId);
  if (!canAccessPayment(req, order)) return res.status(403).json({ error: 'Anda tidak memiliki akses ke chat order ini.' });
  const room = chatRooms.find((item) => item.orderId === order.id);
  const sender = isPaymentAdmin(req) ? 'Seller' : 'Customer';
  const text = String(req.body.text || '').trim();
  if (!room || !text) return res.status(400).json({ error: 'Chat tidak valid.' });
  room.messages.push({ sender, text, sentAt: new Date().toISOString() });
  await savePaymentData();
  res.json({ ok: true, room });
});
app.get('/api/auth/me', (req, res) => {
  if (req.session.googleUser) return res.json({ authenticated: true, user: req.session.googleUser });
  const session = authSession(req);
  if (!session?.user) return res.status(401).json({ authenticated: false });
  res.json({ authenticated: true, user: session.user });
});
app.put('/api/profile', (req, res) => {
  if (!req.session.googleUser) return res.status(401).json({ error: 'Login diperlukan.' });
  const name = String(req.body?.name || '').trim().slice(0, 80);
  if (!name) return res.status(400).json({ error: 'Nama wajib diisi.' });
  req.session.googleUser.name = name;
  req.session.save((error) => error ? res.status(500).json({ error: 'Profil gagal disimpan.' }) : res.json({ ok: true, user: req.session.googleUser }));
});
app.get('/api/auth/config', (req, res) => res.json({ googleConfigured: googleReady() }));
app.get('/api/admin/status', (req, res) => res.json({ isAdmin: isPaymentAdmin(req) }));
app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => { res.setHeader('Set-Cookie', authCookie('', 0)); res.json({ success: true }); });
});
app.get('/auth/google', (req, res) => {
  if (!sessionSecret()) return res.status(503).send('SESSION_SECRET belum dikonfigurasi dengan nilai random yang aman.');
  if (!googleReady()) return res.status(503).send('Google OAuth belum dikonfigurasi. Isi GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, dan PUBLIC_BASE_URL di environment variable.');
  const state = crypto.randomBytes(24).toString('hex');
  req.session.googleOAuthState = state;
  const stateCookie = googleStateCookie(state);
  const params = new URLSearchParams({ client_id: googleClientId, redirect_uri: process.env.GOOGLE_REDIRECT_URI, response_type: 'code', scope: 'openid email profile', state, access_type: 'offline', prompt: 'select_account' });
  req.session.save((error) => {
    if (error) return res.status(500).send('Session OAuth Google gagal disimpan.');
    res.append('Set-Cookie', stateCookie);
    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  });
});
app.get('/auth/google/callback', async (req, res) => {
  if (!googleReady()) return res.status(503).send('Google OAuth belum dikonfigurasi. Isi GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, dan PUBLIC_BASE_URL di environment variable.');
  const receivedState = String(req.query.state || '');
  const expectedStateFromSession = req.session.googleOAuthState;
  const expectedStateFromCookie = readSignedCookie(req, 'rival_google_oauth_state', 'google');
  const expectedState = expectedStateFromSession || expectedStateFromCookie;
  if (!expectedState || !receivedState || expectedState.length !== receivedState.length || !crypto.timingSafeEqual(Buffer.from(expectedState), Buffer.from(receivedState))) {
    res.append('Set-Cookie', googleStateCookie('', 0));
    return res.status(400).send('Google OAuth state tidak valid. Silakan coba lagi.');
  }
  delete req.session.googleOAuthState;
  res.append('Set-Cookie', googleStateCookie('', 0));
  await new Promise((resolve, reject) => req.session.save((error) => error ? reject(error) : resolve()));
  try {
    const body = new URLSearchParams({ code: req.query.code, client_id: googleClientId, client_secret: googleClientSecret, redirect_uri: process.env.GOOGLE_REDIRECT_URI, grant_type: 'authorization_code' });
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    const tokens = await tokenResponse.json();
    if (!tokenResponse.ok) throw new Error(tokens.error_description || 'Google token exchange gagal.');
    const profileResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    const profile = await profileResponse.json();
    if (!profileResponse.ok || !profile.sub || profile.email_verified !== true) throw new Error('Profil Google tidak dapat diverifikasi.');
    req.session.googleUser = { id: profile.sub, name: profile.name || profile.email, email: profile.email, avatar: profile.picture || '' };
    await new Promise((resolve, reject) => req.session.save((error) => error ? reject(error) : resolve()));
    res.redirect(`${publicBaseUrl}/`);
  } catch (error) { res.status(502).send(`Google OAuth gagal: ${error.message}`); }
});

app.post('/api/youtube/validate', (req, res) => {
  const value = String(req.body.url || '').trim();
  let parsed;
  try { parsed = new URL(value); } catch { return res.status(400).json({ error: 'Masukkan URL YouTube yang valid.' }); }
  if (!['youtube.com', 'www.youtube.com', 'youtu.be', 'www.youtube-nocookie.com'].includes(parsed.hostname)) return res.status(400).json({ error: 'URL harus berasal dari YouTube.' });
  res.json({ valid: true, message: 'URL dikenali. Untuk menjaga hak cipta, aplikasi tidak mengunduh konten YouTube; unggah file audio yang kamu miliki haknya.' });
});
app.post('/api/source/detect', async (req, res) => {
  const rawUrl = String(req.body?.url || '').trim();
  let parsedUrl;
  try { parsedUrl = new URL(rawUrl); } catch { return res.status(400).json({ ok: false, error: 'Masukkan URL yang valid.' }); }
  const platform = detectSourcePlatform(parsedUrl);
  if (!platform) {
    try { return res.json({ ok: true, ...(await probeDirectMediaSource(parsedUrl.toString())) }); } catch (error) { return res.status(400).json({ ok: false, error: error.message || 'URL bukan platform atau direct media yang didukung.' }); }
  }
  try {
    const encodedUrl = encodeURIComponent(parsedUrl.toString());
    if (platform === 'appleMusic') {
      const payload = await fetchSourceJson(`https://itunes.apple.com/lookup?url=${encodedUrl}`);
      const item = Array.isArray(payload.results) ? payload.results[0] : null;
      if (!item) return res.status(404).json({ ok: false, error: 'Apple Music tidak mengembalikan metadata untuk URL ini.' });
      return res.json({ ok: true, ...sourceMetadataPayload(platform, parsedUrl.toString(), item) });
    }
    const oembedHost = platform === 'youtube' ? 'www.youtube.com/oembed' : platform === 'soundcloud' ? 'soundcloud.com/oembed' : platform === 'tiktok' ? 'www.tiktok.com/oembed' : 'open.spotify.com/oembed';
    const payload = await fetchSourceJson(`https://${oembedHost}?url=${encodedUrl}&format=json`);
    res.json({ ok: true, ...sourceMetadataPayload(platform, parsedUrl.toString(), payload) });
  } catch (error) {
    const reason = error.name === 'AbortError' ? 'Metadata provider timeout.' : error.message;
    console.warn('[Source detect] provider failed', { platform, status: reason });
    res.status(502).json({ ok: false, platform, error: `Metadata ${platform} tidak dapat diakses: ${reason}` });
  }
});
app.post('/api/source/download', async (req, res) => {
  const sourceUrl = String(req.body?.url || '').trim();
  const format = String(req.body?.format || 'mp3').toLowerCase();
  const speed = Number.parseFloat(String(req.body?.speed ?? '1').trim());
  if (!['mp3', 'wav', 'ogg', 'flac'].includes(format)) return res.status(400).json({ ok: false, error: 'Format output tidak didukung.' });
  if (!Number.isFinite(speed) || speed < 0.5 || speed > 4) return res.status(400).json({ ok: false, error: 'Play Speed harus antara 0.50 dan 4.00.' });
  let source;
  const id = crypto.randomUUID();
  const outputName = `${id}.${format}`;
  const output = path.join(outputDir, outputName);
  try {
    source = await downloadRemoteSource(sourceUrl);
    const audioFilters = speed === 1 ? [] : [speed <= 2 ? `atempo=${speed}` : 'atempo=2', ...(speed > 2 ? [`atempo=${(speed / 2).toFixed(3)}`] : [])];
    const codecArgs = format === 'wav' ? ['-c:a', 'pcm_s16le'] : format === 'flac' ? ['-c:a', 'flac'] : format === 'ogg' ? ['-c:a', 'libvorbis', '-q:a', '6'] : ['-c:a', 'libmp3lame', '-b:a', '192k'];
    const args = [...(audioFilters.length ? ['-filter:a', audioFilters.join(',')] : []), ...codecArgs];
    await runFfmpeg(source.path, output, args);
    const stat = fs.statSync(output);
    outputOwners.set(outputName, requestEmail(req));
    await saveOutputOwner(outputName, requestEmail(req));
    setTimeout(() => cleanup(output), 15 * 60 * 1000).unref();
    res.json({ ok: true, id, name: `${source.originalName.replace(/\.[^.]+$/, '') || 'remote-audio'}${speed === 1 ? '' : `-speed-${speed.toFixed(2)}`}.${format}`, format, speed, size: stat.size, downloadUrl: `/api/download/${outputName}`, sourceUrl });
  } catch (error) {
    cleanup(source?.path, output);
    console.warn('[Source download] failed', { message: error.message });
    res.status(502).json({ ok: false, error: error.message || 'Sumber audio tidak dapat diproses.' });
  }
});

app.post('/api/convert', upload.single('audio'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'File musik atau video wajib dipilih.' });
  const format = String(req.body.format || 'mp3').toLowerCase();
  const quality = String(req.body.quality || '192');
  if (!['mp3', 'wav', 'ogg', 'flac'].includes(format)) { cleanup(req.file.path); return res.status(400).json({ error: 'Format output tidak didukung.' }); }
  const id = crypto.randomUUID();
  const output = path.join(outputDir, `${id}.${format}`);
  const args = format === 'wav' ? ['-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le'] : format === 'flac' ? ['-ar', '48000', '-ac', '2', '-c:a', 'flac'] : format === 'ogg' ? ['-ar', '48000', '-ac', '2', '-c:a', 'libvorbis', '-q:a', quality === '320' ? '8' : quality === '128' ? '4' : '6'] : ['-ar', '48000', '-ac', '2', '-c:a', 'libmp3lame', '-b:a', `${quality}k`];
  try {
    await runFfmpeg(req.file.path, output, args);
    cleanup(req.file.path);
    const stat = fs.statSync(output);
    outputOwners.set(`${id}.${format}`, requestEmail(req));
    await saveOutputOwner(`${id}.${format}`, requestEmail(req));
    setTimeout(() => cleanup(output), 15 * 60 * 1000).unref();
    res.json({ id, name: `${safeName(req.file.originalname).replace(/\.[^.]+$/, '')}.${format}`, format, size: stat.size, downloadUrl: `/api/download/${id}.${format}` });
  } catch (error) { cleanup(req.file.path, output); res.status(500).json({ error: error.message }); }
});
app.post('/api/optimize', upload.single('audio'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'File audio wajib dipilih.' });
  const id = crypto.randomUUID();
  const output = path.join(outputDir, `${id}.mp3`);
  try {
    await runFfmpeg(req.file.path, output, ['-filter:a', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-codec:a', 'libmp3lame', '-b:a', '192k']);
    cleanup(req.file.path);
    const stat = fs.statSync(output);
    outputOwners.set(`${id}.mp3`, requestEmail(req));
    await saveOutputOwner(`${id}.mp3`, requestEmail(req));
    const name = `${safeName(req.file.originalname).replace(/\.[^.]+$/, '')}-optimized.mp3`;
    setTimeout(() => cleanup(output), 15 * 60 * 1000).unref();
    res.json({ id, name, size: stat.size, downloadUrl: `/api/download/${id}.mp3` });
  } catch (error) { cleanup(req.file.path, output); res.status(500).json({ error: error.message }); }
});
app.post('/api/remix', upload.single('audio'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'File audio wajib dipilih.' });
  const remixSpeed = Number.parseFloat(String(req.body.speed ?? '').trim());
  const format = String(req.body.format || 'mp3').toLowerCase();
  if (!Number.isFinite(remixSpeed) || remixSpeed < 0.5 || remixSpeed > 4) {
    cleanup(req.file.path);
    return res.status(400).json({ error: 'Speed remix harus antara 0.50 dan 4.00.' });
  }
  if (!['mp3', 'ogg', 'flac', 'wav'].includes(format)) {
    cleanup(req.file.path);
    return res.status(400).json({ error: 'Format remix harus MP3, OGG, FLAC, atau WAV.' });
  }
  const id = crypto.randomUUID();
  const normalizedSpeed = Number(remixSpeed.toFixed(2));
  const normalPlaybackSpeed = calculateNormalPlaybackSpeed(normalizedSpeed);
  if (normalPlaybackSpeed === null || Math.abs((normalizedSpeed * normalPlaybackSpeed) - 1) > 0.001) {
    cleanup(req.file.path);
    return res.status(400).json({ error: 'Speed remix menghasilkan PlaybackSpeed Roblox yang tidak valid.' });
  }
  const outputName = `${id}.${format}`;
  const output = path.join(outputDir, outputName);
  const codecArgs = format === 'wav'
    ? ['-c:a', 'pcm_s16le']
    : format === 'flac'
      ? ['-c:a', 'flac']
      : format === 'ogg'
        ? ['-c:a', 'libvorbis', '-q:a', '6']
        : ['-c:a', 'libmp3lame', '-b:a', '192k'];
  const tempoFilters = normalizedSpeed <= 2
    ? [`atempo=${normalizedSpeed}`]
    : ['atempo=2', `atempo=${(normalizedSpeed / 2).toFixed(3)}`];
  try {
    await runFfmpeg(req.file.path, output, ['-filter:a', tempoFilters.join(','), ...codecArgs]);
    cleanup(req.file.path);
    const stat = fs.statSync(output);
    outputOwners.set(outputName, requestEmail(req));
    await saveOutputOwner(outputName, requestEmail(req));
    const originalName = safeName(req.file.originalname).replace(/\.[^.]+$/, '') || 'audio';
    const fileName = `${originalName}-remix-${normalizedSpeed.toFixed(2)}.${format}`;
    const metadata = { originalSpeed: 1, remixSpeed: normalizedSpeed, robloxPlaybackSpeed: normalPlaybackSpeed, originalFilename: req.file.originalname, remixFilename: fileName, format, audioIsOriginal: false, playbackValidation: normalizedSpeed * normalPlaybackSpeed };
    setTimeout(() => cleanup(output), 15 * 60 * 1000).unref();
    res.json({ id, name: fileName, size: stat.size, downloadUrl: `/api/download/${outputName}`, ...metadata });
  } catch (error) {
    cleanup(req.file.path, output);
    res.status(500).json({ error: error.message });
  }
});
app.get('/api/download/:file', async (req, res) => {
  const file = path.basename(req.params.file);
  const fullPath = path.join(outputDir, file);
  const owner = outputOwners.get(file);
  const email = requestEmail(req);
  if (!email) return res.status(401).json({ error: 'Login diperlukan.' });
  const persistedOwner = owner || (await databaseAll('SELECT owner_email FROM converted_files WHERE file_name = ?', [file]))[0]?.owner_email;
  if (!persistedOwner || (persistedOwner !== email && !isPaymentAdmin(req))) return res.status(403).json({ error: 'Anda tidak memiliki akses ke hasil ini.' });
  if (!fs.existsSync(fullPath)) return res.status(404).json({ error: 'Hasil tidak ditemukan.' });
  res.download(fullPath, file);
});

app.post('/api/roblox/upload-audio', upload.single('audio'), async (req, res) => {
  if (!requireUser(req, res)) return;
  if (!requireRobloxSecret(res)) return;
  const session = getRobloxApiSession(req);
  const apiKey = decryptRobloxApiKey(session?.encryptedKey);
  if (!apiKey) return res.status(401).json({ success: false, error: 'Connect Roblox API terlebih dahulu.' });
  if (!req.file) return res.status(400).json({ success: false, error: 'File harus berupa audio.' });
  const contentType = audioContentType(req.file);
  if (!contentType) {
    cleanup(req.file.path);
    return res.status(400).json({ success: false, error: 'File upload Roblox harus berupa audio.' });
  }
  const creatorType = session?.creatorType === 'group' ? 'group' : 'user';
  const creatorId = String(session?.creatorId || session?.userId || 'Unknown').trim();
  if (!creatorId || creatorId === 'Unknown') return res.status(403).json({ success: false, error: `${creatorType === 'group' ? 'Community/Group' : 'User'} ID belum diatur.` });
  const remixSpeed = Number.parseFloat(String(req.body.remixSpeed || '').trim());
  const robloxPlaybackSpeed = Number.parseFloat(String(req.body.robloxPlaybackSpeed || '').trim());
  const hasRemixMetadata = Number.isFinite(remixSpeed) && Number.isFinite(robloxPlaybackSpeed) && remixSpeed > 0 && robloxPlaybackSpeed > 0;
  if (hasRemixMetadata && Math.abs((remixSpeed * robloxPlaybackSpeed) - 1) > 0.001) {
    cleanup(req.file.path);
    return res.status(400).json({ success: false, error: 'Metadata PlaybackSpeed tidak mengembalikan audio ke kecepatan normal.' });
  }
  const remixMetadata = hasRemixMetadata ? {
    remixSpeed,
    robloxPlaybackSpeed,
    originalFilename: String(req.body.originalFilename || '').trim() || null,
    remixFilename: String(req.body.remixFilename || req.file.originalname).trim()
  } : null;
  const safeDisplayName = safeName(req.body.displayName || req.body.name || req.file.originalname).replace(/\.[^.]+$/, '').slice(0, 50) || 'Audio';
  let operationId = null;
  try {
    const form = new FormData();
    // Roblox Assets API expects the metadata part as application/json and returns a long-running operation.
    form.append('request', new Blob([JSON.stringify({
      assetType: 'Audio',
      displayName: safeDisplayName,
      description: String(req.body.description || process.env.ROBLOX_ASSET_DESCRIPTION || 'Uploaded from Rival Audio Converter').slice(0, 1000),
      creationContext: { creator: { [`${creatorType}Id`]: creatorId } }
    })], { type: 'application/json' }), 'request.json');
    form.append('fileContent', new Blob([fs.readFileSync(req.file.path)], { type: contentType }), req.file.originalname);
    const uploadResponse = await fetchRobloxWithBackoff('https://apis.roblox.com/assets/v1/assets', {
      method: 'POST',
      headers: { 'x-api-key': apiKey },
      body: form
    });
    const { rawBody: uploadBody, data: uploadData } = await readRobloxResponse(uploadResponse);
    cleanup(req.file.path);
    if (!uploadResponse.ok) {
      const message = uploadData?.message || uploadData?.error || 'Roblox menolak upload.';
      logRobloxResponse('upload failed', uploadResponse, uploadBody, uploadData);
      if (uploadResponse.status === 401) return res.status(401).json({ success: false, code: 'AUTHENTICATION_INVALID', error: 'Roblox menolak API key. Pastikan key masih aktif dan dikirim dari server.' });
      if (uploadResponse.status === 403) return res.status(403).json({ success: false, code: 'PERMISSION_OR_RESOURCE_DENIED', error: `Roblox menolak akses. Periksa permission Assets: Write, resource API key, dan ${creatorType === 'group' ? 'Group ID' : 'User ID'} yang dipilih. Detail Roblox: ${message}` });
      if (uploadResponse.status === 404) return res.status(404).json({ success: false, code: 'ENDPOINT_OR_RESOURCE_NOT_FOUND', error: 'Endpoint atau resource Roblox tidak ditemukan. Periksa resource API key dan creator ID.' });
      if (uploadResponse.status === 429) return res.status(429).json({ success: false, error: 'Upload limit reached.' });
      if (uploadResponse.status >= 500) return res.status(503).json({ success: false, error: 'Roblox API unavailable.' });
      return res.status(uploadResponse.status).json({ success: false, error: message });
    }
    logRobloxResponse('upload accepted', uploadResponse, uploadBody, uploadData);
    operationId = String(uploadData?.operationId || uploadData?.operation?.id || uploadData?.path || uploadData?.operation?.path || '').trim().replace(/^operations\//, '');
    if (!operationId) {
      const immediateAssetId = extractRobloxAssetId(uploadData);
      if (immediateAssetId) {
        history.unshift({ id: immediateAssetId, name: req.file.originalname, status: 'Uploaded', ownerEmail: requestEmail(req), createdAt: new Date().toISOString(), remixMetadata });
        await saveRobloxAsset(requestEmail(req), immediateAssetId, req.file.originalname, remixMetadata);
        return res.json({ success: true, assetId: immediateAssetId, robloxCreator: { type: creatorType, id: creatorId }, remixMetadata });
      }
      console.warn('[Roblox upload] accepted response missing operation ID', { status: uploadResponse.status, response: summarizeRobloxResponse(uploadData) });
      return res.status(502).json({ success: false, error: 'Roblox menerima response tanpa operation ID. Upload belum dapat diverifikasi.' });
    }
    robloxOperations.set(operationId, { ownerEmail: requestEmail(req), originalName: req.file.originalname, remixMetadata });
    const operationResult = await pollRobloxOperation(apiKey, operationId);
    const assetId = extractRobloxAssetId(operationResult);
    if (!assetId) {
      console.warn('[Roblox upload] completed operation without asset ID', { operation: `${operationId.slice(0, 8)}...`, response: summarizeRobloxResponse(operationResult) });
      return res.status(202).json({ success: false, pending: true, operationId, error: 'Roblox selesai memproses, tetapi response belum memuat Asset ID. Operation tetap dapat dipolling.' });
    }
    history.unshift({ id: assetId, name: req.file.originalname, status: 'Uploaded', ownerEmail: requestEmail(req), createdAt: new Date().toISOString(), remixMetadata });
    await saveRobloxAsset(requestEmail(req), assetId, req.file.originalname, remixMetadata);
    robloxOperations.delete(operationId);
    res.json({ success: true, assetId, robloxCreator: { type: creatorType, id: creatorId }, remixMetadata });
  } catch (error) {
    cleanup(req.file.path);
    const message = error.message || 'Roblox API unavailable.';
    if (message.includes('AUTHENTICATION_INVALID')) return res.status(401).json({ success: false, code: 'AUTHENTICATION_INVALID', error: 'Roblox menolak API key. Pastikan key masih aktif dan dikirim dari server.' });
    if (message.includes('PERMISSION_OR_RESOURCE_DENIED')) return res.status(403).json({ success: false, code: 'PERMISSION_OR_RESOURCE_DENIED', error: `Roblox menolak permission atau resource. Periksa Assets: Write, resource API key, dan ${creatorType === 'group' ? 'Group ID' : 'User ID'}.` });
    if (message.includes('Upload limit reached')) return res.status(429).json({ success: false, error: 'Upload limit reached.' });
    if (message.includes('Roblox moderation failed')) return res.status(400).json({ success: false, error: message, operationId });
    if (message.includes('still processing')) return res.status(202).json({ success: false, pending: true, operationId, error: 'Roblox is still processing this upload.' });
    res.status(503).json({ success: false, error: 'Roblox API unavailable.' });
  }
});
app.get('/api/roblox/operations/:id', async (req, res) => {
  if (!requireUser(req, res)) return;
  if (!requireRobloxSecret(res)) return;
  const operationId = String(req.params.id || '').trim();
  const operation = robloxOperations.get(operationId);
  if (!operation || operation.ownerEmail !== requestEmail(req)) return res.status(404).json({ success: false, error: 'Operation upload tidak ditemukan atau sudah kedaluwarsa.' });
  const session = getRobloxApiSession(req);
  const apiKey = decryptRobloxApiKey(session?.encryptedKey);
  if (!apiKey) return res.status(401).json({ success: false, error: 'Connect Roblox API terlebih dahulu.' });
  try {
    const response = await fetchRobloxWithBackoff(`https://apis.roblox.com/assets/v1/operations/${encodeURIComponent(operationId)}`, { method: 'GET', headers: { 'x-api-key': apiKey, Accept: 'application/json' } });
    const { rawBody, data } = await readRobloxResponse(response);
    if (!response.ok) {
      logRobloxResponse('operation status failed', response, rawBody, data);
      return res.status(response.status).json({ success: false, error: robloxOperationError(data, 'Roblox operation gagal.') });
    }
    const state = String(data.status || data.state || '').toLowerCase();
    if (['failed', 'cancelled', 'canceled'].includes(state)) {
      robloxOperations.delete(operationId);
      return res.status(400).json({ success: false, error: robloxOperationError(data), operationId });
    }
    if (data.done !== true && !['completed', 'complete', 'succeeded', 'success'].includes(state)) return res.status(202).json({ success: false, pending: true, operationId });
    const assetId = extractRobloxAssetId(data);
    if (!assetId) return res.status(202).json({ success: false, pending: true, operationId });
    history.unshift({ id: assetId, name: operation.originalName, status: 'Uploaded', ownerEmail: requestEmail(req), createdAt: new Date().toISOString(), remixMetadata: operation.remixMetadata });
    await saveRobloxAsset(requestEmail(req), assetId, operation.originalName, operation.remixMetadata);
    robloxOperations.delete(operationId);
    return res.json({ success: true, assetId, remixMetadata: operation.remixMetadata });
  } catch (error) {
    return res.status(503).json({ success: false, error: error.message || 'Roblox API unavailable.' });
  }
});
app.get('/api/roblox/assets/:id', async (req, res) => {
  if (!requireUser(req, res)) return;
  if (!requireRobloxSecret(res)) return;
  const session = getRobloxApiSession(req);
  const apiKey = decryptRobloxApiKey(session?.encryptedKey);
  if (!apiKey) return res.status(401).json({ error: 'Connect Roblox API terlebih dahulu.' });
  const assetId = String(req.params.id || '').trim();
  if (!/^\d+$/.test(assetId) || !history.some((item) => item.ownerEmail === requestEmail(req) && String(item.id) === assetId)) {
    return res.status(404).json({ error: 'Asset tidak ditemukan pada akun ini.' });
  }
  const response = await fetch(`https://apis.roblox.com/assets/v1/assets/${encodeURIComponent(assetId)}`, { method: 'GET', headers: { 'x-api-key': apiKey, Accept: 'application/json' } });
  const payload = await response.json().catch(() => ({}));
  res.status(response.status).json(payload);
});
app.post('/api/roblox-api/connect', async (req, res) => {
  if (!requireUser(req, res)) return;
  if (!requireRobloxSecret(res)) return;
  const apiKey = String(req.body.apiKey || '').trim();
  const creatorType = req.body.creatorType === 'group' ? 'group' : 'user';
  const creatorId = String(req.body.creatorId || '').trim();
  if (!apiKey) return res.status(400).json({ ok: false, error: 'Paste your Roblox API Key' });
  if (!creatorId) return res.status(400).json({ ok: false, error: `${creatorType === 'group' ? 'Community/Group' : 'Creator/User'} ID wajib diisi.` });
  if (!/^\d+$/.test(creatorId)) return res.status(400).json({ ok: false, error: 'ID Roblox harus berupa angka.' });
  try {
    await verifyRobloxApiKey(apiKey, creatorType, creatorId);
  } catch (error) {
    return res.status(401).json({ ok: false, error: error.message || 'API key Roblox tidak valid.' });
  }
  setRobloxApiSession(req, {
    encryptedKey: encryptRobloxApiKey(apiKey),
    creatorType,
    creatorId,
    userId: creatorType === 'user' ? creatorId : 'Unknown',
    creator: creatorType === 'group' ? 'Community/Group' : 'Personal User',
    permissions: ['Assets: Write pending Roblox preflight'],
    apiStatus: 'READY_FOR_UPLOAD_CHECK',
    connected: true,
    connectedAt: new Date().toISOString()
  });
  res.json({ ok: true, connected: true, creatorType, creatorId, userId: creatorType === 'user' ? creatorId : 'Unknown', creator: creatorType === 'group' ? 'Community/Group' : 'Personal User', permissions: ['Assets: Write pending Roblox preflight'], apiStatus: 'READY_FOR_UPLOAD_CHECK', message: 'API key tersimpan aman di memory server. Permission dan resource akan diverifikasi oleh endpoint upload resmi Roblox.' });
});
app.get('/api/roblox-api/session', (req, res) => {
  if (!robloxKeySecretReady) return res.json({ connected: false, apiStatus: 'SERVER_SECRET_NOT_CONFIGURED' });
  const session = getRobloxApiSession(req);
  if (!session) return res.json({ connected: false, apiStatus: 'NOT CONNECTED' });
  const apiKey = decryptRobloxApiKey(session.encryptedKey);
  if (!apiKey) return res.json({ connected: false, apiStatus: 'NOT CONNECTED' });
  const payload = {
    connected: true,
    creatorType: session.creatorType || 'user',
    creatorId: session.creatorId || session.userId || 'Unknown',
    userId: session.userId || 'Unknown',
    creator: session.creator || 'Creator',
    permissions: session.permissions || ['Assets', 'Read', 'Write'],
    apiStatus: session.apiStatus || 'Connected',
    connectedAt: session.connectedAt || new Date().toISOString()
  };
  res.json(payload);
});
app.post('/api/roblox-api/test', async (req, res) => {
  if (!requireUser(req, res)) return;
  if (!requireRobloxSecret(res)) return;
  const session = getRobloxApiSession(req);
  const apiKey = decryptRobloxApiKey(session?.encryptedKey);
  if (!apiKey) return res.status(401).json({ ok: false, error: 'Connect Roblox API terlebih dahulu.' });
  try {
    await verifyRobloxApiKey(apiKey, session.creatorType || 'user', session.creatorId || session.userId);
  } catch (error) {
    clearRobloxApiSession(req);
    return res.status(401).json({ ok: false, error: error.message || 'API key Roblox tidak valid.' });
  }
  setRobloxApiSession(req, {
    ...session,
    userId: session.userId || 'Unknown',
    creator: session.creator || 'Creator',
    permissions: session.permissions || ['Assets: Write pending Roblox preflight'],
    apiStatus: 'READY_FOR_UPLOAD_CHECK',
    connected: true
  });
  res.json({ ok: true, connected: true, creatorType: session.creatorType || 'user', creatorId: session.creatorId || session.userId || 'Unknown', userId: session.userId || 'Unknown', creator: session.creator || 'Creator', permissions: session.permissions || ['Assets: Write pending Roblox preflight'], apiStatus: 'READY_FOR_UPLOAD_CHECK', message: 'Credential tersimpan di server dan siap diuji oleh upload resmi Roblox.' });
});
app.delete('/api/roblox-api/remove', (req, res) => {
  if (!requireUser(req, res)) return;
  if (!requireRobloxSecret(res)) return;
  clearRobloxApiSession(req);
  res.json({ ok: true, connected: false, apiStatus: 'NOT CONNECTED' });
});

app.get('*', (req, res) => res.sendFile(path.join(fs.existsSync(clientDist) ? clientDist : root, 'index.html')));
app.listen(port, '0.0.0.0', () => console.log(`Rival Audio Converter listening on port ${port}`));
