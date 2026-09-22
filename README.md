# Rival Dev Audio Suite

Premium React + Vite dashboard untuk mengonversi audio dan mengunggah asset ke Roblox Open Cloud melalui backend Express. Frontend dan API dipisahkan: React berjalan di `client/`, sementara token Roblox dan FFmpeg tetap di server.

## Prasyarat

- Node.js 18 atau lebih baru
- FFmpeg terpasang dan tersedia di `PATH`
- Roblox OAuth app dan creator/user yang memiliki izin upload audio

## Install dan jalankan

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

Buka frontend Vite di `http://localhost:5173`. API berjalan di `http://localhost:3000`. Pada development, set `PUBLIC_BASE_URL=http://localhost:5173` agar callback login kembali ke frontend Vite.

Untuk production build:

```powershell
npm run build
npm start
```

Express akan menyajikan `client/dist` setelah build.

## Halaman frontend

Dashboard, Audio Converter, YouTube Audio, Roblox Uploader, Audio Library, Upload History, Profile, dan Settings tersedia dari sidebar tanpa mock navigation terpisah.

Database persistence schema tersedia di `database/schema.sql` untuk users, credits, audio files, conversions, Roblox assets, upload history, API keys, dan transactions. Payment dan API key flows sengaja tidak membuat data palsu; hubungkan provider/database production sebelum mengaktifkannya.

## Konfigurasi `.env`

Isi `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, dan `GOOGLE_REDIRECT_URI` untuk login awal. Buat OAuth Client ID bertipe Web application di Google Cloud Console, lalu daftarkan redirect URI yang sama, misalnya `http://localhost:3000/auth/google/callback`.

Isi juga `ROBLOX_CLIENT_ID`, `ROBLOX_CLIENT_SECRET`, dan `ROBLOX_REDIRECT_URI` untuk upload Roblox. Creator ID tidak ada di `.env`: backend selalu mengambilnya dari profil Roblox yang sedang login. `SESSION_SECRET` disediakan untuk konfigurasi deployment; token OAuth disimpan hanya di memory server pada contoh ini dan tidak pernah dikirim ke frontend.

## Alur Roblox

1. Klik **Login with Roblox** di halaman Uploader. Aplikasi membuka popup ke OAuth Roblox resmi.
2. Selesaikan OAuth dan berikan scope `openid profile asset:read asset:write`.
3. Backend memvalidasi state + PKCE, menukar authorization code, mengambil userinfo, lalu menyimpan access/refresh token hanya di memory server.
4. Konversi audio lokal ke MP3, WAV, atau OGG.
5. Klik **Upload to Roblox**. Server memanggil `https://apis.roblox.com/assets/v1/assets` dengan token user yang sedang login.
6. Creator ID diambil dari `userinfo.sub`; tidak ada `ROBLOX_CREATOR_USER_ID` dan tidak ada akun developer bersama.

Endpoint Roblox:

- `GET /auth/roblox`
- `GET /auth/roblox/callback`
- `GET /api/auth/roblox/me`
- `POST /api/auth/roblox/logout`
- `POST /api/roblox/upload-audio`

Tidak ada `ROBLOX_CREATOR_USER_ID` dan tidak ada endpoint upload yang memakai token developer. Endpoint upload hanya menerima cookie session Roblox user yang sedang login.

Untuk production, gunakan HTTPS, session store persisten yang terenkripsi, CSRF protection, rate limiting, dan secret manager. Jangan commit `.env`.

## YouTube

URL YouTube hanya divalidasi dan tidak diunduh oleh aplikasi. Pengguna harus mengunggah file audio yang memang mereka miliki hak untuk digunakan, sehingga aplikasi tidak membypass pembatasan atau DRM.

## Pemeriksaan

```powershell
npm run check
```

`npm run check` memeriksa syntax server dan menjalankan production build frontend.
