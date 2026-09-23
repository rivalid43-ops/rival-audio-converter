import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import './metric-icons.css';
import './payment-layout.css';
import {
  Activity, ArrowDownToLine, ArrowUpRight, Bell, BookOpen, Check, ChevronRight, CircleHelp, CloudUpload,
  Code2, Copy, CreditCard, Download, FileAudio, Gauge, History, KeyRound, LayoutDashboard, Library, Link2, LockKeyhole, Menu,
  MessageCircle, MoreHorizontal, Music2, Pause as PauseIcon, Play, Plus, RefreshCw, Search, Settings, ShieldCheck, Sparkles, Trash2, Upload,
  UserRound, Users, WandSparkles, X, Youtube, Zap
} from 'lucide-react';

const languageLabels = {
  id: {
    main: 'UTAMA',
    roblox: 'ROBLOX',
    tools: 'ALAT',
    api: 'API',
    account: 'AKUN',
    greeting: 'Halo',
    online: 'online',
    buy: 'Beli',
    dashboard: 'Dasbor',
    paymentHistory: 'Riwayat Pembayaran',
    robloxAudio: 'Audio Roblox',
    audioLibrary: 'Perpustakaan Audio',
    uploadHistory: 'Riwayat Unggah',
    audioConverter: 'Konverter Audio',
    bmkUploader: 'Uploader BMK',
    remixMusic: 'Remix Musik',
    youtubeAudio: 'Konverter Audio YouTube',
    audioOptimizer: 'Optimalisasi Audio',
    profile: 'Profil',
    settings: 'Pengaturan',
    adminPayments: 'Pembayaran Admin',
    expandSidebar: 'Perluas sidebar',
    collapseSidebar: 'Tutup sidebar',
    premium: 'Upgrade Premium',
    helpCenter: 'Pusat bantuan',
    currentLanguage: 'ID'
  },
  en: {
    main: 'MAIN',
    roblox: 'ROBLOX',
    tools: 'TOOLS',
    api: 'API',
    account: 'ACCOUNT',
    greeting: 'Hello',
    online: 'online',
    buy: 'Buy',
    dashboard: 'Dashboard',
    paymentHistory: 'Payment History',
    robloxAudio: 'Roblox Audio',
    audioLibrary: 'Audio Library',
    uploadHistory: 'Upload History',
    audioConverter: 'Audio Converter',
    bmkUploader: 'BMK Uploader',
    remixMusic: 'Remix Music',
    youtubeAudio: 'YouTube Audio Converter',
    audioOptimizer: 'Audio Optimizer',
    profile: 'Profile',
    settings: 'Settings',
    adminPayments: 'Admin Payments',
    expandSidebar: 'Expand sidebar',
    collapseSidebar: 'Collapse sidebar',
    premium: 'Upgrade Premium',
    helpCenter: 'Help center',
    currentLanguage: 'EN'
  }
};

function getNavGroups(language) {
  const labels = languageLabels[language] || languageLabels.id;
  return [
    { label: labels.main, items: [[labels.dashboard, 'dashboard', LayoutDashboard]] },
    { label: labels.roblox, items: [[labels.paymentHistory, 'payments', CreditCard], [labels.robloxAudio, 'roblox-audio', Music2], [labels.audioLibrary, 'library', Library], [labels.uploadHistory, 'history', History]] },
    { label: labels.tools, items: [[labels.audioConverter, 'converter', WandSparkles], [labels.bmkUploader, 'uploader', CloudUpload], [labels.remixMusic, 'remix', Music2], [labels.youtubeAudio, 'youtube', Youtube], [labels.audioOptimizer, 'optimizer', Gauge]] },
    { label: labels.api, items: [['Roblox API', 'roblox-api', KeyRound], ['Developer API', 'developer-api', Code2], ['B2B API', 'b2b-api', BookOpen]] },
    { label: labels.account, items: [[labels.profile, 'profile', UserRound], [labels.settings, 'settings', Settings], [labels.adminPayments, 'admin-payments', ShieldCheck]] }
  ];
}
const recentUploads = [
  { name: 'space-radio.mp3', format: 'MP3', duration: '02:41', status: 'SUCCESS', id: '1847302958', date: 'Today, 10:42' },
  { name: 'quest-theme.wav', format: 'WAV', duration: '01:18', status: 'PROCESSING', id: '—', date: 'Yesterday' },
  { name: 'coin-pickup.ogg', format: 'OGG', duration: '00:08', status: 'FAILED', id: '—', date: 'Sep 18, 2026' }
];

function cn(...values) { return values.filter(Boolean).join(' '); }
function formatBytes(bytes) { return `${(bytes / 1024 / 1024).toFixed(2)} MB`; }
function isMediaFile(file) { return Boolean(file && (file.type.startsWith('audio/') || file.type.startsWith('video/'))); }

function LegacyRemixPage() {
  const location = useLocation();
  const routerNavigate = useNavigate();
  const page = location.pathname.slice(1) || 'dashboard'; 
  const [refreshHistory, setRefreshHistory] = useState(() => () => {});
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [session, setSession] = useState({ connected: false, name: 'Rivalid', userId: '—' });
  const [credits, setCredits] = useState(0);
  const [history, setHistory] = useState(recentUploads);
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [speed, setSpeed] = useState(1);
  const [speedMode, setSpeedMode] = useState('manual');
  const [automaticSpeed, setAutomaticSpeed] = useState(3.63);
  const [format, setFormat] = useState('mp3');
  const [previewing, setPreviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [robloxConnected, setRobloxConnected] = useState(false);
  const audioRef = useRef(null);
  const canvasRef = useRef(null);
  const originalSpeed = 1;
  const selectedSpeed = speedMode === 'automatic' ? automaticSpeed : speed;
  const robloxSpeed = Number((1 / selectedSpeed).toFixed(3));

  useEffect(() => {
    if (!file || !canvasRef.current) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const context = new AudioContext();
      const buffer = await context.decodeAudioData(reader.result);
      const canvas = canvasRef.current;
      const drawing = canvas.getContext('2d');
      const samples = buffer.getChannelData(0);
      drawing.clearRect(0, 0, canvas.width, canvas.height);
      drawing.strokeStyle = '#c8f76e';
      drawing.lineWidth = 1;
      drawing.beginPath();
      for (let x = 0; x < canvas.width; x += 1) {
        const start = Math.floor(x * samples.length / canvas.width);
        const end = Math.max(start + 1, Math.floor((x + 1) * samples.length / canvas.width));
        let peak = 0;
        for (let index = start; index < end; index += 1) peak = Math.max(peak, Math.abs(samples[index]));
        const y = (1 - peak) * canvas.height / 2;
        drawing.moveTo(x, canvas.height / 2 - y);
        drawing.lineTo(x, canvas.height / 2 + y);
      }
      drawing.stroke();
      context.close();
    };
    reader.readAsArrayBuffer(file);
    return () => reader.abort();
  }, [file]);

  useEffect(() => { if (audioRef.current) audioRef.current.playbackRate = selectedSpeed; }, [selectedSpeed]);
  useEffect(() => { setResult(null); }, [selectedSpeed, format]);
  useEffect(() => { fetch('/api/roblox-api/session', { credentials: 'include' }).then((response) => response.ok ? response.json() : null).then((data) => setRobloxConnected(Boolean(data?.connected))).catch(() => setRobloxConnected(false)); }, []);
  const chooseFile = (next) => { if (next?.type.startsWith('audio/')) { setFile(next); setResult(null); setPreviewing(false); } };
  const togglePreview = async () => { if (!audioRef.current || !file) return; audioRef.current.playbackRate = selectedSpeed; if (audioRef.current.paused) { await audioRef.current.play(); setPreviewing(true); } else { audioRef.current.pause(); setPreviewing(false); } };
  const stopPreview = () => { if (!audioRef.current) return; audioRef.current.pause(); audioRef.current.currentTime = 0; setPreviewing(false); };
  const exportRemix = async () => { if (!file) return; setBusy(true); setResult(null); const form = new FormData(); form.append('audio', file); form.append('speed', String(selectedSpeed)); form.append('format', format); try { const response = await fetch('/api/remix', { method: 'POST', credentials: 'include', body: form }); const data = await response.json(); if (!response.ok) throw new Error(data.error); setResult(data); } catch (error) { setResult({ error: error.message }); } finally { setBusy(false); } };
  const downloadRemix = async () => { if (!result?.downloadUrl) return; setDownloadBusy(true); try { const response = await fetch(result.downloadUrl, { credentials: 'include' }); if (!response.ok) throw new Error('File hasil tidak ditemukan.'); const blob = await response.blob(); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = result.name; link.click(); URL.revokeObjectURL(url); } catch (error) { setResult((current) => ({ ...current, error: error.message })); } finally { setDownloadBusy(false); } };
  const uploadRemixToRoblox = async () => { if (!result?.downloadUrl) return; setUploadBusy(true); try { const blob = await fetch(result.downloadUrl, { credentials: 'include' }).then((response) => response.blob()); const form = new FormData(); form.append('audio', blob, result.name); form.append('displayName', result.name.replace(/\.[^.]+$/, '')); const response = await fetch('/api/roblox/upload-audio', { method: 'POST', credentials: 'include', body: form }); const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Upload ke Roblox gagal.'); setResult((current) => ({ ...current, assetId: data.assetId })); } catch (error) { setResult((current) => ({ ...current, error: error.message })); } finally { setUploadBusy(false); } };
  const copyRobloxSpeed = () => navigator.clipboard.writeText(robloxSpeed.toFixed(3));
  return <section className="panel standalone-panel remix-page"><div className="panel-heading"><div><span className="eyebrow">AUDIO REMIX</span><h2>Remix Musik</h2></div><span className="safe-badge"><LockKeyhole size={12} /> LOCAL PREVIEW</span></div><label className="drop-area remix-drop"><input type="file" accept="audio/*" onChange={(event) => chooseFile(event.target.files[0])} /><div className="drop-icon"><Upload size={21} /></div><strong>{file ? file.name : 'Upload audio untuk remix'}</strong><span>MP3, WAV, OGG, M4A, FLAC hingga 100 MB</span></label>{file && <><canvas ref={canvasRef} className="remix-waveform" width="1000" height="180" /><audio ref={audioRef} src={URL.createObjectURL(file)} onEnded={() => setPreviewing(false)} /><div className="remix-controls"><label className="field-label">SPEED MODE<select value={speedMode} onChange={(event) => { setSpeedMode(event.target.value); setResult(null); }}><option value="manual">Manual</option><option value="automatic">Automatic</option></select></label>{speedMode === 'automatic' ? <label className="field-label">AUTOMATIC SPEED<select value={automaticSpeed} onChange={(event) => { setAutomaticSpeed(Number(event.target.value)); setResult(null); }}><option value="3.63">3.63x</option><option value="3.34">3.34x</option></select></label> : <label className="field-label">SPEED / KECEPATAN<input type="range" min="0.5" max="4" step="0.01" value={speed} onChange={(event) => { setSpeed(Number(event.target.value)); setResult(null); }} /><strong>{speed.toFixed(2)}x</strong></label>}<label className="field-label">FORMAT EXPORT<select value={format} onChange={(event) => { setFormat(event.target.value); setResult(null); }}><option value="mp3">MP3</option><option value="ogg">OGG</option><option value="flac">FLAC</option><option value="wav">WAV</option></select></label></div>
      <div className="result-actions"><button className="primary-button" onClick={togglePreview}>{previewing ? <><PauseIcon /> Pause Tes</> : <><Play size={16} /> Play Tes</>}</button><button className="secondary-button" onClick={() => { if (audioRef.current) { audioRef.current.pause(); audioRef.current.currentTime = 0; } setPreviewing(false); }}>Stop</button><button className="convert-button" disabled={busy} onClick={exportRemix}>{busy ? 'Remixing...' : 'Export Remix'} <ArrowUpRight size={16} /></button></div>
      <div className="remix-metadata"><span>Speed Mode: <strong>{speedMode === 'automatic' ? 'Automatic' : 'Manual'}</strong></span><span>Speed Remix: <strong>{selectedSpeed.toFixed(3)}x</strong></span><span>Roblox PlaybackSpeed: <strong>{robloxSpeed.toFixed(3)}x</strong></span></div>
    </>}
    {result?.error && <div className="notice-bar notice-error">{result.error}</div>}
    {result?.downloadUrl && <section className="panel result-panel remix-result"><div className="panel-heading"><div><span className="eyebrow">HASIL REMIX</span><h2>Musik siap didownload</h2></div><span className="success-label"><Check size={13} /> READY</span></div><audio controls src={result.downloadUrl} /><div className="result-actions"><button className="download-button" onClick={downloadRemix} disabled={downloadBusy}><Download size={16} /> {downloadBusy ? 'Downloading...' : `Download ${result.format.toUpperCase()}`}</button>{robloxConnected ? <button className="roblox-button" onClick={uploadRemixToRoblox} disabled={uploadBusy}><CloudUpload size={16} /> {uploadBusy ? 'Uploading...' : 'Save to Roblox'}</button> : <button className="roblox-button" onClick={() => { window.location.hash = '#/roblox-api'; }}>Connect Roblox API</button>}<span className="muted-note">Roblox PlaybackSpeed: {result.robloxPlaybackSpeed.toFixed(3)}x</span></div>{result.assetId && <div className="notice-bar notice-success"><Check size={16} /> Asset Roblox: {result.assetId}</div>}</section>}
  </section>;
}

function RemixPage() { return <LegacyRemixPage />; }

function PageView(props) {
  const { page, adminAccess } = props;
  if (page === 'dashboard') return <Dashboard navigate={props.navigate} history={props.history} />;
  if (page === 'remix') return <RemixPage />;
  if (page === 'converter') return <Converter {...props} />;
  if (page === 'youtube') return <YoutubePage navigate={props.navigate} />;
  if (page === 'uploader') return <Uploader {...props} />;
  if (page === 'library' || page === 'roblox-audio') return <LibraryPage history={props.history} />;
  if (page === 'history') return <HistoryPage history={props.history} />;
  if (page === 'optimizer') return <UtilityPage title="Audio Optimizer" icon={Gauge} description="Normalize, trim, and polish your audio before conversion." navigate={props.navigate} />;
  if (page === 'file-converter') return <UtilityPage title="File Converter" icon={FileAudio} description="Convert media files with the same secure processing pipeline." navigate={props.navigate} />;
  if (page === 'roblox-api') return <RobloxApiPage {...props} />;
  if (page === 'b2b-api') return <B2bApi navigate={props.navigate} />;
  if (page === 'developer-api') return <DeveloperApi navigate={props.navigate} />;
  if (page === 'api-docs') return <ApiDocs />;
  if (page === 'payments') return <PaymentHistory />;
  if (page === 'credits') return <CreditsPage navigate={props.navigate} />;
  if (page === 'billing') return <BillingPage openPayment={props.openPayment} />;
  if (page === 'profile') return <Profile session={props.session} />;
  if (page === 'admin-payments') {
    if (!adminAccess) {
      return <section className="panel standalone-panel"><div className="panel-title"><div><span className="eyebrow">ACCESS DENIED</span><h2>Unauthorized</h2></div></div><div className="notice-bar notice-error">Hanya admin pembayaran yang dapat mengakses halaman ini.</div></section>;
    }
    return <AdminPaymentsPage />;
  }
  return <WorkspaceSettingsPage session={props.session} setCredits={props.setCredits} />;
}

function Dashboard({ navigate, history }) { return <><div className="metric-grid"><Metric icon={Zap} label="Credits" value="0" sub="Buy credits to convert" accent="lime" /><Metric icon={Music2} label="Audio uploads" value="0" sub="No uploads yet" accent="blue" /><Metric icon={WandSparkles} label="Converted" value="0" sub="Start your first conversion" accent="orange" /><Metric icon={CloudUpload} label="Roblox assets" value={history.filter((item) => item.status === 'SUCCESS').length} sub="Verified asset IDs only" accent="purple" /></div><div className="dashboard-columns"><section className="panel welcome-panel"><div><span className="eyebrow">CREATOR CONTROL CENTER</span><h2>Make your sound<br /><em>stand out.</em></h2><p>Prepare game-ready audio with a fast, focused workflow built for Roblox creators.</p><button className="primary-button" onClick={() => navigate('converter')}>Open converter <ArrowUpRight size={16} /></button></div><div className="welcome-orb"><WandSparkles size={50} /></div></section><section className="panel mini-panel"><div className="panel-title"><div><span className="eyebrow">QUICK ACTIONS</span><h3>Start a workflow</h3></div></div><div className="quick-actions"><button onClick={() => navigate('converter')}><WandSparkles size={16} /> Audio Converter <ArrowUpRight size={14} /></button><button onClick={() => navigate('uploader')}><CloudUpload size={16} /> Roblox Uploader <ArrowUpRight size={14} /></button><button onClick={() => navigate('youtube')}><Youtube size={16} /> YouTube Audio <ArrowUpRight size={14} /></button><button onClick={() => navigate('developer-api')}><Code2 size={16} /> Developer API <ArrowUpRight size={14} /></button></div></section></div></>; }
function Metric({ icon: Icon, label, value, sub, accent }) { return <div className={cn('metric-card', `metric-${accent}`)}><div className="metric-icon"><Icon size={17} /></div><span>{label}</span><strong>{value}</strong><small>{sub}</small></div>; }
function Converter({ file, setFile, result, busy, notice, convert, upload, navigate }) { const [format, setFormat] = useState('mp3'); const [quality, setQuality] = useState('192'); return <><div className="converter-topline"><div className="credits-card"><span>AVAILABLE CREDITS</span><strong>0 <small>CREDITS</small></strong><button onClick={() => navigate('settings')}>Buy Credits <ArrowUpRight size={13} /></button></div><div className="plan-card"><div><span>PLAN STATUS</span><strong>Free plan</strong></div><div className="plan-progress"><i></i></div><small>0 / 5 free uses</small></div></div><div className="converter-layout"><section className="panel converter-panel"><div className="panel-heading"><div><span className="eyebrow">STEP 01 · IMPORT</span><h2>Bring your audio to life</h2></div><span className="safe-badge"><LockKeyhole size={12} /> PRIVATE</span></div><FileDrop file={file} setFile={setFile} /><div className="youtube-import"><div className="import-title"><Youtube size={17} /><div><strong>Import from YouTube</strong><small>Only use content you have permission to use.</small></div></div><div className="youtube-row"><input placeholder="YouTube URL" /><button className="secondary-button" onClick={() => navigate('youtube')}>Import Audio <Link2 size={14} /></button></div></div></section><section className="panel settings-panel"><div className="panel-heading"><div><span className="eyebrow">STEP 02 · OPTIMIZE</span><h2>Output settings</h2></div><WandSparkles size={18} color="#c8f76e" /></div><label className="field-label">OUTPUT FORMAT<select value={format} onChange={(event) => setFormat(event.target.value)}><option value="mp3">MP3</option><option value="wav">WAV</option><option value="ogg">OGG</option></select></label><div className="field-label">AUDIO QUALITY<div className="quality-options">{['128', '192', '320'].map((item) => <button key={item} className={cn(quality === item && 'selected')} onClick={() => setQuality(item)}>{item} <small>kbps</small></button>)}</div></div><div className="settings-foot"><span><Check size={14} /> 48 kHz stereo</span><span>Roblox optimized</span></div><button className="convert-button" disabled={!file || busy} onClick={() => convert(format, quality)}>{busy ? <RefreshCw className="spin" size={17} /> : <Zap size={17} />} {busy ? 'Converting audio...' : 'Convert Audio'} <ArrowUpRight size={17} /></button></section></div>{notice && <div className={cn('notice-bar', notice.includes('failed') || notice.includes('Pilih') || notice.includes('terlebih') ? 'notice-error' : 'notice-success')}><Activity size={16} /> {notice}</div>}{result && <ResultCard result={result} upload={upload} />}</>; }
function FileDrop({ file, setFile }) { const onFile = (next) => isMediaFile(next) && setFile(next); return file ? <div className="file-preview"><div className="file-art"><FileAudio size={22} /></div><div><strong>{file.name}</strong><span>{formatBytes(file.size)} · {file.type || 'media'}</span></div><audio controls src={URL.createObjectURL(file)} /><button className="icon-action" onClick={() => setFile(null)}><X size={16} /></button></div> : <label className="drop-area" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); onFile(event.dataTransfer.files[0]); }}><input type="file" accept="audio/*,video/*" onChange={(event) => onFile(event.target.files[0])} /><div className="drop-icon"><Upload size={21} /></div><strong>Drop your music or video here</strong><span>Video akan otomatis diambil audionya</span><small>MP3 / WAV / OGG / FLAC / MP4 / MOV</small></label>; }
function ResultCard({ result, upload, robloxApi }) { const [copied, setCopied] = useState(false); const copy = () => { if (result.assetId) navigator.clipboard.writeText(String(result.assetId)); setCopied(true); setTimeout(() => setCopied(false), 1300); }; return <section className="panel result-panel"><div className="panel-heading"><div><span className="eyebrow">STEP 03 · COMPLETE</span><h2>Conversion Complete</h2></div><span className="success-label"><Check size={13} /> READY</span></div><div className="result-file"><div className="file-art"><Music2 size={21} /></div><div><strong>{result.name}</strong><span>{(result.format || '').toUpperCase()} · {formatBytes(result.size)}</span></div><audio controls src={result.downloadUrl} /></div><div className="result-actions"><a className="download-button" href={result.downloadUrl} download><ArrowDownToLine size={16} /> Download Audio</a>{robloxApi.connected ? <button className="roblox-button" onClick={upload}><CloudUpload size={16} /> Upload to Roblox</button> : <button className="roblox-button" onClick={() => window.location.hash = '#/roblox-api'}>Connect Roblox API</button>}{result.assetId && <><button className="secondary-button" onClick={copy}>{copied ? <Check size={15} /> : <Copy size={15} />} {copied ? 'Copied' : 'Copy Asset ID'}</button><a className="secondary-button" href={`https://create.roblox.com/dashboard/creations/store/${result.assetId}/overview`} target="_blank" rel="noreferrer">Open Asset <ArrowUpRight size={14} /></a></>}</div></section>; }
function YoutubePage({ navigate }) { const [url, setUrl] = useState(''); const [message, setMessage] = useState(''); const validate = async () => { const res = await fetch('/api/youtube/validate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) }); const data = await res.json(); setMessage(data.message || data.error); }; return <section className="panel standalone-panel youtube-page"><div className="youtube-hero"><div className="youtube-large-icon"><Youtube size={32} /></div><div><span className="eyebrow">RIGHTS-AWARE IMPORT</span><h2>Bring a permitted source into your workflow.</h2><p>We validate YouTube links only. This app never downloads DRM-protected or restricted content. Upload an audio file you are licensed to use.</p></div></div><div className="large-input-row"><input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://www.youtube.com/watch?v=..." /><button className="primary-button" onClick={validate}>Validate URL <Check size={16} /></button></div>{message && <div className="notice-bar notice-success"><Check size={16} /> {message}</div>}<button className="text-button back-button" onClick={() => navigate('converter')}>← Back to converter</button></section>; }
function Uploader({ session, setSession }) { return <section className="panel standalone-panel uploader-page"><div className="uploader-icon"><CloudUpload size={28} /></div><span className="eyebrow">ROBLOX OPEN CLOUD</span><h2>Upload directly to Roblox</h2><p>Use your own Open Cloud API key. This app never asks for Roblox password, cookie, or .ROBLOSECURITY.</p><div className="notice-bar notice-success"><Check size={16} /> API-key based upload is enabled.</div><button className="primary-button" onClick={() => window.location.hash = '#/roblox-api'}>Connect Roblox API <ArrowUpRight size={16} /></button><div className="upload-steps"><Step number="01" label="Connect API" /><Step number="02" label="Upload audio" /><Step number="03" label="Moderation" /></div></section>; }
function Step({ number, label }) { return <div><span>{number}</span><strong>{label}</strong></div>; }
function LibraryPage({ history, navigate }) { const [query, setQuery] = useState(''); const [filter, setFilter] = useState('All'); const [items, setItems] = useState(history); const [notice, setNotice] = useState(''); const visible = items.filter((item) => item.name.toLowerCase().includes(query.toLowerCase()) && (filter === 'All' || item.status === filter.toUpperCase())); const openAsset = (item) => { if (!item.id || item.id === '—') return setNotice('Asset Roblox belum tersedia.'); window.open(`https://create.roblox.com/dashboard/creations/store/${item.id}/overview`, '_blank', 'noopener,noreferrer'); }; const copyId = async (item) => { if (!item.id || item.id === '—') return setNotice('Asset ID belum tersedia.'); await navigator.clipboard.writeText(String(item.id)); setNotice(`Asset ID ${item.id} berhasil disalin.`); }; const removeItem = (item) => { if (window.confirm(`Hapus ${item.name} dari tampilan library?`)) { setItems((current) => current.filter((entry) => entry !== item)); setNotice('Audio dihapus dari tampilan library.'); } }; return <section className="panel standalone-panel library-panel"><div className="panel-title"><div><span className="eyebrow">YOUR ASSETS</span><h2>Audio Library</h2></div><button className="secondary-button" onClick={() => navigate('converter')}><Plus size={15} /> Add audio</button></div><div className="library-toolbar"><label className="search-box"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search audio files..." /></label><div className="filter-tabs">{['All', 'Uploaded', 'Processing', 'Failed'].map((item) => <button type="button" key={item} className={filter === item ? 'filter-active' : ''} onClick={() => setFilter(item)}>{item}</button>)}</div></div>{notice && <div className="notice-bar notice-success">{notice}</div>}<div className="table-wrap"><table><thead><tr><th>Name</th><th>Format</th><th>Duration</th><th>Size</th><th>Roblox ID</th><th>Status</th><th>Date</th><th>Action</th></tr></thead><tbody>{visible.map((item) => <tr key={`${item.name}-${item.date}`}><td><FileAudio size={15} /> {item.name}</td><td>{item.format}</td><td>{item.duration}</td><td>—</td><td className="asset-id">{item.id}</td><td><Status status={item.status} /></td><td>{item.date}</td><td><div className="row-actions"><button type="button" title="Open asset" aria-label="Open asset" onClick={() => openAsset(item)}><Play size={14} /></button><button type="button" title="Copy ID" aria-label="Copy asset ID" onClick={() => copyId(item)}><Copy size={14} /></button><button type="button" title="Open Roblox asset" aria-label="Open Roblox asset" onClick={() => openAsset(item)}><Download size={14} /></button><button type="button" title="Remove from library" aria-label="Remove from library" onClick={() => removeItem(item)}><Trash2 size={14} /></button></div></td></tr>)}</tbody></table></div></section>; }
LibraryPage.defaultProps = { navigate: (page) => window.location.assign(`/${page}`) };
function HistoryPage({ history }) { return <section className="panel standalone-panel"><div className="panel-title"><div><span className="eyebrow">ACTIVITY LOG</span><h2>Upload History</h2></div><button className="secondary-button"><RefreshCw size={15} /> Refresh</button></div><div className="table-wrap"><table><thead><tr><th>Audio</th><th>Type</th><th>Format</th><th>Status</th><th>Asset ID</th><th>Date</th><th>Action</th></tr></thead><tbody>{history.map((item) => <tr key={`${item.name}-${item.date}`}><td><FileAudio size={15} /> {item.name}</td><td>Roblox audio</td><td>{item.format}</td><td><Status status={item.status} /></td><td className="asset-id">{item.id}</td><td>{item.date}</td><td><button className="icon-action"><MoreHorizontal size={16} /></button></td></tr>)}</tbody></table></div></section>; }
function HistoryRows({ history }) { return <div className="history-rows">{history.map((item) => <div className="history-row" key={`${item.name}-${item.date}`}><div className="mini-file"><FileAudio size={15} /></div><div><strong>{item.name}</strong><small>{item.format} · {item.duration}</small></div><Status status={item.status} /><button className="icon-action"><MoreHorizontal size={16} /></button></div>)}</div>; }
function Status({ status }) { return <span className={cn('status-badge', `status-${status.toLowerCase()}`)}><i></i>{status}</span>; }
function Profile({ session }) {
  const [editing, setEditing] = useState(false);
  const [profileUser, setProfileUser] = useState(null);
  const [name, setName] = useState(session.name || 'Rivalid');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' }).then((response) => response.ok ? response.json() : null).then((data) => { if (data?.user) { setProfileUser(data.user); setName(data.user.name || session.name || 'Rivalid'); } }).catch(() => {});
  }, [session.name]);
  const saveProfile = async () => {
    setError('');
    const response = await fetch('/api/profile', { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
    const data = await response.json();
    if (!response.ok) return setError(data.error || 'Profil gagal disimpan.');
    setProfileUser(data.user);
    setEditing(false);
    setMessage('Profil berhasil disimpan.');
  };
  const displayName = profileUser?.name || session.name || 'Rivalid';
  return <section className="profile-grid"><section className="panel profile-card"><div className="profile-avatar">{displayName.slice(0, 1).toUpperCase()}</div>{editing ? <input value={name} onChange={(event) => setName(event.target.value)} aria-label="Display name" /> : <h2>{displayName}</h2>}<p>Roblox audio creator</p><span className="profile-tag"><i></i> Active creator</span>{editing ? <div className="result-actions"><button className="primary-button" onClick={saveProfile}>Save</button><button className="secondary-button" onClick={() => setEditing(false)}>Cancel</button></div> : <button className="secondary-button" onClick={() => setEditing(true)}>Edit profile</button>}{error && <div className="notice-bar notice-error">{error}</div>}{message && <div className="notice-bar notice-success">{message}</div>}</section><section className="panel detail-panel"><span className="eyebrow">PROFILE DETAILS</span><h2>Your creator identity</h2>{[['Display name', displayName], ['Email', profileUser?.email || 'Email tidak tersedia'], ['Roblox account', session.connected ? 'Connected' : 'Not connected'], ['Member since', 'September 2026']].map(([label, value]) => <div className="detail-row" key={label}><span>{label}</span><strong>{value}</strong></div>)}<small className="muted-note">Email berasal dari akun Google dan tidak dapat diedit.</small></section></section>;
}
function WorkspaceSettingsPage({ session, setCredits, adminAccess }) {
  if (window.location.pathname === '/admin-payments' && !adminAccess) {
    return <section className="panel standalone-panel"><div className="panel-title"><div><span className="eyebrow">ACCESS DENIED</span><h2>Unauthorized</h2></div></div><div className="notice-bar notice-error">Hanya admin pembayaran yang dapat mengakses halaman ini.</div></section>;
  }
  if (window.location.pathname === '/admin-payments') return <AdminPaymentsPage />;
  return <section className="settings-grid"><section className="panel detail-panel"><span className="eyebrow">PREFERENCES</span><h2>Workspace settings</h2><Setting title="Email notifications" detail="Receive updates about moderation" checked /><Setting title="Auto normalize audio" detail="Optimize levels during conversion" checked /><Setting title="Compact history" detail="Show denser activity rows" /></section><section className="panel detail-panel"><span className="eyebrow">BILLING PLACEHOLDER</span><h2>Credits & plan</h2><div className="billing-box"><Zap size={20} color="#c8f76e" /><div><strong>0 Credits</strong><span>Free plan · 5 free uses</span></div></div><button className="primary-button" onClick={() => setCredits(0)}>Buy Credits <ArrowUpRight size={16} /></button><small className="muted-note">Payment gateway integration can be connected here. No fake payment is implemented.</small></section></section>;
}
function SettingsPage(props) { return window.location.pathname === '/remix' ? <RemixPage /> : <WorkspaceSettingsPage {...props} />; }
function Setting({ title, detail, checked }) { const [value, setValue] = useState(checked); return <label className="setting-row"><span><strong>{title}</strong><small>{detail}</small></span><button type="button" className={cn('toggle', value && 'toggle-on')} onClick={() => setValue(!value)}><i></i></button></label>; }

function UtilityPage({ title, icon: Icon, description, navigate }) { const [file, setFile] = useState(null); const [format, setFormat] = useState('mp3'); const [result, setResult] = useState(null); const [busy, setBusy] = useState(false); const isOptimizer = title === 'Audio Optimizer'; const process = async () => { if (!file) return; setBusy(true); setResult(null); const form = new FormData(); form.append('audio', file); if (!isOptimizer) form.append('format', format); try { const response = await fetch(isOptimizer ? '/api/optimize' : '/api/convert', { method: 'POST', body: form }); const data = await response.json(); if (!response.ok) throw new Error(data.error); setResult(data); } catch (error) { setResult({ error: error.message }); } finally { setBusy(false); } }; return <section className="panel standalone-panel utility-page"><div className="uploader-icon"><Icon size={28} /></div><span className="eyebrow">RIVAL DEV TOOL</span><h2>{title}</h2><p>{description}</p><label className="drop-area utility-drop"><input type="file" accept="audio/*" onChange={(event) => { setFile(event.target.files[0]); setResult(null); }} /><div className="drop-icon"><Upload size={21} /></div><strong>{file?.name || 'Choose an audio file'}</strong><span>Audio up to 100 MB</span></label>{!isOptimizer && <label className="field-label">OUTPUT FORMAT<select value={format} onChange={(event) => setFormat(event.target.value)}><option value="mp3">MP3</option><option value="wav">WAV</option><option value="ogg">OGG</option></select></label>}<button className="primary-button" disabled={!file || busy} onClick={process}>{busy ? 'Processing...' : isOptimizer ? 'Optimize Audio' : 'Convert File'} <ArrowUpRight size={16} /></button>{result?.error && <div className="notice-bar notice-error">{result.error}</div>}{result?.downloadUrl && <div className="result-actions"><a className="download-button" href={result.downloadUrl} download={result.name}><Download size={16} /> Download Result</a><audio controls src={result.downloadUrl} /></div>}<div className="tool-note"><ShieldCheck size={16} /> Processing remains on your configured backend.</div></section>; }
function ApiStatusCard({ label = 'API STATUS' }) { return <div className="api-status-card"><div><span>{label}</span><strong><i></i> ACTIVE</strong></div><Activity size={22} color="#c8f76e" /></div>; }
function B2bApi({ navigate }) { return <><div className="api-grid"><ApiStatusCard label="B2B API STATUS" /><Metric icon={Zap} label="API credits" value="0" sub="Top up when billing is connected" accent="lime" /><Metric icon={Activity} label="Requests this month" value="0" sub="No requests yet" accent="blue" /></div><section className="panel api-panel"><div className="panel-title"><div><span className="eyebrow">B2B API</span><h2>Scale your audio workflow</h2></div><button className="secondary-button" onClick={() => navigate('api-docs')}><BookOpen size={15} /> API Documentation</button></div><ApiCredential /><UsageBars /><CodeExamples /></section></>; }
function DeveloperApi({ navigate }) { return <section className="panel api-panel"><div className="panel-title"><div><span className="eyebrow">DEVELOPER API</span><h2>Keys, credits, and usage</h2></div><button className="secondary-button" onClick={() => navigate('api-docs')}><BookOpen size={15} /> Documentation</button></div><ApiStatusCard /><ApiCredential /><div className="developer-api-grid"><Metric icon={Zap} label="API credits" value="0" sub="Ready for top up" accent="lime" /><Metric icon={Activity} label="Requests" value="0" sub="Last 30 days" accent="blue" /></div><UsageBars /></section>; }
function ApiCredential() { const [revealed, setRevealed] = useState(false); return <div className="api-credential"><div><span>SECRET API KEY</span><strong>{revealed ? 'rival_live_configure_on_server' : '••••••••••••••••••••••••'}</strong></div><div><button className="secondary-button" onClick={() => setRevealed(!revealed)}>{revealed ? 'Hide' : 'Reveal'}</button><button className="secondary-button">Regenerate</button></div></div>; }

function RobloxApiPage({ robloxApi, setRobloxApi }) {
  const [apiKey, setApiKey] = useState('');
  const [creatorType, setCreatorType] = useState('user');
  const [creatorId, setCreatorId] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const refreshStatus = async () => {
    const response = await fetch('/api/roblox-api/session', { credentials: 'include' });
    const data = await response.json();
    if (data.connected) setRobloxApi({ connected: true, creatorType: data.creatorType || 'user', creatorId: data.creatorId || data.userId || '—', userId: data.userId || '—', creator: data.creator || 'Creator', permissions: data.permissions || ['Permission checked by Roblox on upload'], apiStatus: data.apiStatus || 'READY_FOR_UPLOAD_CHECK' });
    else setRobloxApi({ connected: false, userId: '—', creator: 'Creator', permissions: ['Not connected'], apiStatus: 'NOT CONNECTED' });
  };

  const connectApi = async () => {
    if (!apiKey.trim()) { setError('Paste your Roblox API Key'); return; }
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch('/api/roblox-api/connect', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey, creatorType, creatorId })
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || 'Invalid Roblox API Key');
      setRobloxApi({ connected: true, creatorType: data.creatorType || creatorType, creatorId: data.creatorId || creatorId, userId: data.userId || '—', creator: data.creator || 'Creator', permissions: data.permissions || ['Permission checked by Roblox on upload'], apiStatus: data.apiStatus || 'READY_FOR_UPLOAD_CHECK' });
      setMessage(data.message || 'Connected');
      setApiKey('');
      setCreatorId('');
    } catch (err) {
      setError(err.message || 'Invalid Roblox API Key');
    } finally {
      setBusy(false);
    }
  };

  const testConnection = async () => {
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch('/api/roblox-api/test', { method: 'POST', credentials: 'include' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Invalid Roblox API Key');
      setRobloxApi({ connected: true, creatorType: data.creatorType || 'user', creatorId: data.creatorId || data.userId || '—', userId: data.userId || '—', creator: data.creator || 'Creator', permissions: data.permissions || ['Permission checked by Roblox on upload'], apiStatus: data.apiStatus || 'READY_FOR_UPLOAD_CHECK' });
      setMessage(data.message || 'Connected');
    } catch (err) {
      setError(err.message || 'Invalid Roblox API Key');
    } finally {
      setBusy(false);
    }
  };

  const removeApi = async () => {
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch('/api/roblox-api/remove', { method: 'DELETE', credentials: 'include' });
      if (!response.ok) throw new Error('Failed to remove API key');
      setRobloxApi({ connected: false, userId: '—', creator: 'Creator', permissions: ['Not connected'], apiStatus: 'NOT CONNECTED' });
      setMessage('API key removed');
    } catch (err) {
      setError(err.message || 'Unable to remove API key');
    } finally {
      setBusy(false);
    }
  };

  return <section className="panel standalone-panel" style={{ maxWidth: 820, margin: '0 auto' }}>
    <div className="panel-heading"><div><span className="eyebrow">ROBLOX API</span><h2>Connect Roblox API</h2></div><span className="success-label"><Check size={13} /> {robloxApi.connected ? 'CONNECTED' : 'NOT CONNECTED'}</span></div>
    <div className="api-credential" style={{ marginBottom: 16 }}>
      <div><span>STATUS</span><strong>{robloxApi.connected ? '● Connected' : '● NOT CONNECTED'}</strong></div>
    </div>
    <p style={{ color: '#d7dce5', marginBottom: 20 }}>Connect your Roblox account using your own Roblox Open Cloud API Key.</p>
    <div className="detail-panel" style={{ padding: 18, borderRadius: 14, marginBottom: 20 }}>
      <div className="panel-title"><div><span className="eyebrow">PANDUAN LENGKAP</span><h3 style={{ margin: '8px 0 0' }}>Cara menghubungkan Roblox API</h3></div><KeyRound size={21} color="#c8f76e" /></div>
      <ol style={{ margin: '16px 0 0', paddingLeft: 22, color: '#d7dce5', lineHeight: 1.8 }}>
        <li>Buka <a href="https://create.roblox.com/credentials" target="_blank" rel="noreferrer" style={{ color: '#c8f76e' }}>Roblox Creator Dashboard → Credentials</a>. Pastikan login dengan akun pemilik game.</li>
        <li>Pilih tab <strong>Open Cloud</strong> atau <strong>API Keys</strong>, lalu klik <strong>Create API Key</strong>.</li>
        <li>Pada nama key, isi <strong>Rival Audio Converter</strong>. Jangan gunakan key milik orang lain.</li>
        <li>Pada <strong>Resources</strong>, pilih universe/game yang benar. Ini harus game tempat audio akan disimpan.</li>
        <li>Pada <strong>Permissions</strong>, aktifkan <strong>Assets → Read</strong> dan <strong>Assets → Write</strong>. Tanpa <strong>Write</strong>, upload pasti ditolak.</li>
        <li>Klik <strong>Save/Create</strong>, salin API key yang muncul, lalu tempel ke kolom API Key di bawah.</li>
        <li>Pilih target <strong>User</strong> untuk akun pribadi atau <strong>Community/Group</strong> untuk komunitas. Masukkan ID target dari URL Roblox, contoh: <strong>123456789</strong>.</li>
        <li>Centang ulang: game benar, permission Read + Write, dan ID angka benar. Baru klik <strong>Connect API</strong>.</li>
      </ol>
      <div className="notice-bar notice-success" style={{ marginTop: 16 }}><ShieldCheck size={16} /> API key tidak boleh dibagikan. Key disimpan terenkripsi dan tidak ditampilkan kembali.</div>
      <div className="notice-bar notice-error" style={{ marginTop: 10 }}><strong>Jika muncul "Izin ditolak":</strong> periksa resource experience, Assets → Write, dan ID target. Roblox tidak menyediakan pengecekan permission write umum sebelum operasi upload resmi.</div>
    </div>
    {!robloxApi.connected ? <>
      <label className="field-label" htmlFor="roblox-api-key">Paste your Roblox API Key</label>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', background: '#0f1720', border: '1px solid rgba(200,247,110,0.2)', borderRadius: 12, padding: '0 12px' }}>
        <input id="roblox-api-key" type={showKey ? 'text' : 'password'} value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="Paste your Roblox API Key" style={{ flex: 1, background: 'transparent', border: 'none', color: '#edf1ec', padding: '14px 0', outline: 'none' }} />
        <button type="button" className="secondary-button" onClick={() => setShowKey(!showKey)}>{showKey ? 'Hide' : 'Show'}</button>
      </div>
      <label className="field-label" htmlFor="roblox-creator-type" style={{ marginTop: 14 }}>UPLOAD TARGET</label>
      <select id="roblox-creator-type" value={creatorType} onChange={(event) => setCreatorType(event.target.value)}>
        <option value="user">Personal User / akun pribadi</option>
        <option value="group">Community / Group</option>
      </select>
      <label className="field-label" htmlFor="roblox-creator-id" style={{ marginTop: 14 }}>{creatorType === 'group' ? 'Community / Group ID' : 'Creator / User ID'}</label>
      <input id="roblox-creator-id" value={creatorId} onChange={(event) => setCreatorId(event.target.value)} placeholder="Contoh: 123456789" inputMode="numeric" />
      <small className="muted-note">API key harus memiliki akses Assets pada target yang dipilih.</small>
      <div className="result-actions" style={{ marginTop: 18 }}>
        <button className="primary-button" disabled={busy} onClick={connectApi}>{busy ? 'Connecting...' : 'Connect API'}</button>
      </div>
    </> : <>
      <div className="detail-panel" style={{ padding: 18, borderRadius: 16, background: 'rgba(16,25,20,0.9)', marginBottom: 16 }}>
        <div className="detail-row"><span>{robloxApi.creatorType === 'group' ? 'Community / Group ID' : 'Creator / User ID'}</span><strong>{robloxApi.creatorId || robloxApi.userId}</strong></div>
        <div className="detail-row"><span>Creator</span><strong>{robloxApi.creator}</strong></div>
        <div className="detail-row"><span>API Status</span><strong>{robloxApi.apiStatus}</strong></div>
        <div className="detail-row"><span>Asset Permission</span><strong>{robloxApi.permissions.join(', ')}</strong></div>
      </div>
      <div className="result-actions">
        <button className="secondary-button" onClick={testConnection}>Test Connection</button>
        <button className="secondary-button" onClick={removeApi}>Remove API Key</button>
      </div>
    </>}
    {error && <div className="notice-bar notice-error" style={{ marginTop: 16 }}>{error}</div>}
    {message && <div className="notice-bar notice-success" style={{ marginTop: 16 }}><Check size={16} /> {message}</div>}
  </section>;
}
function UsageBars() { return <div className="usage-block"><div className="usage-heading"><strong>Request statistics</strong><span>Last 30 days</span></div><div className="usage-row"><span>Conversion requests</span><i><b style={{ width: '18%' }}></b></i><strong>0</strong></div><div className="usage-row"><span>Roblox uploads</span><i><b style={{ width: '7%' }}></b></i><strong>0</strong></div><div className="usage-row"><span>Asset status checks</span><i><b style={{ width: '4%' }}></b></i><strong>0</strong></div></div>; }
function CodeExamples() { const examples = { JavaScript: `const response = await fetch('/api/audio/convert', {\n  method: 'POST',\n  body: audioFormData\n});`, Python: `requests.post(\n  '/api/audio/convert',\n  files={'audio': open('sound.mp3', 'rb')}\n)`, cURL: `curl -X POST /api/audio/convert \\\n  -F "audio=@sound.mp3"` }; const [tab, setTab] = useState('JavaScript'); return <div className="code-example"><div className="code-tabs">{Object.keys(examples).map((item) => <button key={item} className={tab === item ? 'code-active' : ''} onClick={() => setTab(item)}>{item}</button>)}</div><pre>{examples[tab]}</pre></div>; }
function ApiDocs() { const endpoints = [['POST', '/api/audio/convert', 'Convert and optimize an audio file'], ['POST', '/api/roblox/upload', 'Upload a converted asset using OAuth'], ['GET', '/api/audio/history', 'Read conversion and upload history'], ['GET', '/api/roblox/assets/:id', 'Check a Roblox asset status']]; return <section className="panel api-panel docs-panel"><div className="panel-title"><div><span className="eyebrow">REFERENCE</span><h2>API Documentation</h2></div><span className="rest-badge">REST API</span></div><p className="docs-intro">Use your server-side API key to connect Rival Dev to internal creator tools. Never expose secret keys in browser code.</p><div className="endpoint-list">{endpoints.map(([method, path, description]) => <div className="endpoint" key={path}><span className={cn('method', method.toLowerCase())}>{method}</span><code>{path}</code><span>{description}</span><ChevronRight size={15} /></div>)}</div><CodeExamples /></section>; }
function CreditsPage({ navigate }) { const packages = [['100 Credits', '$—', 'For trying the workflow'], ['500 Credits', '$—', 'For active creators'], ['1000 Credits', '$—', 'For small teams']]; return <><section className="panel credits-hero"><div><span className="eyebrow">CURRENT CREDITS</span><h2>0 <small>CREDITS</small></h2><p>Credits will be consumed by conversion workflows once billing is connected.</p></div><Zap size={39} color="#c8f76e" /></section><section className="panel package-panel"><div className="panel-title"><div><span className="eyebrow">CREDITS TOP UP</span><h2>Choose a package</h2></div><span className="muted-note">Payment gateway placeholder</span></div><div className="package-grid">{packages.map(([name, price, description]) => <div className="package-card" key={name}><Zap size={17} color="#c8f76e" /><strong>{name}</strong><b>{price}</b><p>{description}</p><button className="secondary-button" onClick={() => navigate('billing')}>Connect payment <ArrowUpRight size={14} /></button></div>)}</div></section></>; }
function BillingPage({ openPayment }) {
  const [plans, setPlans] = useState([]);
  useEffect(() => { fetch('/api/payments/plans').then((response) => response.ok ? response.json() : []).then(setPlans).catch(() => setPlans([])); }, []);
  return <section className="billing-page"><section className="panel billing-intro"><div><span className="eyebrow">RIVAL DEV PLANS</span><h2>Pilih plan kamu</h2><p>Lima pemakaian pertama gratis. Setelah itu credits dipakai otomatis setiap kali proses audio.</p></div><Zap size={32} color="#c8f76e" /></section><div className="plan-grid">{plans.map((plan) => <section className="plan-option" key={plan.id}><span className="plan-kicker">PLAN</span><h3>{plan.name}</h3><strong>{plan.price}</strong><p>{plan.detail}</p><small className="muted-note">{plan.credits} credits</small><button className="primary-button" onClick={() => openPayment(plan)}>Buy <ArrowUpRight size={16} /></button></section>)}</div></section>;
}
function PaymentHistory() {
  const [payments, setPayments] = useState([]);
  useEffect(() => {
    fetch('/api/payments', { credentials: 'include' })
      .then((response) => response.ok ? response.json() : [])
      .then((data) => setPayments(Array.isArray(data) ? data : []))
      .catch(() => setPayments([]));
  }, []);
  return <section className="panel standalone-panel"><div className="panel-title"><div><span className="eyebrow">ACCOUNT</span><h2>Payment History</h2></div><button className="secondary-button"><Download size={15} /> Export</button></div><div className="table-wrap"><table><thead><tr><th>Invoice</th><th>Package</th><th>Amount</th><th>Status</th><th>Date</th><th>Action</th></tr></thead><tbody>{payments.length ? payments.map((item) => <tr key={item.id}><td>{item.orderNumber}</td><td>{item.planName}</td><td>Rp{Number(item.amount || 0).toLocaleString('id-ID')}</td><td><Status status={item.status} /></td><td>{new Date(item.createdAt).toLocaleDateString('id-ID')}</td><td><a className="icon-action" href={`/api/chats/${item.id}`} target="_blank" rel="noreferrer" aria-label="Open order chat"><MessageCircle size={16} /></a></td></tr>) : <tr><td colSpan="6">Belum ada order pembayaran.</td></tr>}</tbody></table></div></section>;
}

function PaymentQrModal({ open, close, image, paymentTarget, plan, orderStatus, setPaymentOpen, createPaymentOrder, uploadProof, proofFile, setProofFile, chatRoom, chatInput, setChatInput, sendChat, loadChat }) {
  if (!open) return null;
  const currentPlan = plan || { name: 'Pilih plan', price: 'Nominal belum dipilih' };
  const statusLabel = orderStatus?.status === 'payment_uploaded' ? 'Menunggu verifikasi admin' : orderStatus?.status === 'approved' ? 'Pembayaran disetujui' : orderStatus?.status === 'rejected' ? 'Pembayaran ditolak' : 'Belum ada order';
  return <div className="payment-modal-backdrop" onClick={close}><section className="payment-modal payment-modal-modern" onClick={(event) => event.stopPropagation()}><header className="payment-header"><div><span className="eyebrow">SECURE MANUAL PAYMENT</span><h2>Checkout {currentPlan.name}</h2><p>Bayar manual, unggah bukti, lalu tunggu konfirmasi admin.</p></div><button className="icon-action" onClick={close} aria-label="Close payment"><X size={17} /></button></header><div className="payment-steps"><span className="payment-step-active"><b>01</b> Buat order</span><i></i><span className={orderStatus ? 'payment-step-active' : ''}><b>02</b> Transfer</span><i></i><span className={orderStatus?.status === 'payment_uploaded' || orderStatus?.status === 'approved' ? 'payment-step-active' : ''}><b>03</b> Verifikasi</span></div><div className="payment-summary"><div><span>PLAN DIPILIH</span><strong>{currentPlan.name}</strong></div><div><span>TOTAL</span><strong>{currentPlan.price}</strong></div><div><span>CREDITS</span><strong>{currentPlan.credits || '—'}</strong></div></div><div className="payment-grid"><section className="payment-method"><span className="eyebrow">CARA PEMBAYARAN</span><h3>Transfer manual</h3><p className="payment-instruction">{paymentTarget || 'Tujuan pembayaran belum diatur admin.'}</p>{image ? <div className="payment-qr-frame"><img src={image} alt={`QR pembayaran ${currentPlan.name}`} /></div> : <div className="notice-bar notice-error">QR pembayaran belum diatur admin.</div>}<small className="muted-note">Pastikan nominal transfer sesuai total order.</small></section><section className="payment-action"><span className="eyebrow">ORDER STATUS</span><div className="payment-status"><i></i><strong>{statusLabel}</strong>{orderStatus?.orderNumber && <small>{orderStatus.orderNumber}</small>}</div>{!orderStatus && <button className="primary-button payment-main-action" onClick={createPaymentOrder}>Buat nomor order <ArrowUpRight size={16} /></button>}{orderStatus && orderStatus.status !== 'approved' && <><label className="payment-upload-box"><Upload size={18} /><strong>{proofFile ? proofFile.name : 'Upload bukti pembayaran'}</strong><small>PNG, JPG, atau WEBP maksimal 5 MB</small><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => setProofFile(event.target.files[0] || null)} /></label><button className="primary-button payment-main-action" onClick={uploadProof} disabled={!proofFile}>Kirim bukti pembayaran <Check size={16} /></button></>}{orderStatus?.status === 'approved' && <div className="notice-bar notice-success"><Check size={16} /> Credits akan aktif di akun kamu.</div>}</section></div>{orderStatus && <div className="payment-order-note"><span>Nomor order</span><strong>{orderStatus.orderNumber}</strong><span>Status</span><Status status={orderStatus.status} /></div>}<button className="secondary-button payment-close-action" onClick={close}>Tutup</button></section></div>;
  /*
    return <div className="payment-modal-backdrop" onClick={close}><section className="payment-modal" onClick={(event) => event.stopPropagation()}><button className="icon-action" onClick={close} aria-label="Close payment"><X size={17} /></button><span className="eyebrow">PREMIUM PAYMENT</span><h2>{currentPlan.name}</h2><div className="payment-amount">{currentPlan.price}</div><p>Transfer ke tujuan berikut, lalu upload bukti pembayaran untuk validasi admin.</p><div className="detail-panel" style={{ padding: 16, borderRadius: 12, marginBottom: 12 }}><div className="detail-row"><span>Tujuan</span><strong>{paymentTarget || 'Tujuan pembayaran belum diatur admin.'}</strong></div><div className="detail-row"><span>Nomor Order</span><strong>{orderStatus?.orderNumber || 'Belum dibuat'}</strong></div></div>{image ? <img src={image} alt={`QR pembayaran ${currentPlan.name}`} /> : <div className="notice-bar notice-error">QR pembayaran belum diatur admin.</div>}<div style={{ marginTop: 14 }}><button className="primary-button" onClick={createPaymentOrder}>Buat Nomor Order</button></div>{orderStatus && <div style={{ marginTop: 18 }}><div className="detail-panel" style={{ padding: 16, borderRadius: 12 }}><div className="detail-row"><span>Status</span><strong>{orderStatus.status}</strong></div></div><label className="field-label">Upload Bukti Pembayaran<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => setProofFile(event.target.files[0])} /></label>{proofFile && <small className="muted-note">{proofFile.name}</small>}<button className="primary-button" onClick={uploadProof} style={{ marginTop: 10 }}>Kirim Bukti</button></div>}
  // Obsolete modal render retained below for reference.
  return <div className="payment-modal-backdrop" onClick={close}><section className="payment-modal" onClick={(event) => event.stopPropagation()}><button className="icon-action" onClick={close} aria-label="Close payment"><X size={17} /></button><span className="eyebrow">PREMIUM PAYMENT</span><h2>{currentPlan.name}</h2><div className="payment-amount">{currentPlan.price}</div><p>Transfer ke rekening berikut, lalu upload bukti pembayaran untuk validasi admin.</p><div className="detail-panel" style={{ padding: 16, borderRadius: 12, marginBottom: 12 }}><div className="detail-row"><span>Tujuan</span><strong>BCA 1234567890 a.n Rival Dev</strong></div><div className="detail-row"><span>Nomor Order</span><strong>{orderStatus?.orderNumber || 'Belum dibuat'}</strong></div></div><img src={image} alt={`QR pembayaran ${currentPlan.name}`} /><div style={{ marginTop: 14 }}><button className="primary-button" onClick={createPaymentOrder}>Buat Nomor Order</button></div>{orderStatus && <div style={{ marginTop: 18 }}><div className="detail-panel" style={{ padding: 16, borderRadius: 12 }}><div className="detail-row"><span>Status</span><strong>{orderStatus.status}</strong></div></div><label className="field-label">Upload Bukti Pembayaran<input type="file" accept="image/*" onChange={(event) => setProofFile(event.target.files[0])} /></label>{proofFile && <small className="muted-note">{proofFile.name}</small>}<button className="primary-button" onClick={uploadProof} style={{ marginTop: 10 }}>Kirim Bukti</button></div>}<div style={{ marginTop: 18, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.08)' }}><button className="secondary-button" onClick={close}>Close</button></div>{orderStatus && <div style={{ marginTop: 18 }}><div className="panel-title"><div><span className="eyebrow">CHAT ORDER</span><h2>{orderStatus.orderNumber}</h2></div></div><button className="secondary-button" onClick={() => loadChat(orderStatus.id)}>Refresh Chat</button><div className="detail-panel" style={{ padding: 12, borderRadius: 12, marginTop: 10, maxHeight: 180, overflow: 'auto' }}>{(chatRoom.messages || []).map((item, index) => <div key={`${item.sender}-${index}`} style={{ marginBottom: 8 }}><strong>{item.sender}</strong><div>{item.text}</div></div>)}</div><div style={{ display: 'flex', gap: 8, marginTop: 8 }}><input value={chatInput} onChange={(event) => setChatInput(event.target.value)} placeholder="Tulis pesan..." style={{ flex: 1, background: '#0f1720', border: '1px solid rgba(255,255,255,0.08)', color: 'white', padding: '10px 12px', borderRadius: 8 }} /><button className="primary-button" onClick={sendChat}>Kirim</button></div></div>}</section></div>;
}

  */
}

function App() {
  const location = useLocation();
  const routerNavigate = useNavigate();
  const page = location.pathname.slice(1) || 'dashboard';
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [language, setLanguage] = useState('id');
  const [session] = useState({ connected: false, name: 'Rivalid', userId: '—' });
  const [credits, setCredits] = useState(0);
  const [history, setHistory] = useState(recentUploads);
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [authUser, setAuthUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [adminAccess, setAdminAccess] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentConfig, setPaymentConfig] = useState({ paymentTarget: '', qrUrl: null });
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [orderStatus, setOrderStatus] = useState(null);
  const [chatRoom, setChatRoom] = useState({ orderId: '', messages: [] });
  const [chatInput, setChatInput] = useState('');
  const [proofFile, setProofFile] = useState(null);
  const [online, setOnline] = useState(0);
  const [robloxApi, setRobloxApi] = useState({ connected: false, userId: '—', creator: 'Creator', permissions: ['Not connected'], apiStatus: 'NOT CONNECTED' });
  const visitorIdRef = useRef(crypto.randomUUID());

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' }).then((response) => response.ok ? response.json() : null).then((data) => setAuthUser(data?.user || null)).catch(() => setAuthUser(null)).finally(() => setAuthLoading(false));
    fetch('/api/admin/status', { credentials: 'include' }).then((response) => response.ok ? response.json() : null).then((data) => setAdminAccess(Boolean(data?.isAdmin))).catch(() => setAdminAccess(false));
    fetch('/api/payments/config').then((response) => response.ok ? response.json() : null).then((data) => data && setPaymentConfig(data)).catch(() => {});
    fetch('/api/credits', { credentials: 'include' }).then((response) => response.ok ? response.json() : null).then((data) => data && !data.unlimited && setCredits(Number(data.credits || 0))).catch(() => {});
    fetch('/api/session', { credentials: 'include' }).then((response) => response.ok ? response.json() : null).then((data) => data?.history && setHistory(data.history.map((item) => ({ name: item.name, format: 'Audio', duration: '—', status: item.status === 'Uploaded' ? 'SUCCESS' : 'PROCESSING', id: item.id || '—', date: new Date(item.createdAt).toLocaleDateString() })))).catch(() => {});
  }, []);

  useEffect(() => {
    const sendPresence = () => fetch('/api/presence', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ visitorId: visitorIdRef.current }) }).then((response) => response.ok ? response.json() : null).then((data) => data?.online !== undefined && setOnline(data.online)).catch(() => {});
    sendPresence();
    const timer = window.setInterval(sendPresence, 20000);
    return () => window.clearInterval(timer);
  }, []);

  const navigate = (next) => { routerNavigate(`/${next}`); setSidebarOpen(false); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const openPayment = (plan = null) => { setSelectedPlan(plan); setPaymentOpen(true); };
  const createPaymentOrder = async () => {
    if (!selectedPlan) return;
    const response = await fetch('/api/payments/create', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ planId: selectedPlan.id }) });
    const data = await response.json();
    if (!response.ok) return setNotice(data.error || 'Gagal membuat order pembayaran.');
    setOrderStatus(data);
  };
  const convert = async (format, quality) => {
    if (!file) return setNotice('Pilih file musik atau video terlebih dahulu.');
    setBusy(true); setNotice('Converting audio...');
    const form = new FormData(); form.append('audio', file); form.append('format', format); form.append('quality', quality);
    try {
      const response = await fetch('/api/convert', { method: 'POST', credentials: 'include', body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Conversion failed.');
      setResult(data); setNotice('Conversion Complete');
    } catch (error) { setNotice(error.message || 'Conversion failed.'); } finally { setBusy(false); }
  };
  const upload = async () => {
    if (!result?.downloadUrl) return setNotice('Convert audio dahulu.');
    if (!robloxApi.connected) return setNotice('Connect Roblox API terlebih dahulu.');
    setBusy(true); setNotice('Uploading to Roblox...');
    try {
      const blob = await fetch(result.downloadUrl, { credentials: 'include' }).then((response) => response.blob());
      const form = new FormData(); form.append('audio', blob, result.name); form.append('displayName', result.name.replace(/\.[^.]+$/, ''));
      const response = await fetch('/api/roblox/upload-audio', { method: 'POST', credentials: 'include', body: form });
      const data = await response.json();
      if (!response.ok || data.success !== true) throw new Error(data.error || 'Upload ke Roblox gagal.');
      setResult((current) => ({ ...current, assetId: data.assetId }));
      setHistory((items) => [{ name: result.name, format: result.format.toUpperCase(), duration: '—', status: 'PROCESSING', id: data.assetId, date: 'Just now' }, ...items]);
      setNotice(`Upload Successful · Asset ID ${data.assetId}`);
    } catch (error) { setNotice(error.message || 'Upload failed.'); } finally { setBusy(false); }
  };
  const uploadProof = async () => {
    if (!orderStatus || !proofFile) return setNotice('Upload bukti transfer terlebih dahulu.');
    const form = new FormData(); form.append('proof', proofFile);
    const response = await fetch(`/api/payments/${orderStatus.id}/proof`, { method: 'POST', credentials: 'include', body: form });
    const data = await response.json();
    if (!response.ok) return setNotice(data.error || 'Gagal upload bukti.');
    setOrderStatus(data.order); setProofFile(null); setNotice('Bukti pembayaran berhasil dikirim.');
  };
  if (authLoading) return <div className="auth-loading"><div className="auth-spinner"></div><span>Preparing your workspace...</span></div>;
  if (!authUser) return <LoginScreen />;
  return <div className="app-frame"><Sidebar page={page} navigate={navigate} open={sidebarOpen} collapsed={sidebarCollapsed} setCollapsed={setSidebarCollapsed} isAdmin={adminAccess} language={language} setLanguage={setLanguage} /><div className={cn('main-column', sidebarCollapsed && 'main-expanded')}><Topbar session={{ ...session, name: authUser.name }} credits={credits} setSidebarOpen={setSidebarOpen} navigate={navigate} online={online} openPayment={() => openPayment()} language={language} setLanguage={setLanguage} /><main className="page-content"><WorkspacePageHeader page={page} online={online} language={language} /><PageView page={page} navigate={navigate} file={file} setFile={setFile} result={result} setResult={setResult} busy={busy} setBusy={setBusy} notice={notice} setNotice={setNotice} history={history} setHistory={setHistory} convert={convert} upload={upload} session={session} credits={credits} setCredits={setCredits} openPayment={openPayment} robloxApi={robloxApi} setRobloxApi={setRobloxApi} adminAccess={adminAccess} /></main></div><PaymentQrModal open={paymentOpen} close={() => setPaymentOpen(false)} image={paymentConfig.qrUrl} paymentTarget={paymentConfig.paymentTarget} plan={selectedPlan} orderStatus={orderStatus} createPaymentOrder={createPaymentOrder} uploadProof={uploadProof} proofFile={proofFile} setProofFile={setProofFile} chatRoom={chatRoom} chatInput={chatInput} setChatInput={setChatInput} sendChat={() => {}} loadChat={() => {}} /></div>;
}

function LoginScreen() { const [configured, setConfigured] = useState(null); useEffect(() => { fetch('/api/auth/config').then((response) => response.json()).then((data) => setConfigured(data.googleConfigured)).catch(() => setConfigured(false)); }, []); return <main className="login-screen"><div className="login-grid"></div><section className="login-card"><div className="login-brand"><span className="brand-icon"><Zap size={18} fill="currentColor" /></span><span><strong>RIVAL DEV</strong><small>CREATOR SUITE</small></span></div><div className="login-icon"><Music2 size={23} /></div><span className="eyebrow">AUDIO WORKSPACE</span><h1>Make your sound<br /><em>stand out.</em></h1><p>Sign in to convert, organize, and publish audio for your Roblox experiences.</p><button className="google-button" onClick={() => { window.location.href = '/auth/google'; }}><span>G</span>{configured === false ? 'Configure Google OAuth' : 'Continue with Google'}<ArrowUpRight size={16} /></button></section></main>; }
function Sidebar({ page, navigate, open, collapsed, setCollapsed, isAdmin, language, setLanguage }) { const labels = languageLabels[language] || languageLabels.id; return <aside className={cn('sidebar-shell', open && 'sidebar-open', collapsed && 'sidebar-collapsed')}><div className="sidebar-brand"><span className="brand-icon"><Zap size={17} fill="currentColor" /></span><div><strong>RIVAL DEV</strong><small>CREATOR SUITE</small></div></div><div className="sidebar-scroll">{getNavGroups(language).map((group) => <div className="nav-group" key={group.label}><span className="nav-group-label">{group.label}</span>{group.items.filter(([, id]) => id !== 'admin-payments' || isAdmin).map(([label, id, Icon]) => <button title={collapsed ? label : undefined} key={id} className={cn('nav-item', page === id && 'nav-item-active')} onClick={() => navigate(id)}><Icon size={16} /><span>{label}</span></button>)}</div>)}</div><div className="sidebar-language-switch"><button className={language === 'id' ? 'active' : ''} onClick={() => setLanguage('id')}>ID</button><button className={language === 'en' ? 'active' : ''} onClick={() => setLanguage('en')}>EN</button></div><div className="sidebar-footer"><span><CircleHelp size={14} /> {labels.helpCenter}</span><span>v1.0.0</span></div><button className="collapse-button" onClick={() => setCollapsed(!collapsed)}><ChevronRight size={15} /><span>{collapsed ? labels.expandSidebar : labels.collapseSidebar}</span></button></aside>; }
function Topbar({ session, credits, setSidebarOpen, navigate, online, openPayment, language, setLanguage }) { const labels = languageLabels[language] || languageLabels.id; return <header className="topbar"><button className="mobile-menu" onClick={() => setSidebarOpen(true)}><Menu size={19} /></button><div className="topbar-greeting"><span>{labels.greeting} /</span><strong>{session.name}</strong><small>{online} {labels.online}</small></div><div className="topbar-actions"><div className="credit-pill"><Zap size={14} fill="currentColor" /><span>{credits} credits</span><button onClick={openPayment}>{labels.buy}</button></div><div className="language-switch"><button className={language === 'id' ? 'active' : ''} onClick={() => setLanguage('id')}>ID</button><button className={language === 'en' ? 'active' : ''} onClick={() => setLanguage('en')}>EN</button></div><button className="avatar-button" onClick={() => navigate('profile')}><span>R</span><strong>Rivalid</strong></button></div></header>; }
function WorkspacePageHeader({ page, language, online }) { const labels = languageLabels[language] || languageLabels.id; const title = page === 'dashboard' ? labels.dashboard : page === 'billing' ? 'Billing' : page === 'remix' ? labels.remixMusic : page === 'converter' ? labels.audioConverter : page === 'admin-payments' ? labels.adminPayments : page; return <div className="page-header"><div><div className="breadcrumb">RIVAL DEV <ChevronRight size={13} /> {String(title).toUpperCase()}</div><h1>{title}</h1><p>{language === 'id' ? 'Kelola workspace audio kamu.' : 'Manage your audio workspace.'}</p></div><div className="header-date"><Activity size={15} /> {online} {labels.online}</div></div>; }

function AdminPaymentsPage() {
  const [orders, setOrders] = useState([]);
  const [notice, setNotice] = useState('');
  const loadOrders = async () => {
    const response = await fetch('/api/admin/payments', { credentials: 'include' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Akses admin ditolak.');
    setOrders(data);
  };
  useEffect(() => { loadOrders().catch((error) => setNotice(error.message)); }, []);
  const updateOrder = async (order, status) => {
    const response = await fetch(`/api/payments/${order.id}/status`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status, adminNotes: status === 'approved' ? 'Pembayaran diterima admin.' : 'Pembayaran ditolak admin.' }) });
    const data = await response.json();
    if (!response.ok) return setNotice(data.error || 'Status gagal diubah.');
    setOrders((items) => items.map((item) => item.id === order.id ? data.order : item));
  };
  return <section className="panel standalone-panel"><div className="panel-title"><div><span className="eyebrow">ADMIN ONLY</span><h2>Payment Orders</h2></div><button className="secondary-button" onClick={() => loadOrders().catch((error) => setNotice(error.message))}><RefreshCw size={15} /> Refresh</button></div>{notice && <div className="notice-bar notice-error">{notice}</div>}<div className="table-wrap"><table><thead><tr><th>Order</th><th>Customer</th><th>Plan</th><th>Amount</th><th>Status</th><th>Proof</th><th>Action</th></tr></thead><tbody>{orders.length ? orders.map((order) => <tr key={order.id}><td>{order.orderNumber}</td><td>{order.customerEmail}</td><td>{order.planName}</td><td>Rp{Number(order.amount || 0).toLocaleString('id-ID')}</td><td><Status status={order.status} /></td><td>{order.proofUrl ? <a className="text-button" href={order.proofUrl} target="_blank" rel="noreferrer">View</a> : '—'}</td><td><div className="result-actions"><button className="primary-button" disabled={order.status === 'approved'} onClick={() => updateOrder(order, 'approved')}><Check size={14} /> Approve</button><button className="secondary-button" disabled={order.status === 'rejected'} onClick={() => updateOrder(order, 'rejected')}><X size={14} /> Reject</button></div></td></tr>) : <tr><td colSpan="7">Belum ada order pembayaran.</td></tr>}</tbody></table></div></section>;
}

function PageHeader({ page, online }) { return <WorkspacePageHeader page={page} online={online} language="id" />; }

export default App;
