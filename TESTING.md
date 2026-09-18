# Testing Strategy — AI-_Cinema_BE

> Tài liệu chiến lược. Chưa cài package thật — thực hiện khi bắt đầu code từng module (xem `../PROGRESS.md`).

## Test levels

| Level | Công cụ đề xuất | Phạm vi |
|---|---|---|
| Unit | Vitest | Service layer thuần túy (tính toán coin, quy tắc BR-01/BR-05/BR-07), không đụng DB thật |
| Integration | Vitest + Supertest + Testcontainers (Postgres, Redis) | Route → controller → service → repository → DB thật trong container, chạy transaction thật |
| Contract | Zod schema + OpenAPI validation middleware | Request/response mọi endpoint khớp schema đã khai báo |
| Load/Concurrency | k6 hoặc autocannon | Race condition ví coin, double-submit idempotency |
| E2E cross-service | Playwright (gọi qua FE) hoặc Postman/Newman collection | 6 main flow chạy hết pipeline |

## Ưu tiên theo mức rủi ro nghiệp vụ

1. **Wallet/coin (MF-1, BR-01, BR-04)** — bắt buộc có integration test cho: đủ main, main+bonus, không đủ cả hai, double-click cùng idempotency_key, 2 request đồng thời cùng ví (Testcontainers + Promise.all).
2. **Compliance gate (MF-5, BR-10)** — test publish phim thiếu nhãn phải bị chặn ở tầng DB (insert trực tiếp bằng raw SQL bỏ qua service để chứng minh CHECK constraint hoạt động độc lập với code).
3. **Auto-renew 24h window (MF-2, BR-05)** — test biên: hủy tại `current_period_end - 24h - 1s` (được phép) và `- 24h + 1s` (không được phép, chỉ dừng ở kỳ sau).
4. **Điểm danh (MF-3, BR-07)** — test race: gửi 5 request điểm danh đồng thời cùng user cùng ngày, kỳ vọng chỉ 1 request thành công (UNIQUE constraint).

## Test data
- Seed tách biệt cho test: `prisma/seed.test.ts`, không dùng chung seed dev.
- Mock AI provider (`MockAiProvider`, `MockPaymentProvider`, `MockAdsProvider`) bắt buộc dùng trong mọi test, không gọi API thật.

## CI gate (khi có Docker Compose)
Unit + Integration chạy trên mọi PR; Load test chạy thủ công/định kỳ, không chặn PR.
