# Hợp đồng mẫu cho demo MF-1 (không ký điện tử)

Ba file PDF dùng khi demo luồng hợp đồng, sinh bằng `npm run contracts:samples docs/contracts`:

| File | Dùng ở bước | Ai tải lên |
|---|---|---|
| `hop-dong-ai-cinema-ban-ky-admin.pdf` | Admin gửi chi phí kèm bản đã có chữ ký AI Cinema (`POST /api/contracts/:id/counter`, multipart `file` + `costVnd`) | Admin |
| `hop-dong-ai-cinema-ban-ky-studio.pdf` | Studio xem bản của Admin trên Studio Web rồi tải bản đã có chữ ký Studio (`POST /api/studio-portal/contracts/:id/sign`) | Studio |
| `hop-dong-ai-cinema-du-hai-chu-ky.pdf` | Bản đủ hai chữ ký: hệ thống tự ghép bản Admin + bản Studio + trang tóm tắt khi đủ chữ ký (`GET .../documents/FINAL/content`) | Hệ thống |

Nội dung: Hợp đồng sản xuất phim số `AIC-2026-001/HĐSX-AIC`, phim "Giấc Mơ Số" (6 tập), giá trị 170.000.000 đồng thanh toán 3 đợt (30% / 40% / 30%). Mỗi bản ký gồm 4 trang:
- Quốc hiệu, căn cứ pháp lý, thông tin hai bên.
- 14 điều: định nghĩa; phạm vi công việc; giá trị và thanh toán; tiến độ; nghiệm thu; khai báo AI; sở hữu trí tuệ; bảo mật; quyền và nghĩa vụ Bên A, Bên B; bất khả kháng; vi phạm và chấm dứt; giải quyết tranh chấp; điều khoản chung.
- Khối chữ ký kèm con dấu.
- Phụ lục 01: danh sách tập và hạn giao.

Bản đủ hai chữ ký có 9 trang: bản Admin, bản Studio và trang tổng hợp do hệ thống tạo.

Tên đơn vị, mã số thuế, tài khoản, chữ ký và con dấu ("MẪU DEMO") đều là dữ liệu giả lập để demo, không phải chữ ký số. Nội dung hợp đồng nằm ở `scripts/sample-contract-clauses.ts`; sửa xong chạy lại `npm run contracts:samples docs/contracts`.
