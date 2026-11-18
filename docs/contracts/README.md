# Hợp đồng sản xuất phim (MF-1)

Hệ thống tự sinh hợp đồng từ dữ liệu thật trong DB; không còn file PDF mẫu cố định nào trong repo.

## Dữ liệu điền vào hợp đồng

| Phần | Lấy từ | Ai nhập |
|---|---|---|
| Bên A (tên công ty, địa chỉ, MST, tài khoản, đại diện, chức vụ, nơi ký) | `platform_settings.contract_*` | Admin, trang Cài đặt hệ thống (`PATCH /api/platform-settings`) |
| Bên B (tên, email, điện thoại, địa chỉ, MST, tài khoản, người đại diện `contact_name`, chức vụ) | `studios` | Admin, Danh mục Studio (`POST/PATCH /api/studios`) |
| Phim, thể loại, độ tuổi, danh sách tập, hạn giao | dự án / phim / tập | Admin khi tạo dự án |
| Ngân sách trần = giá trị hợp đồng | sổ chi phí (`production_cost_entries`) còn lại + phí bàn giao đang giữ | Admin khi tạo dự án (dòng BUDGET) |

Trường nào chưa nhập được in thành dòng chấm để ký tay.

## Luồng

1. Admin duyệt Kịch bản Final: hệ thống mở vòng hợp đồng 1 (`SENT`), báo Studio (thông báo + email có ngân sách trần).
2. Studio tải hợp đồng chưa ký: `GET /api/studio-portal/contracts/:id/template` (Admin/Reviewer: `GET /api/contracts/:id/template`). PDF có 14 điều + Phụ lục 01, giá trị = ngân sách trần, mã dự án và mã vòng nằm trong metadata (Keywords).
3. Studio ký ngoài hệ thống rồi tải lên bản chỉ có chữ ký Studio: `POST /api/studio-portal/contracts/:id/propose` (multipart `file`; bỏ trống `costVnd` = ký đúng ngân sách, gửi `costVnd` thấp hơn = đề xuất giá khác). PDF của dự án khác bị từ chối.
4. Admin tải bản Studio đã ký, ký Bên A, tải lên: `POST /api/contracts/:id/sign`. Hệ thống ghép bản FINAL (bản Studio + bản Admin + trang tổng hợp), bàn giao dự án (`IN_PRODUCTION`).

## Chuẩn bị demo

- `npm run seed:mf1-demo`: dữ liệu demo đọc từ `prisma/demo/mf1-demo.json` (Bên A, hồ sơ Studio, ngân sách, mốc), tạo 6 dự án dừng ở 6 mốc qua service thật. Các bản ký được tải lên chính là PDF hệ thống sinh cho từng dự án, có chữ ký mẫu.
- `npm run contracts:sign-demo -- <file vừa tải về> studio|admin [file ra]`: đóng chữ ký + dấu "MẪU DEMO" lên đúng hợp đồng vừa tải (script đọc mã vòng trong metadata của file), để upload khi demo trực tiếp.

Chữ ký và con dấu "MẪU DEMO" là hình vẽ minh hoạ, không phải chữ ký số; tên đơn vị, MST, tài khoản trong file demo là dữ liệu giả lập.
