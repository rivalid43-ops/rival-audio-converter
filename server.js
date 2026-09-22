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

const root = __dirname;
dotenv.config({ path: path.resolve(root, '.env') });
const app = express();
const port = Number(process.env.PORT || 3000);
const isRailway = Boolean(process.env.RAILWAY_ENVIRONMENT_NAME || process.env.RAILWAY_PROJECT_ID || process.env.RAILWAY_SERVICE_ID);
const isProduction = process.env.NODE_ENV === 'production' || isRailway;
const googleClientId = String(process.env.GOOGLE_CLIENT_ID || '').trim();
const googleClientSecret = String(process.env.GOOGLE_CLIENT_SECRET || '').trim();
const publicBaseUrl = String(process.env.PUBLIC_BASE_URL || '').trim().replace(/\/$/, '');
const paymentAdminEmail = String(process.env.PAYMENT_ADMIN_EMAIL || 'rivalid43@gmail.com').trim().toLowerCase();
console.log("GOOGLE_REDIRECT_URI:", process.env.GOOGLE_REDIRECT_URI);
if (!String(process.env.GOOGLE_REDIRECT_URI || '').trim()) console.error('Google OAuth belum aktif: GOOGLE_REDIRECT_URI wajib diatur di environment variable.');
if (!publicBaseUrl) console.error('Google OAuth callback belum lengkap: PUBLIC_BASE_URL wajib diatur di environment variable.');
const configuredSessionSecret = String(process.env.SESSION_SECRET || '').trim();
const hasConfiguredSessionSecret = configuredSessionSecret && configuredSessionSecret !== 'replace-with-a-long-random-value';
if (isProduction && !hasConfiguredSessionSecret) {
  throw new Error('SESSION_SECRET wajib diatur di environment variable saat production.');
}
const effectiveSessionSecret = hasConfiguredSessionSecret ? configuredSessionSecret : crypto.randomBytes(32).toString('hex');
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
const clientDist = path.join(root, 'client', 'dist');
app.use(express.static(fs.existsSync(clientDist) ? clientDist : root));

const sessions = new Map();
const history = [];
const paymentOrders = [];
const chatRooms = [];
const paymentDatabase = new sqlite3.Database(paymentDatabaseFile);
function databaseRun(sql, parameters = []) {
  return new Promise((resolve, reject) => paymentDatabase.run(sql, parameters, function onRun(error) { if (error) reject(error); else resolve(this); }));
}
function databaseAll(sql, parameters = []) {
  return new Promise((resolve, reject) => paymentDatabase.all(sql, parameters, (error, rows) => error ? reject(error) : resolve(rows)));
}
async function initializePaymentDatabase() {
  await databaseRun('PRAGMA journal_mode = WAL');
  await databaseRun(`CREATE TABLE IF NOT EXISTS payment_orders (
    id TEXT PRIMARY KEY, order_number TEXT NOT NULL UNIQUE, customer_name TEXT NOT NULL,
    customer_email TEXT NOT NULL, plan_name TEXT NOT NULL, amount INTEGER NOT NULL, credits INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL, created_at TEXT NOT NULL, payment_target TEXT NOT NULL,
    qr_image TEXT, notes TEXT NOT NULL DEFAULT '', proof_url TEXT, uploaded_at TEXT, admin_notes TEXT NOT NULL DEFAULT ''
  )`);
  await databaseRun('ALTER TABLE payment_orders ADD COLUMN credits INTEGER NOT NULL DEFAULT 0').catch(() => {});
  await databaseRun(`CREATE TABLE IF NOT EXISTS payment_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT NOT NULL, sender TEXT NOT NULL,
    text TEXT NOT NULL, sent_at TEXT NOT NULL, FOREIGN KEY(order_id) REFERENCES payment_orders(id)
  )`);
  await databaseRun(`CREATE TABLE IF NOT EXISTS feature_usage (
    usage_key TEXT PRIMARY KEY, usage_count INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
  )`);
  await databaseRun(`CREATE TABLE IF NOT EXISTS credit_balances (
    customer_email TEXT PRIMARY KEY, credits INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
  )`);
  await databaseRun(`CREATE TABLE IF NOT EXISTS credit_grants (
    order_id TEXT PRIMARY KEY, customer_email TEXT NOT NULL, credits INTEGER NOT NULL, granted_at TEXT NOT NULL
  )`);
  const orders = await databaseAll('SELECT * FROM payment_orders ORDER BY created_at DESC');
  const messages = await databaseAll('SELECT order_id, sender, text, sent_at FROM payment_messages ORDER BY id ASC');
  paymentOrders.push(...orders.map((item) => ({ id: item.id, orderNumber: item.order_number, customerName: item.customer_name, customerEmail: item.customer_email, planName: item.plan_name, amount: item.amount, credits: item.credits || 0, status: item.status, createdAt: item.created_at, paymentTarget: item.payment_target, qrImage: item.qr_image, notes: item.notes, proofUrl: item.proof_url, uploadedAt: item.uploaded_at, adminNotes: item.admin_notes })));
  messages.forEach((message) => {
    let room = chatRooms.find((item) => item.orderId === message.order_id);
    if (!room) { room = { orderId: message.order_id, participants: [], messages: [] }; chatRooms.push(room); }
    room.messages.push({ sender: message.sender, text: message.text, sentAt: message.sent_at });
  });
}
const paymentDatabaseReady = initializePaymentDatabase().catch((error) => { console.error('Payment database initialization failed:', error); throw error; });
const usageLimit = 5;
function usageKey(req) { return requestEmail(req) || `ip:${req.ip}`; }
async function consumeUsage(req) {
  if (isPaymentAdmin(req)) return { allowed: true, used: 0, limit: null };
  await paymentDatabaseReady;
  const key = usageKey(req);
  const rows = await databaseAll('SELECT usage_count FROM feature_usage WHERE usage_key = ?', [key]);
  const used = Number(rows[0]?.usage_count || 0);
  if (used >= usageLimit) return { allowed: false, used, limit: usageLimit };
  await databaseRun('INSERT INTO feature_usage (usage_key, usage_count, updated_at) VALUES (?, 1, ?) ON CONFLICT(usage_key) DO UPDATE SET usage_count = usage_count + 1, updated_at = excluded.updated_at', [key, new Date().toISOString()]);
  return { allowed: true, used: used + 1, limit: usageLimit };
}
async function usageGuard(req, res, next) {
  try {
    const usage = await consumeUsage(req);
    if (!usage.allowed) return res.status(429).json({ error: 'Batas penggunaan 5 kali sudah tercapai.', usage });
    res.setHeader('X-Usage-Count', String(usage.used));
    if (usage.limit) res.setHeader('X-Usage-Limit', String(usage.limit));
    next();
  } catch (error) {
    console.error('Usage limit check failed:', error);
    res.status(503).json({ error: 'Batas penggunaan belum siap.' });
  }
}
async function savePaymentData() {
  await paymentDatabaseReady;
  await databaseRun('BEGIN TRANSACTION');
  try {
    await databaseRun('DELETE FROM payment_orders');
    await databaseRun('DELETE FROM payment_messages');
    for (const order of paymentOrders) await databaseRun('INSERT INTO payment_orders (id, order_number, customer_name, customer_email, plan_name, amount, credits, status, created_at, payment_target, qr_image, notes, proof_url, uploaded_at, admin_notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [order.id, order.orderNumber, order.customerName, order.customerEmail, order.planName, order.amount, order.credits || 0, order.status, order.createdAt, order.paymentTarget, order.qrImage, order.notes || '', order.proofUrl || null, order.uploadedAt || null, order.adminNotes || '']);
    for (const room of chatRooms) for (const message of room.messages) await databaseRun('INSERT INTO payment_messages (order_id, sender, text, sent_at) VALUES (?, ?, ?, ?)', [room.orderId, message.sender, message.text, message.sentAt]);
    await databaseRun('COMMIT');
  } catch (error) {
    await databaseRun('ROLLBACK');
    throw error;
  }
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
app.use(['/api/youtube/validate', '/api/convert', '/api/optimize', '/api/remix', '/api/roblox/upload-audio'], usageGuard);
const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, file.mimetype.startsWith('audio/') || file.mimetype.startsWith('video/') || /\.(mp3|wav|ogg|m4a|flac|aac|mp4|mov|mkv|webm|avi)$/i.test(file.originalname))
});

function configReady() {
  return robloxConfig().missing.length === 0;
}
function robloxConfig() {
  const values = {
    ROBLOX_CLIENT_ID: process.env.ROBLOX_CLIENT_ID,
    ROBLOX_CLIENT_SECRET: process.env.ROBLOX_CLIENT_SECRET,
    ROBLOX_REDIRECT_URI: process.env.ROBLOX_REDIRECT_URI
  };
  const missing = Object.entries(values).filter(([, value]) => !String(value || '').trim() || String(value).startsWith('your-')).map(([key]) => key);
  return { loadedFrom: path.resolve(root, '.env'), missing };
}
function robloxMissingMessage(config) {
  const missing = config.missing.length ? config.missing.join(', ') : 'Tidak ada';
  const redirectUri = String(process.env.ROBLOX_REDIRECT_URI || 'belum diatur');
  return `Roblox OAuth belum dikonfigurasi. Isi ROBLOX_CLIENT_ID dan ROBLOX_CLIENT_SECRET sendiri dari aplikasi Roblox OAuth Anda di ${config.loadedFrom}. Redirect URI yang harus dipakai di Roblox App: ${redirectUri}. Variabel yang masih kosong: ${missing}.`;
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
function robloxCookie(value, maxAge = 30 * 24 * 60 * 60) { return `rival_roblox=${encodeURIComponent(value)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${isProduction ? '; Secure' : ''}`; }
function robloxSession(req) {
  const value = readCookie(req, 'rival_roblox');
  if (!value || !sessionSecret()) return null;
  const separator = value.lastIndexOf('.'); const sessionId = value.slice(0, separator); const signature = value.slice(separator + 1);
  if (!sessionId || !signature) return null;
  const expected = crypto.createHmac('sha256', sessionSecret()).update(`roblox:${sessionId}`).digest('hex');
  if (signature.length !== expected.length) return null;
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected)) ? sessions.get(`roblox:${sessionId}`) : null;
}
function robloxSessionId(req) {
  const value = readCookie(req, 'rival_roblox');
  if (!value) return null;
  const separator = value.lastIndexOf('.');
  return separator > 0 ? value.slice(0, separator) : null;
}
function signRobloxSession(sessionId) { return `${sessionId}.${crypto.createHmac('sha256', sessionSecret()).update(`roblox:${sessionId}`).digest('hex')}`; }
function getRobloxServerSession(req) {
  if (req.session && req.session.roblox && req.session.roblox.accessToken) return req.session.roblox;
  return robloxSession(req);
}
function setRobloxServerSession(req, sessionData) {
  if (req.session) { req.session.roblox = { ...sessionData, sessionId: sessionData.sessionId || null }; }
  return sessionData;
}
function clearRobloxServerSession(req) {
  if (req.session) delete req.session.roblox;
}
function randomString(size = 32) { return crypto.randomBytes(size).toString('base64url'); }
function pkceChallenge(verifier) { return crypto.createHash('sha256').update(verifier).digest('base64url'); }
async function refreshRobloxToken(session) {
  if (!session?.refreshToken) return false;
  const body = new URLSearchParams({ client_id: process.env.ROBLOX_CLIENT_ID, client_secret: process.env.ROBLOX_CLIENT_SECRET, grant_type: 'refresh_token', refresh_token: session.refreshToken });
  const response = await fetch('https://apis.roblox.com/oauth/v1/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const tokens = await response.json();
  if (!response.ok || !tokens.access_token) return false;
  session.accessToken = tokens.access_token; session.refreshToken = tokens.refresh_token || session.refreshToken; session.expiresAt = Date.now() + Number(tokens.expires_in || 3600) * 1000;
  return true;
}
async function robloxFetch(session, url, options = {}) {
  if (session.expiresAt && session.expiresAt < Date.now() && !(await refreshRobloxToken(session))) return null;
  let response = await fetch(url, { ...options, headers: { ...(options.headers || {}), Authorization: `Bearer ${session.accessToken}` } });
  if (response.status === 401 && await refreshRobloxToken(session)) response = await fetch(url, { ...options, headers: { ...(options.headers || {}), Authorization: `Bearer ${session.accessToken}` } });
  return response;
}
function safeName(value) { return String(value || 'audio').replace(/[^a-z0-9._-]/gi, '-').slice(0, 80); }
function deriveRobloxApiKeyEncryptionKey() { const base = String(process.env.ROBLOX_API_KEY_SECRET || effectiveSessionSecret || 'rival-open-cloud-api-key'); return crypto.createHash('sha256').update(base).digest(); }
function encryptRobloxApiKey(value) {
  const key = deriveRobloxApiKeyEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  const encrypted = Buffer.concat([cipher.update(String(value)), cipher.final()]);
  return `${iv.toString('hex')}:${encrypted.toString('hex')}`;
}
function decryptRobloxApiKey(value) {
  if (!value) return '';
  const [ivHex, encryptedHex] = String(value).split(':');
  if (!ivHex || !encryptedHex) return '';
  try {
    const key = deriveRobloxApiKeyEncryptionKey();
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, Buffer.from(ivHex, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(encryptedHex, 'hex')), decipher.final()]).toString('utf8');
  } catch (error) {
    return '';
  }
}
function getRobloxApiSession(req) { return req.session?.robloxApi || null; }
function setRobloxApiSession(req, data) { req.session.robloxApi = data; return data; }
function clearRobloxApiSession(req) { delete req.session.robloxApi; }
async function validateRobloxApiKey(rawApiKey) {
  const apiKey = String(rawApiKey || '').trim();
  if (!apiKey) return { ok: false, code: 'missing', error: 'API key required.' };
  if (apiKey.length < 20) return { ok: false, code: 'invalid', error: 'Invalid Roblox API Key' };
  try {
    const response = await fetch('https://apis.roblox.com/assets/v1/assets?limit=1', {
      method: 'GET',
      headers: { 'x-api-key': apiKey, Accept: 'application/json' }
    });
    const text = await response.text();
    let payload = null;
    try { payload = JSON.parse(text); } catch { payload = { raw: text }; }
    if (response.status === 401) return { ok: false, code: 'invalid', error: 'Invalid Roblox API Key' };
    if (response.status === 403) return { ok: true, code: 'permission-check', userId: 'Unknown', creator: 'Creator', permissions: ['Upload pending verification'], status: 'Key saved', message: 'API key tersimpan. Izin upload akan diverifikasi saat upload audio pertama.' };
    if (response.status === 429) return { ok: false, code: 'limit', error: 'Upload limit reached.' };
    if (response.status >= 500) return { ok: false, code: 'unavailable', error: 'Roblox API unavailable.' };
    if (!response.ok) return { ok: false, code: payload?.code || 'permission', error: payload?.message || payload?.error || 'Permission denied.' };
    const assets = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : [];
    const firstAsset = assets[0] || payload || {};
    const userId = String(firstAsset.creator?.userId || firstAsset.creator?.id || firstAsset.creatorId || firstAsset.creator?.user_id || '').trim() || 'Unknown';
    const creatorLabel = String(firstAsset.creator?.name || firstAsset.creator?.displayName || firstAsset.creator?.username || 'Creator').trim() || 'Creator';
    return { ok: true, userId, creator: creatorLabel, permissions: ['Assets', 'Read', 'Write'], status: 'Connected', message: 'Roblox API connected.' };
  } catch (error) {
    return { ok: false, code: 'unavailable', error: 'Roblox API unavailable.' };
  }
}
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function pollRobloxOperation(apiKey, operationId) {
  const maxAttempts = 20;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const response = await fetch(`https://apis.roblox.com/assets/v1/operations/${encodeURIComponent(operationId)}`, {
      method: 'GET',
      headers: { 'x-api-key': apiKey, Accept: 'application/json' }
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401 || response.status === 403) throw new Error('Invalid Roblox API Key');
    if (response.status === 429) throw new Error('Upload limit reached.');
    if (response.status >= 500) throw new Error('Roblox API unavailable.');
    if (!response.ok) throw new Error(data?.message || data?.error || 'Roblox moderation failed.');
    const state = String(data.status || data.state || '').toLowerCase();
    if (['completed', 'succeeded', 'success'].includes(state)) return data;
    if (['failed', 'cancelled', 'canceled'].includes(state)) throw new Error(data?.message || 'Roblox moderation failed.');
    await sleep(1500);
  }
  throw new Error('Roblox is still processing this upload. Please try again in a moment.');
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

app.get('/api/health', (req, res) => res.json({ ok: true, robloxConfigured: configReady(), robloxConfig: { loadedFrom: robloxConfig().loadedFrom, missing: robloxConfig().missing }, ffmpeg: ffmpegCommand }));
app.get('/api/usage', async (req, res) => {
  try {
    await paymentDatabaseReady;
    if (isPaymentAdmin(req)) return res.json({ used: 0, limit: null, unlimited: true });
    const rows = await databaseAll('SELECT usage_count FROM feature_usage WHERE usage_key = ?', [usageKey(req)]);
    res.json({ used: Number(rows[0]?.usage_count || 0), limit: usageLimit, unlimited: false });
  } catch (error) {
    res.status(503).json({ error: 'Status penggunaan belum siap.' });
  }
});
app.get('/api/session', (req, res) => res.json({ connected: Boolean(authSession(req) || robloxSession(req)), history }));
app.get('/api/payments/plans', (req, res) => {
  res.json([
    { id: '1-year', name: '1 Tahun', price: 'Rp150.000', detail: 'Akses penuh selama 1 tahun', amount: 150000, credits: 100 },
    { id: '2-year', name: '2 Tahun', price: 'Rp340.000', detail: 'Akses penuh selama 2 tahun', amount: 340000, credits: 300 },
    { id: 'team', name: 'Join Team', price: 'Rp1.000.000', detail: 'Akses penuh selama 1 tahun', amount: 1000000, credits: 1000 }
  ]);
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
  res.json(isPaymentAdmin(req) ? paymentOrders : paymentOrders.filter((order) => String(order.customerEmail || '').toLowerCase() === email));
});
app.get('/api/admin/payments', (req, res) => {
  if (!isPaymentAdmin(req)) return res.status(403).json({ error: 'Khusus admin pembayaran.' });
  res.json(paymentOrders);
});
app.post('/api/payments/create', async (req, res) => {
  const plan = req.body && req.body.plan ? req.body.plan : null;
  const customerName = String(req.session?.googleUser?.name || req.body?.customerName || 'Customer').trim();
  const customerEmail = requestEmail(req);
  const amount = Number(plan?.amount || req.body?.amount || 0);
  const credits = Math.max(0, Number(plan?.credits || 0));
  if (!customerEmail) return res.status(401).json({ error: 'Login diperlukan untuk membuat order.' });
  if (!plan || !plan.name || !amount) return res.status(400).json({ error: 'Paket tidak valid.' });
  const orderNumber = `RIVAL-${Date.now().toString().slice(-8)}`;
  const order = {
    id: `${orderNumber}`,
    orderNumber,
    customerName,
    customerEmail,
    planName: plan.name,
    amount,
    credits,
    status: 'waiting_payment',
    createdAt: new Date().toISOString(),
    paymentTarget: 'BCA 1234567890 a.n Rival Dev',
    qrImage: '/images/payment-qr.png',
    notes: '',
    proofUrl: null,
    adminNotes: ''
  };
  paymentOrders.unshift(order);
  await savePaymentData();
  res.json(order);
});
app.post('/api/payments/:id/proof', upload.single('proof'), async (req, res) => {
  const order = paymentOrders.find((item) => item.id === req.params.id || item.orderNumber === req.params.id);
  if (!order) return res.status(404).json({ error: 'Order tidak ditemukan.' });
  if (!canAccessPayment(req, order)) return res.status(403).json({ error: 'Anda tidak memiliki akses ke order ini.' });
  if (!req.file) return res.status(400).json({ error: 'Bukti pembayaran wajib diunggah.' });
  order.proofUrl = `/api/download-proof/${encodeURIComponent(req.file.filename)}`;
  order.notes = String(req.body.notes || '').trim();
  order.status = 'payment_uploaded';
  order.uploadedAt = new Date().toISOString();
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
  const status = String(req.body.status || '').toLowerCase();
  if (!['waiting_payment', 'payment_uploaded', 'approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'Status tidak valid.' });
  order.status = status;
  order.adminNotes = String(req.body.adminNotes || '');
  if (status === 'approved') {
    const grant = await databaseRun('INSERT OR IGNORE INTO credit_grants (order_id, customer_email, credits, granted_at) VALUES (?, ?, ?, ?)', [order.id, order.customerEmail, order.credits || 0, new Date().toISOString()]);
    if (grant.changes === 1 && order.credits > 0) await databaseRun('INSERT INTO credit_balances (customer_email, credits, updated_at) VALUES (?, ?, ?) ON CONFLICT(customer_email) DO UPDATE SET credits = credits + excluded.credits, updated_at = excluded.updated_at', [order.customerEmail, order.credits, new Date().toISOString()]);
    if (!chatRooms.some((room) => room.orderId === order.id)) {
      chatRooms.push({ orderId: order.id, participants: [order.customerName, 'Seller'], messages: [{ sender: 'Seller', text: 'Halo! Pembayaran sudah diterima. Selamat menikmati akses.', sentAt: new Date().toISOString() }] });
    }
    order.creditsGranted = true;
  }
  await savePaymentData();
  res.json({ ok: true, order });
});
app.get('/api/chats/:orderId', (req, res) => {
  const order = paymentOrders.find((item) => item.id === req.params.orderId || item.orderNumber === req.params.orderId);
  if (!canAccessPayment(req, order)) return res.status(403).json({ error: 'Anda tidak memiliki akses ke chat order ini.' });
  const room = chatRooms.find((item) => item.orderId === req.params.orderId);
  if (!room) return res.json({ orderId: req.params.orderId, messages: [] });
  res.json(room);
});
app.post('/api/chats/:orderId', async (req, res) => {
  const order = paymentOrders.find((item) => item.id === req.params.orderId || item.orderNumber === req.params.orderId);
  if (!canAccessPayment(req, order)) return res.status(403).json({ error: 'Anda tidak memiliki akses ke chat order ini.' });
  const room = chatRooms.find((item) => item.orderId === req.params.orderId);
  const sender = String(req.body.sender || 'Customer').trim() || 'Customer';
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
    if (!profileResponse.ok || !profile.sub) throw new Error('Profil Google tidak dapat diverifikasi.');
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
    const name = `${safeName(req.file.originalname).replace(/\.[^.]+$/, '')}-optimized.mp3`;
    setTimeout(() => cleanup(output), 15 * 60 * 1000).unref();
    res.json({ id, name, size: stat.size, downloadUrl: `/api/download/${id}.mp3` });
  } catch (error) { cleanup(req.file.path, output); res.status(500).json({ error: error.message }); }
});
app.post('/api/remix', upload.single('audio'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'File audio wajib dipilih.' });
  const remixSpeed = Number(req.body.speed);
  const format = String(req.body.format || 'mp3').toLowerCase();
  if (!Number.isFinite(remixSpeed) || remixSpeed < 0.5 || remixSpeed > 4) {
    cleanup(req.file.path);
    return res.status(400).json({ error: 'Speed remix harus antara 0.50x dan 4.00x.' });
  }
  if (!['mp3', 'ogg', 'flac', 'wav'].includes(format)) {
    cleanup(req.file.path);
    return res.status(400).json({ error: 'Format remix harus MP3, OGG, FLAC, atau WAV.' });
  }
  const id = crypto.randomUUID();
  const output = path.join(outputDir, `${id}.${format}`);
  const codecArgs = format === 'wav'
    ? ['-c:a', 'pcm_s16le']
    : format === 'flac'
      ? ['-c:a', 'flac']
      : format === 'ogg'
        ? ['-c:a', 'libvorbis', '-q:a', '6']
        : ['-c:a', 'libmp3lame', '-b:a', '192k'];
  const tempoFilters = remixSpeed <= 2
    ? [`atempo=${remixSpeed}`]
    : ['atempo=2', `atempo=${remixSpeed / 2}`];
  try {
    await runFfmpeg(req.file.path, output, ['-filter:a', tempoFilters.join(','), ...codecArgs]);
    cleanup(req.file.path);
    const stat = fs.statSync(output);
    const originalName = safeName(req.file.originalname).replace(/\.[^.]+$/, '') || 'audio';
    const fileName = `${originalName}-remix-${remixSpeed.toFixed(2)}x.${format}`;
    const metadata = { originalSpeed: 1, remixSpeed, robloxPlaybackSpeed: Number((1 / remixSpeed).toFixed(3)), format };
    setTimeout(() => cleanup(output), 15 * 60 * 1000).unref();
    res.json({ id, name: fileName, size: stat.size, downloadUrl: `/api/download/${id}.${format}`, ...metadata });
  } catch (error) {
    cleanup(req.file.path, output);
    res.status(500).json({ error: error.message });
  }
});
app.get('/api/download/:file', (req, res) => {
  const file = path.basename(req.params.file);
  const fullPath = path.join(outputDir, file);
  if (!fs.existsSync(fullPath)) return res.status(404).json({ error: 'Hasil tidak ditemukan.' });
  res.download(fullPath, file);
});

app.get('/auth/roblox', (req, res) => {
  if (!sessionSecret()) return res.status(503).send('SESSION_SECRET belum dikonfigurasi.');
  const config = robloxConfig();
  if (config.missing.length) return res.status(503).send(robloxMissingMessage(config));
  const state = randomString(24); const verifier = randomString(48);
  sessions.set(`oauth:${state}`, { created: Date.now(), oauth: 'roblox', verifier });
  const params = new URLSearchParams({ client_id: process.env.ROBLOX_CLIENT_ID, redirect_uri: process.env.ROBLOX_REDIRECT_URI, response_type: 'code', scope: 'openid profile asset:read asset:write', state, code_challenge: pkceChallenge(verifier), code_challenge_method: 'S256' });
  res.redirect(`https://apis.roblox.com/oauth/v1/authorize?${params}`);
});
app.get('/auth/roblox/callback', async (req, res) => {
  const state = sessions.get(`oauth:${req.query.state}`);
  if (!state || state.oauth !== 'roblox') return res.status(400).send('OAuth state tidak valid. Silakan coba lagi.');
  sessions.delete(`oauth:${req.query.state}`);
  if (req.query.error) return res.status(400).send('Login Roblox dibatalkan atau izin asset:read dan asset:write ditolak.');
  try {
    const body = new URLSearchParams({ client_id: process.env.ROBLOX_CLIENT_ID, client_secret: process.env.ROBLOX_CLIENT_SECRET, grant_type: 'authorization_code', code: req.query.code, redirect_uri: process.env.ROBLOX_REDIRECT_URI, code_verifier: state.verifier });
    const tokenResponse = await fetch('https://apis.roblox.com/oauth/v1/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    const tokens = await tokenResponse.json();
    if (!tokenResponse.ok) throw new Error(tokens.error_description || 'Token Roblox gagal.');
    const profileResponse = await fetch('https://apis.roblox.com/oauth/v1/userinfo', { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    const profile = await profileResponse.json();
    if (!profileResponse.ok || !profile.sub) throw new Error('Profil Roblox tidak dapat diverifikasi.');
    const sessionId = crypto.randomUUID();
    const sessionData = {
      sessionId,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + Number(tokens.expires_in || 3600) * 1000,
      userId: String(profile.sub),
      profile: { id: String(profile.sub), username: profile.preferred_username || profile.name || 'Roblox user', displayName: profile.name || profile.preferred_username || 'Roblox user' },
      created: Date.now()
    };
    sessions.set(`roblox:${sessionId}`, sessionData);
    setRobloxServerSession(req, sessionData);
    await new Promise((resolve, reject) => req.session.save((error) => error ? reject(error) : resolve()));
    res.setHeader('Set-Cookie', robloxCookie(signRobloxSession(sessionId)));
    if (!publicBaseUrl) return res.status(503).send('PUBLIC_BASE_URL wajib diatur untuk callback Roblox.');
    const frontendUrl = publicBaseUrl;
    res.send(`<!doctype html><meta charset="utf-8"><title>Roblox connected</title><script>window.opener?.postMessage({type:'roblox-oauth',status:'success'},${JSON.stringify(frontendUrl)});window.location.replace(${JSON.stringify(`${frontendUrl}/?roblox=success`)});if(window.opener)window.close();</script><p>Roblox connected. You can close this window.</p>`);
  } catch (error) { res.status(502).send(`Roblox OAuth gagal: ${error.message}`); }
});

app.get('/api/auth/roblox/me', (req, res) => {
  const session = getRobloxServerSession(req);
  if (!session?.profile || !session.userId) return res.status(200).json({ authenticated: false });
  res.json({ authenticated: true, user: { id: session.userId || session.profile.id, username: session.profile.username, displayName: session.profile.displayName } });
});
app.post('/api/auth/roblox/logout', (req, res) => {
  const sessionId = robloxSessionId(req);
  if (sessionId) {
    const session = sessions.get(`roblox:${sessionId}`);
    if (session) { session.accessToken = null; session.refreshToken = null; session.profile = null; session.userId = null; }
    sessions.delete(`roblox:${sessionId}`);
  }
  clearRobloxServerSession(req);
  res.setHeader('Set-Cookie', robloxCookie('', 0));
  res.json({ success: true });
});

async function handleRobloxUpload(req, res) {
  const session = getRobloxServerSession(req);
  if (!session?.accessToken) return res.status(401).json({ error: 'Silakan login dengan Roblox terlebih dahulu.' });
  if (!req.file) return res.status(400).json({ error: 'File harus berupa audio.' });
  if (!configReady()) return res.status(503).json({ error: 'Konfigurasi Roblox belum lengkap di server.' });
  const creatorUserId = String(session.userId || session.profile?.id || '').trim();
  if (!creatorUserId) return res.status(401).json({ error: 'Profil Roblox tidak tersedia. Silakan login kembali.' });
  try {
    const safeDisplayName = safeName(req.body.displayName || req.body.name || req.file.originalname).replace(/\.[^.]+$/, '').slice(0, 50);
    const form = new FormData();
    form.append('request', JSON.stringify({ assetType: 'Audio', displayName: safeDisplayName, description: String(req.body.description || process.env.ROBLOX_ASSET_DESCRIPTION || 'Uploaded from Rival Audio Converter').slice(0, 1000), creationContext: { creator: { userId: creatorUserId } } }));
    form.append('fileContent', new Blob([fs.readFileSync(req.file.path)], { type: req.file.mimetype || 'audio/mpeg' }), req.file.originalname);
    const response = await robloxFetch(session, 'https://apis.roblox.com/assets/v1/assets', { method: 'POST', body: form });
    if (!response) return res.status(401).json({ error: 'Sesi Roblox kedaluwarsa. Silakan login kembali.' });
    const data = await response.json();
    cleanup(req.file.path);
    if (!response.ok) return res.status(response.status).json({ error: data.message || 'Roblox menolak upload.', details: data });
    const item = { id: data.assetId || data.asset?.id, name: req.file.originalname, status: data.path ? 'Pending moderation' : 'Uploaded', createdAt: new Date().toISOString() };
    if (!item.id) return res.status(202).json({ success: false, status: 'PROCESSING', message: 'Roblox menerima upload, tetapi Asset ID masih diproses.', operationPath: data.path });
    history.unshift(item);
    res.json({ success: true, assetId: item.id, robloxUser: { id: creatorUserId, username: session.profile?.username || 'Roblox user' } });
  } catch (error) { cleanup(req.file.path); res.status(502).json({ error: error.message }); }
}
app.post('/api/roblox/upload-audio', upload.single('audio'), async (req, res) => {
  const session = getRobloxApiSession(req);
  const apiKey = decryptRobloxApiKey(session?.encryptedKey);
  if (!apiKey) return res.status(401).json({ success: false, error: 'Connect Roblox API terlebih dahulu.' });
  if (!req.file) return res.status(400).json({ success: false, error: 'File harus berupa audio.' });
  const creatorUserId = String(session?.userId || 'Unknown').trim();
  if (!creatorUserId || creatorUserId === 'Unknown') return res.status(403).json({ success: false, error: 'Roblox User ID tidak tersedia dari API key yang aktif.' });
  const safeDisplayName = safeName(req.body.displayName || req.body.name || req.file.originalname).replace(/\.[^.]+$/, '').slice(0, 50) || 'Audio';
  try {
    const form = new FormData();
    form.append('request', JSON.stringify({
      assetType: 'Audio',
      displayName: safeDisplayName,
      description: String(req.body.description || process.env.ROBLOX_ASSET_DESCRIPTION || 'Uploaded from Rival Audio Converter').slice(0, 1000),
      creationContext: { creator: { userId: Number(creatorUserId) } }
    }));
    form.append('fileContent', new Blob([fs.readFileSync(req.file.path)], { type: req.file.mimetype || 'audio/mpeg' }), req.file.originalname);
    const uploadResponse = await fetch('https://apis.roblox.com/assets/v1/assets', {
      method: 'POST',
      headers: { 'x-api-key': apiKey },
      body: form
    });
    const uploadData = await uploadResponse.json().catch(() => ({}));
    cleanup(req.file.path);
    if (!uploadResponse.ok) {
      const message = uploadData?.message || uploadData?.error || 'Roblox menolak upload.';
      if (uploadResponse.status === 401) return res.status(401).json({ success: false, error: 'Invalid Roblox API Key' });
      if (uploadResponse.status === 403) return res.status(403).json({ success: false, error: 'Izin upload ditolak Roblox. Pastikan API Key memiliki Assets: Write dan terhubung ke universe yang benar.' });
      if (uploadResponse.status === 429) return res.status(429).json({ success: false, error: 'Upload limit reached.' });
      if (uploadResponse.status >= 500) return res.status(503).json({ success: false, error: 'Roblox API unavailable.' });
      return res.status(uploadResponse.status).json({ success: false, error: message });
    }
    const operationId = uploadData?.operationId || uploadData?.id || uploadData?.operation?.id || (typeof uploadData?.path === 'string' ? uploadData.path.split('/').pop() : '');
    if (!operationId) return res.status(202).json({ success: false, error: 'Roblox menerima upload, tetapi operation ID belum tersedia.' });
    const operationResult = await pollRobloxOperation(apiKey, operationId);
    const assetId = Number(operationResult?.result?.assetId || operationResult?.assetId || operationResult?.result?.id || operationResult?.id || 0);
    if (!assetId) {
      return res.status(400).json({ success: false, error: 'Roblox moderation failed.' });
    }
    history.unshift({ id: assetId, name: req.file.originalname, status: 'Uploaded', createdAt: new Date().toISOString() });
    res.json({ success: true, assetId, robloxUser: { id: creatorUserId } });
  } catch (error) {
    cleanup(req.file.path);
    const message = error.message || 'Roblox API unavailable.';
    if (message.includes('Invalid Roblox API Key')) return res.status(401).json({ success: false, error: 'Invalid Roblox API Key' });
    if (message.includes('Upload limit reached')) return res.status(429).json({ success: false, error: 'Upload limit reached.' });
    if (message.includes('Roblox moderation failed')) return res.status(400).json({ success: false, error: 'Roblox moderation failed.' });
    if (message.includes('still processing')) return res.status(202).json({ success: false, error: 'Roblox is still processing this upload. Please try again in a moment.' });
    res.status(503).json({ success: false, error: 'Roblox API unavailable.' });
  }
});
app.get('/api/roblox/assets/:id', async (req, res) => {
  const session = getRobloxApiSession(req);
  const apiKey = decryptRobloxApiKey(session?.encryptedKey);
  if (!apiKey) return res.status(401).json({ error: 'Connect Roblox API terlebih dahulu.' });
  const response = await fetch(`https://apis.roblox.com/assets/v1/assets/${encodeURIComponent(req.params.id)}`, { method: 'GET', headers: { 'x-api-key': apiKey, Accept: 'application/json' } });
  const payload = await response.json().catch(() => ({}));
  res.status(response.status).json(payload);
});
app.post('/api/roblox-api/connect', async (req, res) => {
  const apiKey = String(req.body.apiKey || '').trim();
  const creatorUserId = String(req.body.creatorUserId || '').trim();
  if (!apiKey) return res.status(400).json({ ok: false, error: 'Paste your Roblox API Key' });
  if (creatorUserId && !/^\d+$/.test(creatorUserId)) return res.status(400).json({ ok: false, error: 'Creator/User ID harus berupa angka.' });
  const validation = await validateRobloxApiKey(apiKey);
  if (!validation.ok) return res.status(401).json({ ok: false, error: validation.error || 'Invalid Roblox API Key' });
  setRobloxApiSession(req, {
    encryptedKey: encryptRobloxApiKey(apiKey),
    userId: validation.userId !== 'Unknown' ? validation.userId : creatorUserId || 'Unknown',
    creator: validation.creator || 'Creator',
    permissions: validation.permissions || ['Assets', 'Read', 'Write'],
    apiStatus: validation.status || 'Connected',
    connected: true,
    connectedAt: new Date().toISOString()
  });
  res.json({ ok: true, connected: true, userId: validation.userId !== 'Unknown' ? validation.userId : creatorUserId || 'Unknown', creator: validation.creator || 'Creator', permissions: validation.permissions || ['Assets', 'Read', 'Write'], apiStatus: validation.status || 'Connected', message: validation.message || '' });
});
app.get('/api/roblox-api/session', (req, res) => {
  const session = getRobloxApiSession(req);
  if (!session) return res.json({ connected: false, apiStatus: 'NOT CONNECTED' });
  const apiKey = decryptRobloxApiKey(session.encryptedKey);
  if (!apiKey) return res.json({ connected: false, apiStatus: 'NOT CONNECTED' });
  const payload = {
    connected: true,
    userId: session.userId || 'Unknown',
    creator: session.creator || 'Creator',
    permissions: session.permissions || ['Assets', 'Read', 'Write'],
    apiStatus: validation.status || 'Connected',
    connectedAt: session.connectedAt || new Date().toISOString()
  };
  res.json(payload);
});
app.post('/api/roblox-api/test', async (req, res) => {
  const session = getRobloxApiSession(req);
  const apiKey = decryptRobloxApiKey(session?.encryptedKey);
  if (!apiKey) return res.status(401).json({ ok: false, error: 'Connect Roblox API terlebih dahulu.' });
  const validation = await validateRobloxApiKey(apiKey);
  if (!validation.ok) return res.status(401).json({ ok: false, error: validation.error || 'Invalid Roblox API Key' });
  setRobloxApiSession(req, {
    ...session,
    userId: validation.userId || session.userId || 'Unknown',
    creator: validation.creator || session.creator || 'Creator',
    permissions: validation.permissions || ['Assets', 'Read', 'Write'],
    apiStatus: 'Connected',
    connected: true
  });
  res.json({ ok: true, connected: true, userId: validation.userId || session.userId || 'Unknown', creator: validation.creator || session.creator || 'Creator', permissions: validation.permissions || ['Assets', 'Read', 'Write'], apiStatus: validation.status || 'Connected', message: validation.message || '' });
});
app.delete('/api/roblox-api/remove', (req, res) => {
  clearRobloxApiSession(req);
  res.json({ ok: true, connected: false, apiStatus: 'NOT CONNECTED' });
});

app.get('*', (req, res) => res.sendFile(path.join(fs.existsSync(clientDist) ? clientDist : root, 'index.html')));
app.listen(port, '0.0.0.0', () => console.log(`Rival Audio Converter listening on port ${port}`));
