# Rival Dev Audio Suite

Premium React + Vite dashboard untuk mengonversi audio dan mengunggah asset ke Roblox Open Cloud melalui backend Express. Frontend dan API dipisahkan: React berjalan di `client/`, sementara token Roblox dan FFmpeg tetap di server.

## Prasyarat

- Node.js 18 atau lebih baru
- FFmpeg terpasang dan tersedia di `PATH`
- `yt-dlp` terpasang dan tersedia di `PATH` untuk konversi URL YouTube yang pengguna berhak gunakan
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

Isi `PAYMENT_ADMIN_EMAIL` dengan alamat email Google admin pembayaran. Nilainya dibandingkan dengan email hasil verifikasi Google, bukan dengan nama tampilan akun.

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

Route `POST /api/source/detect` dapat mengambil metadata nyata dari YouTube, SoundCloud, TikTok, Spotify, dan Apple Music melalui provider metadata resmi/oEmbed. Metadata yang tersedia bergantung pada provider dan dapat meliputi judul, creator/artist, thumbnail, dan durasi.

Aplikasi ini tidak mengunduh atau mengekstrak audio dari URL platform tersebut. Endpoint detection mengembalikan `audio.available: false` sampai integrasi audio resmi dikonfigurasi. Audio yang akan diproses harus diunggah sebagai file yang memang dimiliki atau dilisensikan pengguna; aplikasi tidak membypass DRM atau pembatasan platform.

Provider resmi opsional: `YOUTUBE_API_KEY` memakai YouTube Data API untuk metadata; `SPOTIFY_CLIENT_ID` dan `SPOTIFY_CLIENT_SECRET` memakai Spotify Client Credentials untuk metadata; `APPLE_MUSIC_DEVELOPER_TOKEN` dan `APPLE_MUSIC_STOREFRONT` memakai Apple Music API; `SOUNDCLOUD_ACCESS_TOKEN` memakai SoundCloud Resolve API. Spotify/Apple Music tidak menyediakan file audio download melalui API resmi. SoundCloud hanya dapat menyediakan stream untuk track yang playable dan tetap tunduk pada attribution/terms, sehingga aplikasi tidak mengubahnya menjadi file download.

## Evaluasi Provider Pihak Ketiga

Tidak ada provider pihak ketiga yang dipasang untuk mengekstrak audio dari URL YouTube, Spotify, Apple Music, SoundCloud, atau TikTok. YouTube API Terms membatasi reproduksi/distribusi audiovisual di luar API; Spotify melarang download dan membatasi preview/metadata sebagai standalone service; Apple Music API menyediakan katalog dan resource metadata; TikTok Display API menyediakan metadata/embed; SoundCloud menyediakan stream untuk track playable dengan attribution, bukan jaminan file download.

Marketplace seperti Apify/RapidAPI berisi actor/API pihak ketiga dengan lisensi, harga, dan kepatuhan platform yang berbeda-beda. Listing downloader/scraper bukan bukti bahwa penggunaan komersial atau redistribusi audio diizinkan, sehingga tidak dipasang tanpa kontrak provider dan legal review yang spesifik. Cloudinary dapat menerima dan mentransformasi asset dari URL publik, tetapi bukan provider ekstraksi audio platform; aplikasi hanya menggunakan pipeline FFmpeg untuk file yang telah diperoleh secara sah.

Menu **Download via URL** menggunakan `POST /api/source/download` untuk URL file media langsung. Backend mengunduh sumber dengan batas 100 MB dan timeout 30 detik, memprosesnya dengan FFmpeg sesuai `format` dan `speed`, lalu mengembalikan `downloadUrl` hasil nyata. URL halaman platform/HTML ditolak dan tidak dianggap sebagai audio.

## Pemeriksaan

```powershell
npm run check
```

`npm run check` memeriksa syntax server dan menjalankan production build frontend.
