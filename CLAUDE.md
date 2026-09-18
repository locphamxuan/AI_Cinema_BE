# AI Cinema — Backend (AI-_Cinema_BE)

> Đọc `../docs/PROJECT_OVERVIEW.md` trước khi làm bất kỳ việc gì — đó là nguồn sự thật duy nhất về actor, business rule, main flow, database, API cho cả 3 repo. File này chỉ ghi quy ước riêng của backend.

## Vai trò của repo này
REST API + worker nền cho toàn bộ nghiệp vụ AI Cinema: ví coin, membership, AI content pipeline, compliance labeling, support chatbot, risk/fraud, reporting.

## Tech stack
Node 20 LTS · Express 5 · TypeScript · Prisma ORM · PostgreSQL 16 (+pgvector, pg_trgm) · Redis 7 · BullMQ · FFmpeg (fluent-ffmpeg) · Cloudflare R2 · argon2 · JWT · Zod · Pino.

## Kiến trúc: modular monolith + worker
Một Express app chia theo module nghiệp vụ, một worker process riêng chạy job dài (BullMQ). Không tách microservices — team 4 người, deploy/ACID đơn giản hơn.

```
src/
  config/        env (zod-validated), db, redis, queue
  common/        middlewares, errors, pagination, idempotency, money
  modules/       auth catalog production ai-pipeline compliance wallet entitlement
                 subscription rewards support recsys marketing risk reporting
                   mỗi module 1 bộ: index.ts(routes) controller.ts service.ts repository.ts schema.ts
                   — nhiều entity liên quan trong cùng module gộp chung 1 file/lớp (1 class/entity),
                   chỉ tách file riêng theo entity khi 1 lớp thực sự phình to.
  providers/     llm/ tts/ image/ payment/ ads/ storage/   ← interface + impl + mock
  jobs/          renewSubscriptions expireBonusCoins generateContent
                 transcode fraudScan buildReports
  prisma/        schema.prisma, migrations/, seed.ts
```

## Quy ước bắt buộc (không thương lượng)

- **Tiền/coin luôn BIGINT**, không bao giờ FLOAT/Number cho số dư hay giá.
- **Ví coin là ledger append-only** (`coin_transactions`). `wallets.balance` chỉ là cache — mọi thay đổi số dư phải ghi kèm 1 dòng ledger trong cùng transaction.
- Mọi thao tác chạm ví/coin phải: `SELECT ... FOR UPDATE` + `idempotency_key` UNIQUE. Xem BR-01, BR-04 trong PROJECT_OVERVIEW.md.
- **Cổng publish phim**: không được publish nếu `label_verified_at IS NULL`. Ràng buộc này nằm ở CHECK constraint DB (BR-10) — service layer không được "bypass" bằng raw query.
- Route nào chạm tiền/coin **bắt buộc** nhận header `Idempotency-Key`.
- Middleware phân quyền theo permission string (`movie:publish`, `wallet:adjust`...), không hard-code role name.
- Mỗi module tự chứa route → controller → service → repository → schema (1 file/lớp cho cả module, nhiều entity trong cùng module dùng chung file, mỗi entity 1 class riêng), không import chéo service giữa module trừ qua interface rõ ràng.

## Trước khi code một module
Đọc đúng section main flow tương ứng trong `../docs/PROJECT_OVERVIEW.md` (MF-1…MF-6, MF-A…MF-F) và bảng business rule (BR-xx) liên quan — đừng tự suy diễn lại luồng.

## Git workflow (bắt buộc, mọi thay đổi code/tính năng mới)

- Trước khi sửa hoặc thêm code/tính năng mới, luôn `git checkout -b <tên-nhánh>` để tạo nhánh mới — **không** commit thẳng lên `main`.
- Chia nhỏ commit theo từng ngữ cảnh/thay đổi logic riêng biệt (feature, fix, refactor, config... tách commit khác nhau), không gộp nhiều thay đổi không liên quan vào 1 commit.
- Commit message viết tiếng Anh, ngắn gọn, rõ ràng — **không** chứa logo hay dòng co-author/attribution của AI.
- Sau khi hoàn tất, chạy test và dọn file/thư mục/code tạm trước khi coi task là xong, rồi push nhánh lên remote.

## CodeGraph — bắt buộc cập nhật sau mỗi feature/fix
Repo được index bằng [CodeGraph](https://github.com/colbymchenry/codegraph) (`.codegraph/`, MCP tool `codegraph_*` / CLI `codegraph`) để tra cứu symbol, call graph, caller/callee thay vì grep thủ công. Auto-sync chạy nền qua file watcher, nhưng **ngay sau khi hoàn tất bất kỳ feature hay bug fix nào, chạy `codegraph sync` (hoặc `codegraph status` để xác nhận graph không "stale") trước khi coi task là xong** — đừng để agent sau tra cứu nhầm trên graph lệch với code thật.

## Trạng thái hiện tại
- `prisma/schema.prisma` có model cho MF-1 (AI Movie Production & Publishing): User (rút gọn), Movie/Season/Episode/Genre, ContentBrief, AiProvider/AiModel, GenerationJob, GeneratedAsset, EpisodePackage(+Asset), Review, ComplianceCheck, AiContentLabel, Publication, AuditLog. Đã `migrate dev` lên Postgres (Neon) dùng chung cho team — 20 bảng đã tồn tại thật trên DB.
- `src/` đã có **cấu trúc thư mục chuẩn cho MF-1** (`config/`, `common/`, `modules/{auth,catalog,production,ai-pipeline,compliance}/`, `providers/llm/`, `jobs/`, `app.ts`, `server.ts`) theo đúng quy ước route→controller→service→repository→schema ở trên — mỗi module 1 bộ 5 file (`index.ts`/`controller.ts`/`service.ts`/`repository.ts`/`schema.ts`), các entity trong cùng module là các class riêng trong chung file. **Toàn bộ là skeleton/TODO — chưa có business logic thật**, `npm run dev` chạy được và `/health` trả 200.
- Module `wallet entitlement subscription rewards support recsys marketing risk reporting` (MF-2..MF-5) **chưa scaffold**, làm khi tới flow tương ứng.
- Xem `../PROGRESS.md` để biết module nào đang làm.
