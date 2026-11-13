# Demo Main Flow 1

## Dựng dữ liệu

Chạy theo thứ tự:

```bash
npx prisma migrate deploy        # đưa schema lên bản mới nhất (có bảng contract_documents)
npx prisma db seed               # tài khoản, quyền, Studio demo
npm run seed:prune-movies        # liệt kê phim không thuộc R2; thêm -- --apply để xoá
npm run seed:mf1-demo            # build rồi dựng 5 dự án "[Demo MF-1] …"
```

Lệnh `seed:mf1-demo` xoá bộ demo cũ trước khi dựng lại, nên chạy lại bao nhiêu lần cũng được. Seed gọi các service thật của BE, nên dữ liệu đi qua đúng quy tắc, trigger và thông báo như thao tác thật. Riêng job nền và gửi mail được tắt trong lúc seed.

## Tài khoản

| Vai trò | Email | Mật khẩu |
|---|---|---|
| Admin | `admin@gmail.com` | `SEED_USER_PASSWORD` (mặc định `Aicinema@123`) |
| Reviewer | `reviewer@gmail.com` | như trên |
| Creator | `creator.aicinema@gmail.com` | như trên |
| Studio (Lumen Studio, Studio Web) | `studio@aicinema.com` | như trên |
| Staff | `staff@gmail.com` | `Staff123456` |
| Member (Mobile) | `abc@gmail.com` | `SEED_USER_PASSWORD` |

## 5 dự án, mỗi dự án dừng ở một mốc

| Dự án | Đang dừng ở | Bước demo tiếp theo |
|---|---|---|
| 1. Viết kịch bản | Creator đã nộp kịch bản bản 1 | Reviewer duyệt → Admin duyệt Kịch bản Final |
| 2. Hợp đồng | Hệ thống đã gửi hợp đồng mẫu cho Studio | Admin upload `docs/contracts/hop-dong-ai-cinema-ban-ky-admin.pdf` kèm giá, rồi Studio upload `hop-dong-ai-cinema-ban-ky-studio.pdf` |
| 3. Giao phim | Hợp đồng đủ 2 chữ ký: có bản ADMIN, STUDIO, FINAL | Studio giao tập bằng link phim trên R2 (lấy trong `AI_Film/CATALOG.json`) |
| 4. Duyệt nội dung | Tập 1 đã giao, chờ Reviewer | Reviewer duyệt → gắn nhãn AI → kiểm tra tuân thủ → xác nhận Final Film |
| 5. Định giá & phát hành | Tập 1 đã qua tuân thủ, Final Film đã xác nhận | Admin đặt giá Coin, chọn tập miễn phí / khoá, rồi publish |

Mỗi bước đều gửi thông báo cho mọi Admin, trừ Admin đang thao tác. Admin xem các thông báo này trong mục Thông báo.
