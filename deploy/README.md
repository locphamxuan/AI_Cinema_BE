# Deploy AI Cinema lên VPS (ai-cinema.vn)

Một VPS chạy cả Web (Next.js) và API (NestJS) bằng Docker Compose; Nginx trên máy chủ lo HTTPS.
Database dùng Neon, video và ảnh lưu trên ổ đĩa VPS (volume `media-storage`).

```
ai-cinema.vn      ─► Nginx ─► web  (127.0.0.1:3000) ──/api──► api
api.ai-cinema.vn  ─► Nginx ─► api  (127.0.0.1:3001) ─► Redis, Neon, ổ đĩa
```

## 1. Tạo VPS (DigitalOcean, credit GitHub Student Pack)

1. Nhận credit: https://education.github.com/pack → DigitalOcean → đăng ký bằng tài khoản GitHub.
2. DigitalOcean → **Create → Droplets**: Ubuntu 24.04, vùng **Singapore**, gói Basic **2 vCPU / 4 GB** (hoặc 4 vCPU / 8 GB nếu xử lý nhiều video).
3. **Authentication: SSH key** (tạo trên máy bằng `ssh-keygen -t ed25519`, dán nội dung `~/.ssh/id_ed25519.pub`).
4. Ghi lại địa chỉ IP của droplet.

## 2. Trỏ tên miền

Tại nơi quản lý DNS của `ai-cinema.vn`, thêm:

| Loại | Tên | Giá trị |
|---|---|---|
| A | `@` | IP của VPS |
| A | `www` | IP của VPS |
| A | `api` | IP của VPS |

Kiểm tra: `nslookup api.ai-cinema.vn` trả về đúng IP (có thể mất vài phút đến vài giờ).

## 3. Chuẩn bị máy chủ (chạy một lần)

```bash
ssh root@<IP>
adduser deploy && usermod -aG sudo deploy
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable
curl -fsSL https://get.docker.com | sh && usermod -aG docker deploy
apt install -y nginx certbot python3-certbot-nginx git
# 2 GB swap để build Next.js không thiếu RAM
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
mkdir -p /opt/ai-cinema && chown deploy:deploy /opt/ai-cinema
```

## 4. Lấy code và điền biến môi trường

```bash
su - deploy
cd /opt/ai-cinema
git clone https://github.com/locphamxuan/AI-_Cinema_BE.git
git clone https://github.com/locphamxuan/AI_Cinema_FE.git
cd AI-_Cinema_BE/deploy
cp be.env.example be.env && nano be.env     # điền mọi chỗ <...>
cp .env.example .env && nano .env           # Google Client ID cho web
```

Sinh khoá ngẫu nhiên cho `JWT_SECRET`, `PLAYBACK_URL_SECRET`, `STUDIO_WEBHOOK_TOKEN`: `openssl rand -hex 48`.

## 5. Chạy

```bash
./deploy.sh main          # kéo code nhánh main của cả hai repo rồi build và chạy
curl http://127.0.0.1:3001/api/health
curl -I http://127.0.0.1:3000
```

Lần đầu build mất khoảng 5–10 phút. Service `migrate` chạy `prisma migrate deploy` và seed trước khi API khởi động.

## 6. Nginx và HTTPS

```bash
sudo cp nginx/ai-cinema.vn.conf /etc/nginx/sites-available/ai-cinema.vn
sudo ln -s /etc/nginx/sites-available/ai-cinema.vn /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d ai-cinema.vn -d www.ai-cinema.vn -d api.ai-cinema.vn
```

Certbot tự gia hạn chứng chỉ. Mở https://ai-cinema.vn và https://api.ai-cinema.vn/api/health để kiểm tra.

## 7. Cập nhật bên ngoài

| Nơi | Việc cần làm |
|---|---|
| Google Cloud Console → OAuth Client (Web) | Thêm `https://ai-cinema.vn` và `https://www.ai-cinema.vn` vào *Authorized JavaScript origins* |
| VNPay (merchant) | IPN URL: `https://api.ai-cinema.vn/api/payments/vnpay/callback` |
| Mobile (`AI_Cinema_Mobile`) | URL API trỏ về `https://api.ai-cinema.vn/api`, build lại bằng EAS |

## 8. Vận hành

| Việc | Lệnh (trong `deploy/`) |
|---|---|
| Cập nhật phiên bản mới | `./deploy.sh main` |
| Xem log API / Web | `docker compose -f docker-compose.prod.yml logs -f api` (hoặc `web`) |
| Khởi động lại | `docker compose -f docker-compose.prod.yml restart api` |
| Dung lượng video | `docker system df -v` (volume `ai-cinema_media-storage`) |

Sao lưu video định kỳ: `docker run --rm -v ai-cinema_media-storage:/data -v $PWD:/backup alpine tar czf /backup/media-$(date +%F).tgz -C /data .`
