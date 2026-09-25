const $ = (selector) => document.querySelector(selector);
const fileInput = $('#fileInput');
const dropzone = $('#dropzone');
let selectedFile = null;
let converted = null;
let sessionId = '';

function setText(selector, value) { $(selector).textContent = value; }
function formatBytes(bytes) { return `${(bytes / 1024 / 1024).toFixed(2)} MB`; }
function show(selector, visible) { $(selector).classList.toggle('hidden', !visible); }
function setProgress(value, label) { setText('#progressValue', `${value}%`); setText('#progressLabel', label); $('#progressBar').style.width = `${value}%`; }
function setNotice(message, type = '') { const element = $('#uploadStatus'); element.textContent = message; element.className = `upload-status ${type}`; }
function validateAudioInput(file) { if (!file) return 'Audio file is required'; if (!file.size) return 'Audio file is empty'; if (file.size > 100 * 1024 * 1024) return 'File is too large'; const extension = file.name.toLowerCase().match(/\.[^.]+$/)?.[0]; const types = ['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/flac', 'audio/aac', 'audio/mp4', 'audio/webm']; if (!types.includes(file.type.toLowerCase()) && !['.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a', '.webm'].includes(extension)) return 'Unsupported audio format'; return ''; }
function updateFile(file) { const error = validateAudioInput(file); if (error) return setNotice(error, 'error'); selectedFile = file; setText('#fileTitle', file.name); setText('#fileMeta', `${formatBytes(file.size)} · ${file.type || 'audio'}`); show('#fileSummary', true); show('#dropzone', false); $('#convertButton').disabled = false; $('#previewButton').disabled = false; }
function clearFile() { selectedFile = null; converted = null; fileInput.value = ''; show('#fileSummary', false); show('#dropzone', true); show('#resultCard', false); $('#convertButton').disabled = true; $('#previewButton').disabled = true; }
async function convertAudio() { if (!selectedFile) return; const form = new FormData(); form.append('audio', selectedFile); form.append('format', $('#format').value); form.append('quality', $('#quality').value); $('#convertButton').disabled = true; show('#progressWrap', true); setProgress(12, 'Uploading audio...'); const timer = setInterval(() => { const current = Number($('#progressValue').textContent.replace('%', '')); if (current < 86) setProgress(current + 7, 'Converting with FFmpeg...'); }, 350); try { const response = await fetch('/api/convert', { method: 'POST', body: form }); const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Conversion failed'); converted = data; setProgress(100, 'Conversion complete'); setText('#resultName', data.name); $('#resultPlayer').src = data.downloadUrl; $('#downloadButton').href = data.downloadUrl; show('#resultCard', true); setNotice('', ''); } catch (error) { setNotice(error.message, 'error'); setProgress(0, 'Conversion failed'); } finally { clearInterval(timer); $('#convertButton').disabled = false; } }
async function validateYoutube() { const response = await fetch('/api/youtube/validate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: $('#youtubeUrl').value }) }); const data = await response.json(); setText('#youtubeMessage', data.message || data.error); $('#youtubeMessage').className = response.ok ? 'valid' : 'error'; }
async function uploadToRoblox() { if (!converted?.downloadUrl || !converted.name) return setNotice('Hasil remix belum tersedia.', 'error'); const downloadResponse = await fetch(converted.downloadUrl, { credentials: 'include' }); if (!downloadResponse.ok) return setNotice('Hasil audio tidak dapat dibaca.', 'error'); const blob = await downloadResponse.blob(); const mime = blob.type || ({ mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac' }[converted.format] || ''); if (!blob.size) return setNotice('Audio file is empty', 'error'); if (!mime.startsWith('audio/')) return setNotice('Unsupported audio format', 'error'); const audioFile = new File([blob], converted.name, { type: mime }); const form = new FormData(); form.append('file', audioFile, audioFile.name); form.append('displayName', converted.name.replace(/\.[^.]+$/, '')); if (!form.has('file') || !form.get('file')?.size) return setNotice('Hasil remix belum tersedia.', 'error'); console.info('[Roblox upload debug]', { endpoint: '/api/roblox/upload-audio', method: 'POST', bodyPresent: true, fields: Array.from(form.keys()), filename: audioFile.name, mimeType: audioFile.type, fileSize: audioFile.size }); $('#uploadButton').disabled = true; setNotice('Mengirim asset ke Roblox dan menunggu status moderasi...'); try { const response = await fetch('/api/roblox/upload-audio', { method: 'POST', credentials: 'include', body: form }); let data = await response.json().catch(() => ({})); if (response.status === 202 && data.operationId) { for (let attempt = 0; attempt < 40; attempt += 1) { await new Promise((resolve) => window.setTimeout(resolve, 3000)); const pollResponse = await fetch(`/api/roblox/operations/${encodeURIComponent(data.operationId)}`, { credentials: 'include' }); data = await pollResponse.json().catch(() => ({})); if (pollResponse.ok && data.success === true && /^\d+$/.test(String(data.assetId || '')) && Number(data.assetId) > 0) break; if (pollResponse.status !== 202) throw new Error(data.error || 'Roblox gagal memproses audio.'); if (attempt === 39) throw new Error(data.error || 'Roblox masih memproses audio.'); } } if (data.success !== true || !/^\d+$/.test(String(data.assetId || '')) || Number(data.assetId) <= 0) throw new Error(data.error || 'Roblox belum mengembalikan Asset ID final.'); setNotice(`Asset ID: ${data.assetId}`, 'success'); $('#copyAssetButton').dataset.id = data.assetId; show('#copyAssetButton', true); loadHistory(); } catch (error) { setNotice(error.message, 'error'); } finally { $('#uploadButton').disabled = false; } }
async function loadHistory() { const response = await fetch('/api/session', { credentials: 'include' }); const data = await response.json(); const list = $('#historyList'); list.innerHTML = data.history?.length ? data.history.map((item) => `<div class="history-item"><span class="history-icon">♫</span><div><strong>${item.name}</strong><small>Roblox Audio Asset · ${item.status}</small></div><b>${item.id || 'PENDING'}</b><button class="copy-id" data-id="${item.id || ''}">Copy ID</button></div>`).join('') : '<p class="empty-state">Belum ada audio yang di-upload ke Roblox.</p>'; list.querySelectorAll('.copy-id').forEach((button) => button.addEventListener('click', () => navigator.clipboard.writeText(button.dataset.id))); }

dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') fileInput.click(); });
fileInput.addEventListener('change', (event) => updateFile(event.target.files[0]));
['dragenter', 'dragover'].forEach((name) => dropzone.addEventListener(name, (event) => { event.preventDefault(); dropzone.classList.add('dragover'); }));
['dragleave', 'drop'].forEach((name) => dropzone.addEventListener(name, (event) => { event.preventDefault(); dropzone.classList.remove('dragover'); }));
dropzone.addEventListener('drop', (event) => updateFile(event.dataTransfer.files[0]));
$('#removeFile').addEventListener('click', clearFile); $('#convertButton').addEventListener('click', convertAudio); $('#uploadButton').addEventListener('click', uploadToRoblox); $('#connectButton').addEventListener('click', () => { window.location.href = '/roblox-api'; }); $('#validateYoutube').addEventListener('click', validateYoutube);
$('#copyAssetButton').addEventListener('click', () => navigator.clipboard.writeText($('#copyAssetButton').dataset.id));
document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => { document.querySelector('.tab.active').classList.remove('active'); tab.classList.add('active'); const youtube = tab.dataset.source === 'youtube'; show('#youtubeBox', youtube); show('#dropzone', !youtube && !selectedFile); }));
$('#previewButton').addEventListener('click', () => { if ($('#resultPlayer').src) $('#resultPlayer').play(); else setNotice('Convert audio terlebih dahulu untuk preview.', 'error'); });
document.addEventListener('keydown', (event) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') { event.preventDefault(); fileInput.click(); } });
const callback = new URLSearchParams(window.location.search);
loadHistory();

const legacySidebar = document.querySelector('.legacy-sidebar');
const legacyCollapse = document.querySelector('.legacy-collapse');
legacyCollapse?.addEventListener('click', () => legacySidebar.classList.toggle('is-collapsed'));

const legacyPages = {
	payments: ['PAYMENTS', 'Payment History', 'Monitor your transaction history.', '<div class="legacy-stat"><span>Total transactions</span><strong>0</strong></div><div class="legacy-table"><b>INVOICE</b><b>PACKAGE</b><b>AMOUNT</b><b>STATUS</b><b>DATE</b><p>No payment transactions yet.</p></div>'],
	uploader: ['ROBLOX', 'BMK Uploader', 'Upload approved audio directly to your Roblox account.', '<div class="legacy-feature"><strong>Connect Roblox API</strong><p>Use your Roblox Open Cloud API key through the secure backend connection.</p><button class="legacy-primary" onclick="window.location.href=\'/roblox-api\'">Connect Roblox API</button></div>'],
	'developer-api': ['API', 'Developer API', 'Build secure audio workflows with server-side API access.', '<div class="legacy-api-grid"><div><span>API STATUS</span><strong class="green">● ACTIVE</strong></div><div><span>API CREDITS</span><strong>0</strong></div></div><div class="legacy-code">POST /api/audio/convert<br>POST /api/roblox/upload<br>GET /api/audio/history</div>'],
	'b2b-api': ['API', 'B2B API', 'Professional audio automation for creator teams.', '<div class="legacy-feature"><strong>REST API workspace</strong><p>Manage API key, credits, usage, and request statistics from one place.</p><button class="legacy-primary">Open API Documentation ↗</button></div>'],
	profile: ['ACCOUNT', 'Profile', 'Manage your Rival Dev creator identity.', '<div class="legacy-feature"><div class="legacy-avatar">R</div><strong>Rivalid</strong><p>Roblox creator · Connected account status is managed through OAuth.</p><button class="legacy-primary">Edit profile</button></div>'],
	settings: ['ACCOUNT', 'Settings', 'Control workspace preferences and integrations.', '<div class="legacy-settings"><label>Email notifications <input type="checkbox" checked></label><label>Auto optimize audio <input type="checkbox" checked></label><label>Compact history <input type="checkbox"></label></div>'],
	converter: ['TOOLS', 'Audio Converter', 'Convert and optimize audio for Roblox.', '']
};
function renderLegacyRoute() {
	const key = new URLSearchParams(window.location.search).get('page') || 'converter';
	const view = document.querySelector('#legacyRouteView');
	const main = document.querySelector('main');
	const page = legacyPages[key] || legacyPages.converter;
	document.querySelectorAll('.legacy-nav a').forEach((link) => link.classList.toggle('legacy-active', link.dataset.page === key));
	if (key === 'converter') { view.hidden = true; main.hidden = false; return; }
	main.hidden = true; view.hidden = false;
	view.innerHTML = `<div class="legacy-route-head"><div><small>${page[0]}</small><h1>${page[1]}</h1><p>${page[2]}</p></div><span>RIVAL DEV / WORKSPACE</span></div><div class="legacy-route-card">${page[3]}</div>`;
}
document.querySelectorAll('.legacy-nav a[data-page]').forEach((link) => link.addEventListener('click', (event) => { event.preventDefault(); history.pushState({}, '', link.href); renderLegacyRoute(); window.scrollTo({ top: 0, behavior: 'smooth' }); }));
window.addEventListener('popstate', renderLegacyRoute);
renderLegacyRoute();

const legacyLogin = document.querySelector('#legacyLogin');
const legacyGoogleLogin = document.querySelector('#legacyGoogleLogin');
fetch('/api/auth/me', { credentials: 'include' }).then((response) => { if (!response.ok) legacyLogin.hidden = false; });
legacyGoogleLogin?.addEventListener('click', () => { window.location.href = '/auth/google'; });
fetch('/api/auth/config').then((response) => response.json()).then((config) => { if (!config.googleConfigured && legacyGoogleLogin) { legacyGoogleLogin.disabled = true; legacyGoogleLogin.innerHTML = '<b>G</b> Configure Google OAuth first <span>!</span>'; } }).catch(() => {});
