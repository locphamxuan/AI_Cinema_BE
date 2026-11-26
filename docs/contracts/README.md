# Hợp đồng sản xuất phim (MF-1)

Hệ thống tự sinh hợp đồng từ dữ liệu thật trong DB; không còn file PDF mẫu cố định nào trong repo.

## Dữ liệu điền vào hợp đồng

| Phần | Lấy từ | Ai nhập |
|---|---|---|
| Bên A (tên công ty, địa chỉ, MST, tài khoản, đại diện, chức vụ, nơi ký) | `platform_settings.contract_*` | Admin, trang Cài đặt hệ thống (`PATCH /api/platform-settings`) |
| Bên B: tên, email nhận hợp đồng, điện thoại, người đại diện `contact_name` | `studios` | Admin, Danh mục Studio (`POST/PATCH /api/studios`) |
| Bên B: hồ sơ pháp lý (địa chỉ trụ sở, MST, số tài khoản, ngân hàng, chức vụ người đại diện) | `studios` | Studio tự nhập trên Studio Web (`GET/PUT /api/studio-portal/profile`); Admin chỉ xem |
| Phim, thể loại, độ tuổi, danh sách tập, hạn giao | dự án / phim / tập | Admin khi tạo dự án |
| Ngân sách trần = giá trị hợp đồng | sổ chi phí (`production_cost_entries`) còn lại + phí bàn giao đang giữ | Admin khi tạo dự án (dòng BUDGET) |

Bản chưa ký được sinh lại mỗi lần tải nên Bên B luôn là hồ sơ hiện tại. Trường Bên A chưa nhập in thành dòng chấm. Studio phải điền đủ hồ sơ pháp lý (và Admin phải có người đại diện) trước khi ký: thiếu thì API trả 409 `STUDIO_PROFILE_INCOMPLETE` kèm danh sách trường thiếu.

Kiểm tra hồ sơ: MST 10 chữ số hoặc 10 chữ số + `-` + 3 chữ số; số tài khoản 6–19 chữ số (khoảng trắng, dấu chấm, gạch được bỏ đi); các trường bắt buộc, được cắt khoảng trắng.

## Luồng ký bằng ảnh chữ ký

1. Admin duyệt Kịch bản Final: hệ thống mở vòng hợp đồng 1 (`SENT`), báo Studio (thông báo + email có ngân sách trần).
2. Studio tải hợp đồng chưa ký: `GET /api/studio-portal/contracts/:id/template` (Admin/Reviewer: `GET /api/contracts/:id/template`). PDF có 14 điều + Phụ lục 01, giá trị = ngân sách trần, mã dự án và mã vòng nằm trong metadata (Keywords).
3. Studio ký bằng cách tải ảnh chữ ký (PNG/JPEG, tối đa 2 MB, tối thiểu 150x50 px, mỗi cạnh tối đa 4000 px): `POST /api/studio-portal/contracts/:id/propose` (multipart `file`; bỏ trống `costVnd` = ký đúng ngân sách, gửi `costVnd` thấp hơn = đề xuất giá khác). Hệ thống vẽ ảnh vào ô "ĐẠI DIỆN BÊN B" của chính mẫu hợp đồng trên, kèm họ tên, chức vụ và "Ngày ký" theo giờ Việt Nam, lưu thành bản `STUDIO`.
4. Admin xem bản Studio đã ký rồi tải ảnh chữ ký Bên A: `POST /api/contracts/:id/sign`. Hệ thống lưu bản `ADMIN` và bản `FINAL` (cùng mẫu, đủ hai chữ ký), bàn giao dự án (`IN_PRODUCTION`).
5. Đề xuất giá khác: Admin `POST /api/contracts/:id/counter`, Studio `POST /api/studio-portal/contracts/:id/counter`, đều kèm ảnh chữ ký; mỗi lần mở vòng mới.

Ảnh chữ ký lưu riêng tư ở bảng `contract_signatures` (một ảnh mỗi bên mỗi vòng); các bản PDF đã ký ở `contract_documents`. Mọi bản ký có cùng số trang và bố cục với bản chưa ký.

## Chuẩn bị demo

- `npm run seed:mf1-demo`: dữ liệu demo đọc từ `prisma/demo/mf1-demo.json` (Bên A, liên hệ Studio, hồ sơ pháp lý Studio, ngân sách, mốc), tạo 6 dự án dừng ở 6 mốc qua service thật. Hai bên ký bằng ảnh `prisma/demo/signature-studio.png` và `prisma/demo/signature-admin.png`.
- Khi demo trực tiếp, dùng chính hai ảnh trên để tải lên ở Studio Web và trang Admin.

Ảnh chữ ký demo là hình vẽ minh hoạ có chữ "DEMO", không phải chữ ký thật hay chữ ký số; tên đơn vị, MST, tài khoản trong file demo là dữ liệu giả lập.
