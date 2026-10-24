# AI_Film - thêm phim mới lên R2

Video **không** đưa vào git (quá nặng, `.gitignore` đã chặn `mp4/mov/mkv/webm`). Video nằm trên Cloudflare R2;
git chỉ giữ danh sách (`MANIFEST.json`, `MANIFEST.md`, `CATALOG.json`, `catalog-meta.json`) và phụ đề `.srt`.

Bạn **không cần tải các phim cũ về máy**: chỉ cần trên máy có phim mới của bạn, các phim cũ được giữ nguyên trong danh sách.
Upload xong có thể xoá video trên máy.

## Chuẩn bị (một lần)

1. File `.env` của BE có đủ `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`,
   `S3_PUBLIC_BASE_URL` (key R2 của nhóm, xin trưởng nhóm, **không commit**).
2. Cài `ffmpeg` và có trong PATH (`ffmpeg -version` chạy được).
3. `npm install`.

## Các bước

**Mọi lệnh `git` và `npm` bên dưới đều chạy ở thư mục gốc của repo Backend**
[`locphamxuan/AI_Cinema_BE`](https://github.com/locphamxuan/AI_Cinema_BE), tức thư mục chứa `package.json` và `.env`
của BE. Không chạy ở repo FE, Mobile hay ở thư mục workspace bên ngoài.
Chạy `git remote -v` để kiểm tra: phải thấy `AI_Cinema_BE.git`.

```bash
# 0. Vào thư mục repo BE (đổi đường dẫn theo máy bạn)
cd <đường-dẫn>/AI_Cinema_BE
git remote -v              # phải là .../locphamxuan/AI_Cinema_BE.git

# 1. Nhánh mới từ dev
git checkout dev && git pull
git checkout -b chore/add-films-<ten-phim>
```

**2. Đặt video đúng cấu trúc** trong `AI_Film/AI_Film_v2/`:

```
AI_Film_v2/
└── Khoa học viễn tưởng - Hành động/      <- thư mục thể loại, các thể loại cách nhau bởi " - "
    └── The Fallen/                        <- tên phim (hiển thị trong app)
        ├── The Fallen.ep1.mp4             <- tên file phải có "ep<số>" để xếp thứ tự tập
        ├── The Fallen.ep1.en.srt          <- phụ đề (tuỳ chọn): <tên video>.<mã ngôn ngữ>.srt
        ├── The Fallen.ep2.mp4
        └── The Fallen.ep2.vi.srt          <- phụ đề "vi" là phụ đề mặc định
```

- Video phải là **`.mp4` H.264 + AAC** (iPhone không phát được `.webm`/AV1). Đổi định dạng:
  ```bash
  ffmpeg -i "vao.webm" -vf "scale=-2:'min(1080,ih)'" -c:v libx264 -crf 23 -pix_fmt yuv420p -c:a aac -b:a 128k -movflags +faststart "ra.mp4"
  ```
- Phim tiếng Anh, có tóm tắt hoặc năm phát hành: thêm vào `AI_Film/catalog-meta.json`
  ```json
  { "The Fallen": { "language": "en", "releaseYear": 2026, "synopsis": "Tóm tắt tiếng Việt..." } }
  ```
- Poster được lấy tự động từ một khung hình của tập 1.

```bash
# 3. Upload video lên R2, cập nhật MANIFEST
npm run film:push

# 4. Đo thời lượng, upload poster + phụ đề, cập nhật CATALOG.json
npm run film:catalog

# 5. Commit danh sách + phụ đề (không có video)
git add AI_Film            # video bị .gitignore chặn, chỉ danh sách + phụ đề .srt được thêm
git status                 # KHÔNG được thấy file .mp4/.webm nào
git commit -m "chore(film): add <ten phim>"
git push -u origin chore/add-films-<ten-phim>
```

**6.** Mở PR vào `dev`. Người review kiểm tra diff `MANIFEST.json` / `CATALOG.json` **chỉ thêm, không xoá phim cũ**.

**7.** Sau khi merge: chạy `npm run seed:catalog` trên database đích để phim hiện trong app
(chạy lại nhiều lần không sao, phim đã có thì bỏ qua).

## Lệnh khác

| Lệnh | Việc |
| :--- | :--- |
| `npm run film:list` | Xem máy đang thiếu video nào so với R2 |
| `npm run film:pull` | Tải video trên R2 về máy (chỉ khi cần xem/sửa video) |

## Lỗi thường gặp

- `... is not on R2 yet: run npm run film:push` → chạy `film:push` trước `film:catalog`.
- `S3_... is empty` → `.env` thiếu key R2.
- Phim không hiện trong app sau khi merge → chưa chạy `npm run seed:catalog`.
