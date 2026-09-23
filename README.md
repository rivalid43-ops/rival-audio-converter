# Rival Dev Audio Suite

Premium React + Vite dashboard untuk mengonversi audio dan mengunggah asset ke Roblox Open Cloud melalui backend Express. Frontend dan API dipisahkan: React berjalan di `client/`, sementara token Roblox dan FFmpeg tetap di server.

## Prasyarat

- Node.js 18 atau lebih baru
- FFmpeg terpasang dan tersedia di `PATH`
- Roblox Open Cloud API key dan Creator/User ID yang memiliki izin upload audio

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

Roblox memakai API key Open Cloud dari halaman Credentials. API key dikirim sekali ke backend melalui HTTPS, lalu disimpan terenkripsi hanya di memory server per session; session database hanya menyimpan reference acak. `ROBLOX_API_KEY_SECRET` wajib diatur di Railway Environment Variables dan tidak boleh masuk Git. Isi User ID atau Group ID yang sesuai saat menghubungkan key.

## Alur Roblox

1. Buka Roblox Creator Dashboard → Credentials → Open Cloud/API Keys.
2. Buat key baru dengan resource experience/game yang benar dan hanya permission Assets yang diperlukan endpoint resmi. Upload audio memerlukan `Assets: Write`; Read hanya diperlukan bila memakai endpoint status yang membutuhkan pembacaan asset.
3. Masukkan API key di halaman Roblox API, pilih target **Personal User** atau **Community/Group**, lalu masukkan ID target.
4. Konversi audio lokal ke MP3, WAV, atau OGG.
5. Klik **Upload to Roblox**. Server memanggil `https://apis.roblox.com/assets/v1/assets` memakai API key tersebut.

Endpoint Roblox:

- `POST /api/roblox-api/connect`
- `GET /api/roblox-api/session`
- `POST /api/roblox-api/test`
- `DELETE /api/roblox-api/remove`
- `POST /api/roblox/upload-audio`

Tidak ada `ROBLOX_CREATOR_USER_ID`, Universe ID, atau Place ID yang dipakai sebagai pengganti creator. Endpoint upload hanya menerima session Google user dan reference credential server-side milik user tersebut.

Untuk production, gunakan HTTPS, cookie `HttpOnly`/`Secure`/`SameSite`, CSRF protection, rate limiting, dan Railway Secret/Environment Variables. API key tidak dipersistenkan ke database dan akan perlu dimasukkan ulang setelah restart/deploy.

Untuk upload ke Community/Group, API key harus dibuat dengan resource experience/game yang benar dan akun pembuat key harus memiliki izin yang sesuai pada Community tersebut. Aplikasi mengirim `creator.userId` untuk target personal dan `creator.groupId` untuk target Community/Group. Universe ID hanya boleh digunakan pada endpoint Roblox yang secara eksplisit memintanya; aplikasi ini tidak mengubah ID secara otomatis.

Roblox tidak menyediakan endpoint umum untuk membaca daftar permission write API key tanpa menjalankan operasi asset. Karena itu koneksi hanya memvalidasi session, bentuk API key yang tidak kosong, jenis creator, dan ID numerik; permission/resource sebenarnya diverifikasi oleh endpoint upload resmi dan response `401/403` dikategorikan secara jelas. Aplikasi tidak membuat request upload palsu atau endpoint fallback.

## YouTube

URL YouTube hanya divalidasi dan tidak diunduh oleh aplikasi. Pengguna harus mengunggah file audio yang memang mereka miliki hak untuk digunakan, sehingga aplikasi tidak membypass pembatasan atau DRM.

## Pemeriksaan

```powershell
npm run check
```

`npm run check` memeriksa syntax server dan menjalankan production build frontend.
