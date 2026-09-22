const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const multer = require('multer');
const dotenv = require('dotenv');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
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
fs.mkdirSync(uploadDir, { recursive: true });
fs.mkdirSync(outputDir, { recursive: true });
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
function runFfmpeg(input, output, args) {
  return new Promise((resolve, reject) => {
    const process = spawn('ffmpeg', ['-y', '-i', input, ...args, output]);
    let error = '';
    process.stderr.on('data', (chunk) => { error += chunk.toString(); });
    process.on('error', () => reject(new Error('FFmpeg tidak ditemukan. Install FFmpeg dan pastikan ada di PATH.')));
    process.on('close', (code) => code === 0 ? resolve() : reject(new Error(error.slice(-800) || 'Konversi gagal.')));
  });
}
function cleanup(...files) { files.forEach((file) => file && fs.rm(file, { force: true }, () => {})); }

app.get('/api/health', (req, res) => res.json({ ok: true, robloxConfigured: configReady(), robloxConfig: { loadedFrom: robloxConfig().loadedFrom, missing: robloxConfig().missing }, ffmpeg: 'system' }));
app.get('/api/session', (req, res) => res.json({ connected: Boolean(authSession(req) || robloxSession(req)), history }));
app.get('/api/auth/me', (req, res) => {
  if (req.session.googleUser) return res.json({ authenticated: true, user: req.session.googleUser });
  const session = authSession(req);
  if (!session?.user) return res.status(401).json({ authenticated: false });
  res.json({ authenticated: true, user: session.user });
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
  if (!Number.isFinite(remixSpeed) || remixSpeed < 0.5 || remixSpeed > 2) {
    cleanup(req.file.path);
    return res.status(400).json({ error: 'Speed remix harus antara 0.50x dan 2.00x.' });
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
  try {
    await runFfmpeg(req.file.path, output, ['-filter:a', `atempo=${remixSpeed}`, ...codecArgs]);
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
app.post('/api/roblox/upload-audio', upload.single('audio'), handleRobloxUpload);
app.get('/api/roblox/assets/:id', async (req, res) => {
  const session = robloxSession(req);
  if (!session?.accessToken) return res.status(401).json({ error: 'Sesi Roblox tidak ditemukan.' });
  const response = await robloxFetch(session, `https://apis.roblox.com/assets/v1/assets/${encodeURIComponent(req.params.id)}`);
  if (!response) return res.status(401).json({ error: 'Sesi Roblox kedaluwarsa. Silakan login kembali.' });
  const data = await response.json();
  res.status(response.status).json(data);
});

app.get('*', (req, res) => res.sendFile(path.join(fs.existsSync(clientDist) ? clientDist : root, 'index.html')));
app.listen(port, '0.0.0.0', () => console.log(`Rival Audio Converter listening on port ${port}`));
