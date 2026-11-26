# SilentSmile Exchange — Panduan Deploy AWS EC2 (`ncue.fun`)

**SilentSmile Exchange** adalah platform simulasi spot exchange institusional (tema *Emerald Noir*) lengkap dengan Matching Engine CLOB, Market Maker Bot Station, Volume Execution Engine, WebSocket real-time (`/ws`), dan persistence SQLite (`data/silentsmile.db`).

> **Catatan Simulasi:** Seluruh saldo, pair IDR, eksekusi order, dan likuiditas di aplikasi ini adalah lingkungan **DEMO / SIMULASI** (tidak terhubung ke custody blockchain atau fiat real).

---

## 1. Spesifikasi & Security Group AWS EC2

Gunakan instance EC2 berbasis **Ubuntu 22.04 LTS** atau **Ubuntu 24.04 LTS**:
- **Tipe Instance Minimum:** `t3.small` (2 vCPU, 2 GB RAM) atau `t3.medium` (disarankan untuk menjalankan background worker + build TypeScript/Vite dengan nyaman).
- **Storage:** Minimal `20 GB gp3`.
- **AWS EC2 Security Group (Inbound Rules):**
  | Type | Protocol | Port | Source | Keterangan |
  | :--- | :--- | :--- | :--- | :--- |
  | SSH | TCP | `22` | IP Anda | Akses terminal server |
  | HTTP | TCP | `80` | `0.0.0.0/0` | Redirect ke HTTPS & verifikasi SSL Certbot |
  | HTTPS | TCP | `443` | `0.0.0.0/0` | Akses utama `https://ncue.fun` & `wss://ncue.fun/ws` |

> Port aplikasi internal (`3000`) **tidak perlu** dibuka ke publik di Security Group karena seluruh traffic masuk melalui Nginx Reverse Proxy di port `80`/`443`.

---

## 2. Konfigurasi DNS Domain (`ncue.fun`)

Di dashboard registrar domain / Cloudflare / AWS Route 53 untuk **`ncue.fun`**, buat record berikut mengarah ke **Public IPv4 / Elastic IP** instance EC2 Anda:

| Type | Name / Host | Value / Target | TTL |
| :--- | :--- | :--- | :--- |
| `A` | `@` | `<IP_PUBLIC_EC2_ANDA>` | Auto / 300 |
| `A` | `www` | `<IP_PUBLIC_EC2_ANDA>` | Auto / 300 |

*(Jika memakai Cloudflare Proxy saat setup SSL awal, ubah sementara ke **DNS Only (awan abu-abu)** agar Certbot bisa menerbitkan sertifikat SSL Let's Encrypt dengan lancar).*

Cek propagasi DNS dari terminal lokal atau EC2:
```bash
dig +short ncue.fun A
dig +short www.ncue.fun A
```

---

## 3. Setup Server EC2 (Node.js, PM2, Nginx, Certbot)

Login via SSH ke EC2 lalu install paket dasar:

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git curl build-essential nginx certbot python3-certbot-nginx
```

Install **Node.js 22 LTS** dan **PM2**:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # Pastikan v20+ atau v22+
npm -v

sudo npm install -g pm2
```

*(Opsional tapi sangat disarankan untuk `t3.micro`/`t3.small`)* Tambahkan swap 2 GB agar `npm run build` tidak kehabisan RAM:

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

---

## 4. Clone Repository, Build & Konfigurasi `.env`

Letakkan project di `/var/www/silentsmile`:

```bash
sudo mkdir -p /var/www/silentsmile
sudo chown -R $USER:$USER /var/www/silentsmile
cd /var/www/silentsmile

git clone <URL_REPOSITORY_ANDA> .
npm ci
```

Buat file `.env` dari `.env.example` dan isi secret JWT yang kuat:

```bash
cp .env.example .env
```

Generate secret acak dan tulis ke `.env`:

```bash
ACCESS_SECRET=$(openssl rand -hex 32)
REFRESH_SECRET=$(openssl rand -hex 32)

cat > .env <<EOF
NODE_ENV=production
PORT=3000
APP_URL=https://ncue.fun
JWT_ACCESS_SECRET=${ACCESS_SECRET}
JWT_REFRESH_SECRET=${REFRESH_SECRET}
EOF
```

Build frontend (`dist/`) dan backend production bundle (`server-dist.mjs`):

```bash
npm run build
```

Pastikan direktori database SQLite tersedia dan bisa ditulisi:

```bash
mkdir -p /var/www/silentsmile/data
```

---

## 5. Jalankan Aplikasi dengan PM2

Jalankan server full-stack (Express + static `dist/` + WebSocket `/ws`) menggunakan PM2:

```bash
cd /var/www/silentsmile
NODE_ENV=production pm2 start npm --name "silentsmile-ncue" -- start
pm2 save
```

Aktifkan auto-start PM2 saat EC2 reboot (jalankan perintah output yang muncul dari command berikut):

```bash
pm2 startup systemd
```

Verifikasi server lokal sudah aktif di port `3000`:

```bash
pm2 status
curl -i http://127.0.0.1:3000/api/health
```

Harus mengembalikan HTTP `200 OK`.

---

## 6. Konfigurasi Nginx Reverse Proxy untuk `ncue.fun` (Termasuk WebSocket `/ws`)

Buat file konfigurasi Nginx `/etc/nginx/sites-available/ncue.fun`:

```bash
sudo tee /etc/nginx/sites-available/ncue.fun > /dev/null <<'EOF'
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 80;
    listen [::]:80;
    server_name ncue.fun www.ncue.fun;

    client_max_body_size 15M;

    # WebSocket endpoint (/ws) untuk feed harga real-time & orderbook
    location /ws {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }

    # REST API & Frontend SPA
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
EOF
```

Aktifkan virtual host Nginx & reload:

```bash
sudo ln -sf /etc/nginx/sites-available/ncue.fun /etc/nginx/sites-enabled/ncue.fun
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

---

## 7. Pasang SSL HTTPS (`https://ncue.fun`) dengan Certbot

Setelah DNS `ncue.fun` mengarah ke EC2, jalankan Certbot:

```bash
sudo certbot --nginx -d ncue.fun -d www.ncue.fun --redirect
```

Cek auto-renewal sertifikat SSL:

```bash
sudo certbot renew --dry-run
```

Sekarang akses di browser:
- **URL Aplikasi:** `https://ncue.fun`
- **Health Check:** `https://ncue.fun/api/health`
- **WebSocket:** `wss://ncue.fun/ws`

---

## 8. Akun Demo Default (Untuk Testing Awal)

Saat server pertama kali dijalankan, database SQLite (`data/silentsmile.db`) otomatis melakukan seeding akun demo berikut:

| Role | Email | Password |
| :--- | :--- | :--- |
| Operations Admin | `admin@silentsmile.io` | `AdminPass123!` |
| Pro Trader | `trader@silentsmile.io` | `TraderPass123!` |

*(Akun Market Maker `usr_mm_01` / `mm@silentsmile.io` juga otomatis dibuat dengan likuiditas awal di SQLite).*

---

## 9. Update & Maintenance di EC2

Setiap kali menarik update kode baru dari Git:

```bash
cd /var/www/silentsmile
git pull
npm ci
npm run build
pm2 restart silentsmile-ncue
```

Perintah monitoring log:

```bash
pm2 logs silentsmile-ncue --lines 100
sudo tail -f /var/log/nginx/error.log
```

---

## 10. Troubleshooting Singkat

1. **WebSocket gagal connect (`wss://ncue.fun/ws`):**
   - Pastikan blok `location /ws` di Nginx memiliki `proxy_http_version 1.1`, `Upgrade $http_upgrade`, dan `Connection $connection_upgrade`.
   - Jika memakai Cloudflare setelah SSL aktif, pastikan mode SSL Cloudflare adalah **Full (strict)** dan fitur **WebSockets** aktif.
2. **Login berhasil lalu mental balik ke halaman login:**
   - Pastikan Nginx mengirim header `X-Forwarded-Proto $scheme` dan aplikasi memakai `trust proxy` (sudah aktif di `src/server/app.ts`) agar cookie session HTTPS diset dengan benar.
3. **Data candle/order reset setelah restart:**
   - Pastikan folder `/var/www/silentsmile/data/silentsmile.db` dimiliki oleh user yang menjalankan PM2 (`chown -R $USER:$USER /var/www/silentsmile/data`) dan jangan menghapus folder `data/`.

---

## Perintah Lokal (Development)

```bash
npm install      # Install dependencies
npm run dev      # Menjalankan full-stack dev server (port 3000)
npm run lint     # TypeScript check (tsc --noEmit)
npm test         # Menjalankan Vitest suite
npm run build    # Build client dist/ & server-dist.mjs
npm start        # Menjalankan production server
```
