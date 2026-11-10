# Phát HLS qua CDN: Cloudflare R2 + Cloudflare CDN

Tài liệu này mô tả cách BE phát video HLS qua CDN, và những gì **phải tạo thủ công** trên
Cloudflare. Code không tự tạo tài khoản, bucket hay bản ghi DNS nào.

## 1. Kiến trúc

```
Player ──1── POST /api/playback/sessions ──► API (kiểm tra entitlement + thiết bị)
       ◄──── masterUrl có chữ ký (trỏ về API)

Player ──2── GET /api/playback/s/:id/master.m3u8?s=&exp=&sig= ──► API
       ◄──── master playlist, mỗi dòng trỏ về API (route rendition)

Player ──3── GET /api/playback/s/:id/renditions/720p/index.m3u8 ──► API
       ◄──── playlist với MỌI segment đã rewrite thành URL CDN có chữ ký

Player ──4── GET https://<CDN_BASE_URL>/public/hls/<assetId>/720p/seg_000.ts?s=&exp=&sig=
             ──► Worker `playback-cdn` (xác thực chữ ký) ──► R2 bucket (PRIVATE)
```

- **Playlist** (master + rendition) do **API** trả về. Mỗi lần trả, API kiểm tra lại phiên
  xem (`StreamingSession` còn `ACTIVE`) và **ký lại** toàn bộ URL con với hạn mới.
- **Segment** (`.ts`, `.m4s`, `init.mp4`) do **CDN** trả về. Worker ở biên xác thực chữ ký
  rồi đọc object từ R2 qua binding, nên bucket giữ ở chế độ **private**.

## 2. Cơ chế ký và hạn dùng

- Token: `?s=<sessionId>&exp=<unix>&sig=HMAC_SHA256(PLAYBACK_URL_SECRET, "sessionId|assetId|exp")`.
- Chữ ký gắn với **phiên xem + asset**, không gắn với từng đường dẫn file. Một token mở được
  master, các rendition và mọi segment của asset đó cho đến `exp`.
- `exp` mặc định 1 giờ (`PLAYBACK_URL_TTL_SECONDS`). Mỗi lần tải playlist, API ký lại URL con,
  nên người đang xem trượt hạn về phía trước, còn link bị rò rỉ chết trong vòng TTL.
- Người dùng **không có quyền xem** sẽ bị chặn ngay ở bước 1 (`PlaybackAccessService` kiểm tra
  entitlement), nên không bao giờ nhận được URL phát được.

### Vì sao không dùng presigned URL của S3/R2?

Presigned URL (S3-compatible) ký **từng object một**. Một tập phim HLS có hàng nghìn segment,
nên BE sẽ phải ký lại toàn bộ danh sách mỗi lần tải playlist, và mọi lần người xem đổi
chất lượng (ABR). Ngoài ra Cloudflare **không** có cơ chế "signed URL" sẵn cho R2 public
bucket giống CloudFront (chỉ có WAF Token Authentication, cần gói trả phí cao và cấu hình
riêng trên zone).

Cách đang dùng — **bucket private + Worker kiểm tra HMAC ở biên** — chỉ ký một token duy nhất
cho cả asset, hoạt động đúng với mọi segment chứ không riêng playlist, và vẫn cache được ở
biên vì cache key là đường dẫn (bỏ query string).

**Đánh đổi:** token mở cả asset trong khoảng TTL, nên nếu người dùng cố tình chia sẻ link thì
trong tối đa 1 giờ người khác vẫn xem được asset đó. Đổi lại, hệ thống không phải ký hàng
nghìn URL cho mỗi lượt xem. Muốn siết hơn thì giảm `PLAYBACK_URL_TTL_SECONDS` (tối thiểu 60s).

## 3. Quy tắc cache và gỡ nội dung

| Loại file | Cache-Control | Nơi đặt |
|---|---|---|
| `.ts`, `.m4s`, `.mp4` (segment) | `public, max-age=31536000, immutable` | Worker + lúc upload lên R2 |
| `.m3u8` (playlist) | `public, max-age=10` | Worker (nhưng playlist thật do API trả, không qua CDN) |
| `.vtt` (phụ đề) | `public, max-age=3600` | Worker + R2 |

Khi một tập bị gỡ (`POST /api/publications/:id/unpublish` cho bản đã phát sóng):

1. Bản ghi `Publication` được đánh dấu `unpublishedAt`, tập chuyển `UNPUBLISHED`.
2. API gọi **cache purge** của Cloudflare theo prefix `<cdn-host>/public/hls/<assetId>/`.
3. Phiên xem đang mở không tải được playlist nữa (API kiểm tra trạng thái phiên mỗi lần tải).

**Bảo đảm thực tế:**

- Nếu đã cấu hình `CLOUDFLARE_ZONE_ID` + `CLOUDFLARE_API_TOKEN`: segment bị xoá khỏi biên
  ngay khi gỡ. Purge là *best effort* — nếu Cloudflare lỗi, việc gỡ tập **vẫn thành công**,
  chỉ ghi log.
- Nếu **chưa** cấu hình purge: bảo đảm duy nhất là playlist ngừng được phục vụ ngay lập tức
  (API kiểm tra DB), còn segment đã cache ở biên vẫn có thể phát được với token chưa hết hạn,
  tối đa bằng `PLAYBACK_URL_TTL_SECONDS` (mặc định 1 giờ).

## 4. Biến môi trường

| Biến | Ý nghĩa |
|---|---|
| `STORAGE_DRIVER` | `s3` để lưu lên R2, `local` cho máy dev/demo |
| `S3_ENDPOINT` | `https://<account-id>.r2.cloudflarestorage.com` |
| `S3_REGION` | `auto` |
| `S3_BUCKET` | Tên bucket R2 |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | R2 API token (Object Read & Write) |
| `STORAGE_PUBLIC_BASE_URL` | Origin của object store; cũng là nơi phát khi không có CDN |
| `CDN_BASE_URL` | Custom domain Cloudflare trỏ vào Worker. **Để trống = không dùng CDN** |
| `PLAYBACK_URL_SECRET` | Khoá HMAC ký URL. Phải **giống hệt** secret của Worker. Để trống = tắt ký (chỉ dùng local) |
| `PLAYBACK_URL_TTL_SECONDS` | Hạn của URL đã ký, mặc định `3600`, tối thiểu `60` |
| `CLOUDFLARE_ZONE_ID` | Zone chứa custom domain, dùng để purge cache |
| `CLOUDFLARE_API_TOKEN` | API token chỉ cần quyền `Zone -> Cache Purge` |
| `CLOUDFLARE_API_URL` | Mặc định `https://api.cloudflare.com/client/v4` |

Khi `CDN_BASE_URL` trống, `cdn.baseUrl` tự lấy `STORAGE_PUBLIC_BASE_URL`, và driver `local`
vẫn phục vụ HLS qua `/media` như hiện tại — ứng dụng khởi động bình thường, không crash.

## 5. Việc phải làm thủ công trên Cloudflare

1. **Tạo R2 bucket** (ví dụ `aicinema-media`). **Không** bật Public Development URL (`r2.dev`)
   và **không** gắn custom domain trực tiếp vào bucket — bucket phải giữ private.
2. **Tạo R2 API token** (Object Read & Write) → lấy Access Key ID / Secret Access Key cho
   `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY`, và endpoint
   `https://<account-id>.r2.cloudflarestorage.com` cho `S3_ENDPOINT`.
3. **Thêm domain (zone)** vào Cloudflare, ví dụ `aicinema.example`.
4. **Deploy Worker** trong `workers/playback-cdn`:
   - Bỏ comment khối `[[r2_buckets]]` trong `wrangler.toml`, đặt `bucket_name` = tên bucket.
   - Bỏ comment `routes`, trỏ `stream.aicinema.example/public/hls/*` về Worker.
   - `wrangler secret put PLAYBACK_URL_SECRET` với đúng giá trị của API.
   - `wrangler deploy`.
5. **Tạo bản ghi DNS** `stream.aicinema.example` (proxied, đám mây màu cam) cho route Worker.
6. **Tạo API token purge cache**: My Profile → API Tokens → permission `Zone -> Cache Purge`
   trên đúng zone → điền `CLOUDFLARE_API_TOKEN`; Zone ID lấy ở trang Overview của domain.
7. Điền `CDN_BASE_URL="https://stream.aicinema.example"` vào `.env` của API.

## 6. FE / Mobile có phải sửa gì không?

Không. Client vẫn gọi `POST /api/playback/sessions` và phát `streamUrl` nhận được. Mọi thay đổi
nằm ở phía server: URL segment bên trong playlist đổi host, còn hợp đồng API giữ nguyên.
Nhãn AI (`aiLabel`) và các ràng buộc tuân thủ không bị đụng tới.
