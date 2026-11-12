# Hợp đồng mẫu cho demo MF-1 (không ký điện tử)

Ba file PDF dùng khi demo luồng hợp đồng, sinh bằng `npm run contracts:samples docs/contracts`:

| File | Dùng ở bước | Ai tải lên |
|---|---|---|
| `hop-dong-ai-cinema-ban-ky-admin.pdf` | Admin gửi chi phí kèm bản đã có chữ ký AI Cinema (`POST /api/contracts/:id/counter`, multipart `file` + `costVnd`) | Admin |
| `hop-dong-ai-cinema-ban-ky-studio.pdf` | Studio xem bản của Admin trên Studio Web rồi tải bản đã có chữ ký Studio (`POST /api/studio-portal/contracts/:id/sign`) | Studio |
| `hop-dong-ai-cinema-du-hai-chu-ky.pdf` | Bản đủ hai chữ ký: hệ thống tự ghép bản Admin + bản Studio + trang tóm tắt khi đủ chữ ký (`GET .../documents/FINAL/content`) | Hệ thống |

Chữ ký trong file là chữ ký in sẵn để demo, không phải chữ ký số. Hợp đồng số `AIC-2026-001`, phim "Giấc Mơ Số", 170.000.000 VND.
