# Phạm vi câu hỏi của Trợ lý AI cho Member

Trợ lý AI chỉ trả lời từ hai nguồn:
- **Knowledge Base** (KB): bài viết do Admin quản lý. Bài mẫu nằm ở `prisma/knowledge-seed-data.ts`.
- **Công cụ chỉ đọc**: dữ liệu của chính Member đang đăng nhập, lấy theo `memberId` của phiên. AI không chọn được `memberId`.

Câu trả lời không dựa trên một trong hai nguồn này sẽ bị cổng phạm vi `applyScopeGate()` thay bằng câu "ngoài phạm vi hỗ trợ". AI không tự hứa hoàn tiền, cộng Coin hay đổi gói; với những yêu cầu đó, AI chuyển ca cho Staff.

## Câu hỏi được hỗ trợ

| Nhóm | Ví dụ câu hỏi | Nguồn trả lời |
|---|---|---|
| Tài khoản | Đăng nhập Google thế nào? Đổi mật khẩu ở đâu? Quên mật khẩu? Vì sao tài khoản bị khoá? | KB `Tài khoản, đăng nhập Google và xác thực email` |
| Ví Coin | Tôi còn bao nhiêu Coin? Coin chính và Coin thưởng khác gì nhau? Coin thưởng của tôi khi nào hết hạn? | `get_member_wallet`; KB `Coin chính và Coin thưởng…` |
| Lịch sử giao dịch | Tuần này tôi tiêu Coin vào đâu? Giao dịch nào trừ 20 Coin? | `get_recent_coin_transactions` |
| Nạp Coin | Tôi nạp 100.000đ chưa thấy Coin? Lần nạp gần nhất thành công chưa? Nạp tối thiểu, tối đa bao nhiêu? | `get_recent_topups`, `get_recent_payments`, `get_platform_policy_snapshot`; KB `Nạp Coin qua VNPay` |
| Mở khoá tập | Tập 3 phim X giá bao nhiêu? Tôi đã mở tập này chưa, sao vẫn không xem được? Tôi đã mở những tập nào? | `search_catalog`, `get_episode_access`, `get_unlocked_episodes`; KB `Mua lẻ tập phim…` |
| Hoàn Coin | Tập tôi đã mua bị gỡ thì có được hoàn Coin không? | `get_unlocked_episodes` (thu hồi / hoàn); KB `Mua lẻ tập phim và hoàn Coin khi tập bị gỡ`, `Quy định hoàn tiền và khiếu nại` |
| Tập miễn phí | Phim nào có tập xem miễn phí? Khách chưa đăng nhập xem được tập nào? | `search_catalog` (cờ miễn phí); KB `Tập Free Starter và nội dung miễn phí` |
| Gói Tháng | Gói Tháng giá bao nhiêu, quyền lợi gì? Gói của tôi hết hạn khi nào? Hủy tự gia hạn trước bao lâu? | `get_plan_catalog`, `get_member_subscription`, `get_platform_policy_snapshot`; KB `Đăng ký, tự gia hạn và hủy gói` |
| Điểm danh, vòng quay | Hôm nay tôi điểm danh chưa? Chuỗi ngày của tôi đến đâu? Còn lượt quay không? | `get_reward_status`; KB `Điểm danh hằng ngày và vòng quay thưởng` |
| Thiết bị | Tôi đang đăng nhập trên những máy nào? Vì sao báo vượt số thiết bị? | `get_member_devices`, `get_recent_streaming_sessions`, `get_platform_policy_snapshot`; KB `Thiết bị đăng ký…` |
| Xem phim | Video giật, mờ, không phát? Sao có quảng cáo giữa tập? Tắt nhãn AI được không? Không mở được phim T18? | `get_recent_streaming_sessions`; KB `Lỗi phát video…`, `Quảng cáo khi xem phim`, `Nhãn nội dung do AI tạo`, `Phân loại độ tuổi và phim T18` |
| Phim trên AI Cinema | Phim nào đang nhiều lượt xem nhất? Có phim tình cảm Hàn nào không? Bao giờ có tập mới của phim X? | `get_trending_movies`, `search_catalog`, `get_upcoming_releases` |
| Đề xuất, lịch sử xem | Tôi nên xem phim gì tiếp? Vì sao lại gợi ý phim này? Tôi đang xem dở phim nào? | `get_my_recommendations`, `get_watch_history`; KB `Phim đề xuất cho bạn` |
| Xem nhóm, bạn bè | Tạo phòng xem chung thế nào? Bạn tôi chưa mua tập có vào được không? Chủ phòng mất mạng thì sao? | KB `Xem phim cùng nhóm (Watch Party)` |
| Gặp nhân viên | Tôi muốn nói chuyện với nhân viên. | Chuyển ca `MEMBER_REQUEST`, AI tóm tắt ca cho Staff |

## Câu hỏi ngoài phạm vi

AI từ chối các câu hỏi sau và nhắc lại phạm vi hỗ trợ:
- Nền tảng khác (Netflix, FPT Play…).
- Phim không có trên AI Cinema, hoặc xin link xem lậu.
- Kiến thức chung: tin tức, thời tiết, lập trình, bài tập.
- Thông tin của Member khác.
- Nội bộ sản xuất phim: hợp đồng Studio, chi phí sản xuất, kịch bản. Phần này chỉ dành cho role nội bộ.

## Cách kiểm thử

- Bộ đánh giá RAG gồm `rag-eval-answer-cases.ts` (27 ca trả lời) và `rag-eval-escalation-cases.ts`. Mỗi bài KB có ít nhất một ca.
- Cổng phạm vi được kiểm thử ở `scope-gate.spec.ts`.
- Các tool dữ liệu được kiểm thử ở `support-tools.service.spec.ts` và `activity-tools.spec.ts`.
