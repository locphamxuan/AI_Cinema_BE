# Đăng nhập Studio Web qua AI Cinema (OAuth 2.0 + PKCE)

Tài liệu cho người làm **AI_Cinema_FE** (trang đăng nhập + trang đồng ý) và **AI_Cinema_StudioWeb** (client OAuth). Backend đã có đủ các endpoint dưới đây trên nhánh `feat/studio-oauth`.

## 1. Tổng quan

Studio Web là ứng dụng của bên thứ ba, nên không tự nhận mật khẩu của hãng phim. Hãng phim đăng nhập **trên domain AI Cinema**, đồng ý cấp quyền, rồi Studio Web đổi một mã dùng một lần lấy token.

- Chuẩn: OAuth 2.0 Authorization Code (RFC 6749) + PKCE S256 (RFC 7636), theo khuyến nghị RFC 9700.
- Client đã đăng ký: `client_id = studio-web`, `redirect_uri` so khớp **nguyên văn** (local: `http://localhost:3100/api/auth/callback`).
- Scope duy nhất: `studio:portal` — chỉ tài khoản role `STUDIO` thuộc một hãng phim đang hoạt động mới đồng ý được.
- Token Studio Web nhận được **chỉ gọi được API cổng Studio** (`/studio-portal/...`) và `GET /auth/me`. Gọi API khác sẽ bị `403 insufficient_scope`.
- Token gắn với hãng phim: khi tài khoản bị chuyển sang hãng khác hoặc hãng bị vô hiệu hoá, mọi token đang có bị từ chối ngay (`401 invalid_grant`). Hãng chỉ thấy dự án mà mình đang giữ hợp đồng (quy tắc sẵn có của `studio-portal`); khi Admin đổi Studio, dự án đó biến mất khỏi hãng cũ.

```
Studio Web ──(1) chuyển hướng──▶ AI_Cinema_FE /oauth/authorize?...
                                   │ (2) đăng nhập nếu chưa có phiên
                                   │ (3) GET  /api/oauth/authorize  → hiển thị màn hình đồng ý
                                   │ (4) POST /api/oauth/authorize  → { redirectTo }
Studio Web ◀─(5) redirect_uri?code=...&state=... ┘
Studio Web server ──(6) POST /api/oauth/token (code + code_verifier)──▶ BE → access + refresh token
```

## 2. Việc của Studio Web (client)

**(1) Bắt đầu đăng nhập** — tạo và lưu tạm (cookie httpOnly / session server):
- `state`: chuỗi ngẫu nhiên, chống CSRF.
- `code_verifier`: 43–128 ký tự `[A-Za-z0-9-._~]`.
- `code_challenge = BASE64URL(SHA256(code_verifier))` (không padding, đúng 43 ký tự).

Chuyển trình duyệt tới trang của AI_Cinema_FE:

```
{FE_URL}/oauth/authorize?response_type=code&client_id=studio-web
  &redirect_uri={đúng URI đã đăng ký}&scope=studio:portal
  &state={state}&code_challenge={challenge}&code_challenge_method=S256
```

**(5) Callback** `GET /api/auth/callback?code=...&state=...`:
- So `state` với giá trị đã lưu; lệch → dừng.
- Nếu có `error=access_denied` → hãng đã bấm Từ chối, hiển thị thông báo.

**(6) Đổi code lấy token — gọi từ server của Studio Web, không gọi từ trình duyệt:**

```http
POST {API_URL}/api/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&code=...&redirect_uri=...&code_verifier=...&client_id=studio-web
```

Nếu client có secret (production), gửi kèm `Authorization: Basic base64(client_id:client_secret)` hoặc `client_secret=...` trong form.

Kết quả:

```json
{ "access_token": "...", "token_type": "Bearer", "expires_in": 900, "refresh_token": "...", "scope": "studio:portal" }
```

- Mã `code` sống **60 giây** và chỉ dùng **một lần**. Dùng lại lần hai bị coi là bị đánh cắp: BE thu hồi mọi refresh token của Studio Web cho tài khoản đó.
- Gọi API: `Authorization: Bearer {access_token}`.
- Làm mới: `grant_type=refresh_token&refresh_token=...&client_id=studio-web` → nhận cặp token mới; refresh token cũ hết hiệu lực. **Không** dùng `/api/auth/refresh` cho token này (sẽ bị 401).
- Đăng xuất: `POST /api/oauth/revoke` với `token={refresh_token}&client_id=studio-web` (luôn trả 200).

## 3. Việc của AI_Cinema_FE (trang `/oauth/authorize`)

1. Đọc nguyên query từ URL. Nếu chưa đăng nhập: đưa sang trang đăng nhập hiện có, sau khi đăng nhập quay lại đúng URL này (giữ nguyên query).
2. Gọi `GET /api/oauth/authorize?{query}` với token phiên của FE. Kết quả:
   ```json
   {
     "client": { "clientId": "studio-web", "name": "Studio Web" },
     "scopes": [{ "scope": "studio:portal", "description": "Xem và ký hợp đồng, ..." }],
     "account": { "id": "...", "role": "STUDIO", "studioName": "Lumen Studio" },
     "redirectUri": "...", "state": "..."
   }
   ```
   Hiển thị: “**Studio Web** muốn truy cập tài khoản AI Cinema của **Lumen Studio**” + danh sách `description`, hai nút **Cho phép** / **Từ chối**.
3. Bấm nút → `POST /api/oauth/authorize` với body = toàn bộ query + `"approve": true|false`. Kết quả `{ "redirectTo": "..." }` → `window.location.assign(redirectTo)`.
4. Lỗi (JSON, **không** redirect) — hiển thị thông báo, không quay về Studio Web:

| `error` | Khi nào | Gợi ý hiển thị |
| :--- | :--- | :--- |
| `invalid_client` | `client_id` không tồn tại / bị tắt | Ứng dụng không hợp lệ |
| `invalid_request` | `redirect_uri` chưa đăng ký, thiếu PKCE S256, thiếu `state` | Yêu cầu đăng nhập không hợp lệ |
| `invalid_scope` | scope lạ | Yêu cầu quyền không hợp lệ |
| `unsupported_response_type` | `response_type` khác `code` | Yêu cầu đăng nhập không hợp lệ |
| `access_denied` (403) | Tài khoản không phải STUDIO, hoặc hãng phim đã ngừng hoạt động | Tài khoản này không dùng được cho Studio Web |

## 4. Endpoint tóm tắt

| Method | Đường dẫn | Ai gọi | Xác thực |
| :--- | :--- | :--- | :--- |
| GET | `/api/oauth/authorize` | AI_Cinema_FE | Bearer phiên FE |
| POST | `/api/oauth/authorize` | AI_Cinema_FE | Bearer phiên FE |
| POST | `/api/oauth/token` | Server Studio Web | client_id (+ secret nếu có) |
| POST | `/api/oauth/revoke` | Server Studio Web | client_id (+ secret nếu có) |
| GET | `/api/auth/me` | Studio Web | Bearer token OAuth |

Lỗi của `/oauth/*` theo dạng RFC: `{ "error": "...", "error_description": "..." }`, có `Cache-Control: no-store`.

## 5. Cấu hình & chuyển đổi

- BE `.env`: `OAUTH_STUDIO_WEB_CLIENT_ID`, `OAUTH_STUDIO_WEB_REDIRECT_URIS` (phân cách dấu phẩy), `OAUTH_STUDIO_WEB_CLIENT_SECRET` (bỏ trống = client public, chỉ PKCE), `OAUTH_CODE_TTL_SECONDS`. Chạy `npx prisma db seed` để đăng ký client.
- `POST /auth/login` vẫn hoạt động cho tới khi Studio Web chuyển hẳn sang OAuth; sau đó có thể chặn role `STUDIO` ở endpoint này.
