-- Support knowledge base: bring the seeded articles in line with the current business rules
-- (22/11/2026). Bonus Coins never expire (BR-82), VNPay only, monthly plan only, no whole-series
-- purchase, Main Coin before Bonus Coin (BR-27), refunds back to the same kind of Coin (BR-52),
-- Android only (BR-83), password reset by Gmail OTP (BR-53).
-- Topics (category) become the plain Vietnamese ones the Admin page filters by.
-- Idempotent: an article is rewritten only while its title, topic or text differs from the text below;
-- its chunks are then removed and it goes back to PENDING, so the knowledge index job (sweep every
-- minute) embeds the new text again. Missing slugs (fresh databases) are left alone.
-- Same text as prisma/knowledge-seed-billing.ts and prisma/knowledge-seed-viewing.ts.

WITH "changed" AS (
  UPDATE "support_knowledge_articles"
  SET "title" = $kb$Các gói dịch vụ và quyền lợi$kb$,
      "category" = $kb$Gói Tháng$kb$,
      "content_markdown" = $kb$## AI Cinema có những gói nào?
AI Cinema chỉ có hai gói: gói Free cho mọi tài khoản và gói Tháng trả bằng Coin. Không có gói tuần, gói năm hay gói mua trọn bộ phim. Gói Tháng mở khóa toàn bộ tập đã phát hành trong thời gian gói còn hiệu lực, không cần mua lẻ từng tập.

## Quyền lợi của gói Tháng
- Xem không giới hạn các tập đã phát hành của mọi phim.
- Không cần dùng Coin để mở khóa từng tập.
- Xem không có quảng cáo.
- Được đăng ký nhiều thiết bị và xem cùng lúc trên nhiều thiết bị hơn gói Free; con số cụ thể hiện trên màn hình Gói dịch vụ.
- Tự gia hạn mỗi tháng; muốn dừng thì tắt tự gia hạn trước kỳ gia hạn ít nhất 24 giờ.

## Gói Free xem được gì?
Tài khoản gói Free xem được các tập miễn phí (Free Starter) của mỗi phim và các tập có giá 0 Coin, có quảng cáo giữa tập. Muốn xem các tập khác, bạn mở khóa từng tập bằng Coin hoặc đăng ký gói Tháng.

## Giá gói
Giá Coin của gói Tháng hiện trên màn hình Gói dịch vụ và có thể thay đổi theo chính sách; giao dịch đã hoàn tất giữ nguyên giá tại thời điểm mua.$kb$,
      "content_hash" = '026bcd46daa111609346eff9a2395e634cc15076cf9b7e2b869ce13ed357274d',
      "version" = "version" + 1,
      "index_status" = 'PENDING',
      "index_error" = NULL,
      "indexed_at" = NULL,
      "updated_at" = now()
  WHERE "slug" = 'goi-dich-vu-va-quyen-loi' AND "locale" = 'vi'
    AND ("title" <> $kb$Các gói dịch vụ và quyền lợi$kb$ OR "category" <> $kb$Gói Tháng$kb$
      OR encode(sha256(convert_to("content_markdown", 'UTF8')), 'hex') <> '026bcd46daa111609346eff9a2395e634cc15076cf9b7e2b869ce13ed357274d')
  RETURNING "id"
)
DELETE FROM "support_knowledge_chunks" WHERE "article_id" IN (SELECT "id" FROM "changed");

WITH "changed" AS (
  UPDATE "support_knowledge_articles"
  SET "title" = $kb$Coin chính và Coin thưởng khác nhau thế nào?$kb$,
      "category" = $kb$Coin$kb$,
      "content_markdown" = $kb$## Hai loại Coin
AI Cinema dùng hai loại Coin trong cùng một ví:

- **Coin chính**: Coin bạn nhận khi nạp tiền qua VNPay.
- **Coin thưởng**: Coin tặng từ điểm danh hằng ngày, vòng quay thưởng và quà chào mừng thành viên mới. Không thể nạp tiền để lấy Coin thưởng.

Coin chỉ dùng để mở khóa từng tập phim hoặc trả phí gói Tháng; không có mua trọn bộ phim.

## Thứ tự sử dụng
Khi mở khóa tập hoặc trả phí gói Tháng, hệ thống trừ Coin chính trước. Chỉ khi Coin chính không đủ, Coin thưởng mới bù phần còn thiếu. Coin thưởng nhận trước được dùng trước.

## Coin thưởng có hết hạn không?
Không. Cả Coin chính và Coin thưởng đều không hết hạn: Coin ở lại trong ví cho đến khi bạn dùng.

## Kiểm tra số dư
Số dư Coin chính, Coin thưởng và tổng Coin có thể dùng luôn hiển thị trong mục Ví Coin của ứng dụng. Nếu số dư không khớp với giao dịch gần đây, hãy liên hệ nhân viên hỗ trợ kèm thời điểm và số Coin dự kiến.$kb$,
      "content_hash" = '9d8171f959191564ff7c243c4094f6ee8be9d5b8895b94bf2358d31a5c427287',
      "version" = "version" + 1,
      "index_status" = 'PENDING',
      "index_error" = NULL,
      "indexed_at" = NULL,
      "updated_at" = now()
  WHERE "slug" = 'coin-main-va-coin-thuong' AND "locale" = 'vi'
    AND ("title" <> $kb$Coin chính và Coin thưởng khác nhau thế nào?$kb$ OR "category" <> $kb$Coin$kb$
      OR encode(sha256(convert_to("content_markdown", 'UTF8')), 'hex') <> '9d8171f959191564ff7c243c4094f6ee8be9d5b8895b94bf2358d31a5c427287')
  RETURNING "id"
)
DELETE FROM "support_knowledge_chunks" WHERE "article_id" IN (SELECT "id" FROM "changed");

WITH "changed" AS (
  UPDATE "support_knowledge_articles"
  SET "title" = $kb$Nạp Coin qua VNPay$kb$,
      "category" = $kb$Nạp Coin$kb$,
      "content_markdown" = $kb$## Cách nạp Coin
AI Cinema chỉ nhận nạp Coin qua VNPay; không có MoMo hay ví điện tử khác.
1. Mở mục Ví Coin và chọn Nạp Coin.
2. Chọn số tiền VND muốn nạp trong khoảng hệ thống cho phép.
3. Xác nhận để chuyển sang cổng thanh toán VNPay.
4. Hoàn tất thanh toán trên ứng dụng VNPay hoặc trang của ngân hàng.

## Trạng thái đơn nạp
- **Đang chờ (PENDING)**: Đơn đã tạo nhưng VNPay chưa xác nhận. Coin chưa được cộng.
- **Thành công (PAID)**: Thanh toán thành công và Coin chính đã được cộng vào ví.
- **Thất bại (FAILED)**: Thanh toán thất bại, Coin không được cộng.
- **Đã hủy (CANCELLED)**: Đơn đã bị hủy.
- **Hết hạn (EXPIRED)**: Đơn không được thanh toán trong 15 phút và đã hết hiệu lực; hãy tạo đơn mới.

## Coin chưa vào sau khi thanh toán
VNPay có thể cần vài phút để gửi kết quả về AI Cinema. Nếu đơn vẫn đang chờ sau khoảng 15 phút, hãy liên hệ nhân viên hỗ trợ và gửi kèm mã đơn nạp. Không gửi mật khẩu, mã OTP hay số thẻ cho bất kỳ ai, kể cả nhân viên.

## Lưu ý
Số Coin nhận được tính theo tỷ giá tại thời điểm tạo đơn; tỷ giá hiện tại hiển thị trên màn hình nạp Coin. Nạp tiền chỉ cộng Coin chính.$kb$,
      "content_hash" = '012019ae98813c07cf29e40efc6b07288cb23fef41ce749b3d97f7ca58b78d1d',
      "version" = "version" + 1,
      "index_status" = 'PENDING',
      "index_error" = NULL,
      "indexed_at" = NULL,
      "updated_at" = now()
  WHERE "slug" = 'nap-coin-qua-vnpay' AND "locale" = 'vi'
    AND ("title" <> $kb$Nạp Coin qua VNPay$kb$ OR "category" <> $kb$Nạp Coin$kb$
      OR encode(sha256(convert_to("content_markdown", 'UTF8')), 'hex') <> '012019ae98813c07cf29e40efc6b07288cb23fef41ce749b3d97f7ca58b78d1d')
  RETURNING "id"
)
DELETE FROM "support_knowledge_chunks" WHERE "article_id" IN (SELECT "id" FROM "changed");

WITH "changed" AS (
  UPDATE "support_knowledge_articles"
  SET "title" = $kb$Mở khóa tập phim và hoàn Coin khi tập bị gỡ$kb$,
      "category" = $kb$Mở khóa tập$kb$,
      "content_markdown" = $kb$## Mở khóa một tập
Mỗi tập phim có giá Coin riêng, hiển thị trên trang phim và trang xem tập. AI Cinema chỉ bán lẻ từng tập, không bán trọn bộ phim. Khi bạn xác nhận, màn hình cho biết dùng bao nhiêu Coin chính và Coin thưởng (Coin chính trước, Coin thưởng bù phần thiếu); Coin được trừ ngay và quyền xem tập được mở vĩnh viễn.

## Quyền xem đã mua
Quyền xem tập đã mở khóa bằng Coin không bị mất khi bạn hủy gói Tháng hoặc khi gói hết hạn. Bạn có thể kiểm tra trong mục Nội dung đã mua.

## Tập bị gỡ và hoàn Coin
Nếu một tập bạn đã mua bị gỡ hẳn, hệ thống tự hoàn lại đúng số Coin đã trả: phần Coin chính về Coin chính, phần Coin thưởng về Coin thưởng. Thông báo hoàn Coin xuất hiện trong mục Thông báo và trong lịch sử giao dịch.

## Tập tạm ẩn để chỉnh sửa
Tập tạm ẩn để chỉnh sửa sẽ trở lại khi hoàn tất. Trường hợp này không hoàn Coin vì quyền xem vẫn còn hiệu lực sau khi tập được phát hành lại.

## Khi nào cần nhân viên hỗ trợ
Nếu bạn đã bị trừ Coin nhưng quyền xem chưa mở, hoặc số Coin hoàn không khớp với giá đã trả, hãy liên hệ nhân viên kèm tên phim, số tập và thời điểm mua.$kb$,
      "content_hash" = 'ee1868b38ee020c48b5ec923b45f5817f89f1fba56463369e57e8ea395d036fa',
      "version" = "version" + 1,
      "index_status" = 'PENDING',
      "index_error" = NULL,
      "indexed_at" = NULL,
      "updated_at" = now()
  WHERE "slug" = 'mua-tap-va-hoan-coin' AND "locale" = 'vi'
    AND ("title" <> $kb$Mở khóa tập phim và hoàn Coin khi tập bị gỡ$kb$ OR "category" <> $kb$Mở khóa tập$kb$
      OR encode(sha256(convert_to("content_markdown", 'UTF8')), 'hex') <> 'ee1868b38ee020c48b5ec923b45f5817f89f1fba56463369e57e8ea395d036fa')
  RETURNING "id"
)
DELETE FROM "support_knowledge_chunks" WHERE "article_id" IN (SELECT "id" FROM "changed");

WITH "changed" AS (
  UPDATE "support_knowledge_articles"
  SET "title" = $kb$Đăng ký, tự gia hạn và hủy gói Tháng$kb$,
      "category" = $kb$Gói Tháng$kb$,
      "content_markdown" = $kb$## Đăng ký gói Tháng
Bạn trả phí gói Tháng bằng Coin tại màn hình Gói dịch vụ (Coin chính trước, Coin thưởng bù phần thiếu). Khi giao dịch thành công, gói có hiệu lực ngay trong một tháng.

## Tự gia hạn
Gói Tháng tự gia hạn: đến ngày gia hạn, hệ thống tự trừ Coin theo giá đang áp dụng. Nếu ví không đủ Coin, gói chuyển sang trạng thái chờ thanh toán (PAST_DUE) và hệ thống thử trừ lại trong thời gian ân hạn; nạp thêm Coin trong thời gian này giúp gói tự khôi phục. Hết thời gian ân hạn mà vẫn thiếu Coin thì gói hết hạn và bạn về gói Free.

## Tắt tự gia hạn
Bạn tắt tự gia hạn trong mục Gói dịch vụ. Phải tắt trước kỳ gia hạn ít nhất 24 giờ; sau mốc 24 giờ đó, kỳ tới vẫn bị trừ Coin. Màn hình gói cho biết bạn đang ở trước hay sau mốc này. Gói vẫn dùng được đến hết kỳ đã trả.

## Hủy gói ngay
Bạn cũng có thể hủy gói ngay trong mục Gói dịch vụ. Gói dừng ngay lúc hủy và không hoàn Coin cho phần thời gian còn lại.

## Gói hết hạn
Khi gói hết hạn, quyền xem theo gói dừng lại và bạn về gói Free. Các tập đã mở khóa bằng Coin vẫn xem được bình thường.

## Hoàn Coin cho gói
Gói đã kích hoạt không được hoàn Coin, trừ trường hợp lỗi hệ thống được xác minh. Mọi điều chỉnh Coin phải do nhân viên có thẩm quyền thực hiện.$kb$,
      "content_hash" = '6ac4ae2d2cd56355a1eecbec03a267f8e2d34d4b818a98dc9d4413a2c322326b',
      "version" = "version" + 1,
      "index_status" = 'PENDING',
      "index_error" = NULL,
      "indexed_at" = NULL,
      "updated_at" = now()
  WHERE "slug" = 'dang-ky-gia-han-huy-goi' AND "locale" = 'vi'
    AND ("title" <> $kb$Đăng ký, tự gia hạn và hủy gói Tháng$kb$ OR "category" <> $kb$Gói Tháng$kb$
      OR encode(sha256(convert_to("content_markdown", 'UTF8')), 'hex') <> '6ac4ae2d2cd56355a1eecbec03a267f8e2d34d4b818a98dc9d4413a2c322326b')
  RETURNING "id"
)
DELETE FROM "support_knowledge_chunks" WHERE "article_id" IN (SELECT "id" FROM "changed");

WITH "changed" AS (
  UPDATE "support_knowledge_articles"
  SET "title" = $kb$Quy định hoàn Coin và khiếu nại$kb$,
      "category" = $kb$Hoàn Coin và khiếu nại$kb$,
      "content_markdown" = $kb$## Nguyên tắc chung
AI Cinema xem xét hoàn Coin cho các trường hợp lỗi hệ thống đã được xác minh hoặc tập phim bị gỡ hẳn. Giao dịch đã hoàn tất và đã sử dụng quyền lợi không được hoàn Coin theo yêu cầu. Coin hoàn về đúng loại đã trừ (Coin chính hoặc Coin thưởng).

## Các trường hợp được xem xét
- Bị trừ Coin nhưng quyền xem hoặc gói không được kích hoạt.
- Nạp Coin thành công nhưng Coin không vào ví sau thời gian chờ.
- Tập đã mua bị gỡ hẳn.
- Lỗi hệ thống dẫn đến trừ Coin hai lần cho cùng một giao dịch.

## Cách gửi khiếu nại
Liên hệ nhân viên hỗ trợ trong ứng dụng và cung cấp:
- Mã giao dịch hoặc mã đơn nạp.
- Thời điểm xảy ra.
- Số Coin hoặc số tiền dự kiến.
- Ảnh chụp màn hình nếu có.

Không gửi mật khẩu, mã OTP, số thẻ hoặc thông tin đăng nhập. Nhân viên sẽ không bao giờ yêu cầu những thông tin này.

## Thời gian xử lý
Khiếu nại được chuyển đến nhân viên phụ trách. Thời gian xử lý phụ thuộc vào việc cần đối soát với VNPay. Bạn sẽ nhận thông báo trong ứng dụng khi có kết quả. Trợ lý AI chỉ hướng dẫn quy trình, không tự quyết định hoàn Coin.$kb$,
      "content_hash" = 'f860f469e44320d84c70b85b48022bdb872f48772ac5e189e0730b349314706d',
      "version" = "version" + 1,
      "index_status" = 'PENDING',
      "index_error" = NULL,
      "indexed_at" = NULL,
      "updated_at" = now()
  WHERE "slug" = 'quy-dinh-hoan-tien-khieu-nai' AND "locale" = 'vi'
    AND ("title" <> $kb$Quy định hoàn Coin và khiếu nại$kb$ OR "category" <> $kb$Hoàn Coin và khiếu nại$kb$
      OR encode(sha256(convert_to("content_markdown", 'UTF8')), 'hex') <> 'f860f469e44320d84c70b85b48022bdb872f48772ac5e189e0730b349314706d')
  RETURNING "id"
)
DELETE FROM "support_knowledge_chunks" WHERE "article_id" IN (SELECT "id" FROM "changed");

WITH "changed" AS (
  UPDATE "support_knowledge_articles"
  SET "title" = $kb$Điểm danh hằng ngày và vòng quay thưởng$kb$,
      "category" = $kb$Điểm danh và vòng quay$kb$,
      "content_markdown" = $kb$## Điểm danh
Mỗi ngày (tính theo giờ Việt Nam, sang ngày mới lúc 0 giờ) bạn điểm danh một lần để nhận Coin thưởng theo chuỗi ngày liên tiếp. Chuỗi có 7 ngày, hết ngày 7 thì quay lại ngày 1. Bỏ một ngày thì chuỗi bắt đầu lại từ ngày 1. Phần thưởng từng ngày do AI Cinema đặt và hiện trên màn hình điểm danh.

## Vòng quay
Ngày mốc của chuỗi điểm danh tặng thêm một lượt quay. Giải thưởng là Coin thưởng hoặc một số ngày gói Tháng. Ngày gói Tháng được cộng vào gói đang dùng; nếu chưa có gói thì mở gói Tháng đúng số ngày đó và không tự gia hạn.

## Coin thưởng nhận được
Coin thưởng từ điểm danh và vòng quay không hết hạn. Khi mở khóa tập hoặc trả phí gói, Coin chính được trừ trước, Coin thưởng bù phần thiếu.

## Kiểm tra
Trợ lý AI có thể cho bạn biết hôm nay đã điểm danh chưa, chuỗi hiện tại và số lượt quay còn lại.$kb$,
      "content_hash" = '835b6ff7808fbb6c55328e3d64a4b34a8eb5d79e4a8828eecf937027b04958bc',
      "version" = "version" + 1,
      "index_status" = 'PENDING',
      "index_error" = NULL,
      "indexed_at" = NULL,
      "updated_at" = now()
  WHERE "slug" = 'diem-danh-vong-quay' AND "locale" = 'vi'
    AND ("title" <> $kb$Điểm danh hằng ngày và vòng quay thưởng$kb$ OR "category" <> $kb$Điểm danh và vòng quay$kb$
      OR encode(sha256(convert_to("content_markdown", 'UTF8')), 'hex') <> '835b6ff7808fbb6c55328e3d64a4b34a8eb5d79e4a8828eecf937027b04958bc')
  RETURNING "id"
)
DELETE FROM "support_knowledge_chunks" WHERE "article_id" IN (SELECT "id" FROM "changed");

WITH "changed" AS (
  UPDATE "support_knowledge_articles"
  SET "title" = $kb$Thiết bị đăng ký và số thiết bị xem cùng lúc$kb$,
      "category" = $kb$Thiết bị$kb$,
      "content_markdown" = $kb$## Thiết bị được hỗ trợ
Thành viên xem phim trên ứng dụng AI Cinema cho điện thoại Android. Máy tính, iPhone và thiết bị khác chưa được hỗ trợ để xem phim bằng tài khoản thành viên.

## Thiết bị đăng ký
Mỗi tài khoản đăng ký được một số thiết bị nhất định, tùy gói Free hay gói Tháng; con số cụ thể hiện trên màn hình Gói dịch vụ. Gỡ ứng dụng rồi cài lại có thể được tính là thiết bị mới.

## Quản lý thiết bị
Mở mục Thiết bị để xem tên thiết bị và lần hoạt động gần nhất. Bạn có thể gỡ thiết bị không còn dùng; thao tác này kết thúc phiên xem đang mở trên thiết bị đó.

## Số thiết bị xem cùng lúc
Số thiết bị xem cùng lúc cũng tùy gói. Khi đã đủ số, ứng dụng không mở thêm phiên xem mới; bạn cần dừng xem trên thiết bị khác hoặc gỡ thiết bị trong mục Thiết bị rồi thử lại. Đây không phải lỗi tài khoản.

## Phiên xem bị dừng
Phiên xem có thể kết thúc vì:
- Bạn dừng xem hoặc đóng trình phát.
- Ứng dụng mất kết nối quá lâu.
- Thiết bị bị gỡ khỏi tài khoản.
- Tập phim được thay bằng phiên bản mới.

Nếu bạn bị dừng phiên liên tục dù chỉ xem trên một thiết bị, hãy liên hệ nhân viên kèm tên thiết bị và thời điểm xảy ra.$kb$,
      "content_hash" = 'b23a08ccaeafb71077946176064efbed4e44753f68bb55d1bcb47ffce872744a',
      "version" = "version" + 1,
      "index_status" = 'PENDING',
      "index_error" = NULL,
      "indexed_at" = NULL,
      "updated_at" = now()
  WHERE "slug" = 'thiet-bi-va-phien-xem' AND "locale" = 'vi'
    AND ("title" <> $kb$Thiết bị đăng ký và số thiết bị xem cùng lúc$kb$ OR "category" <> $kb$Thiết bị$kb$
      OR encode(sha256(convert_to("content_markdown", 'UTF8')), 'hex') <> 'b23a08ccaeafb71077946176064efbed4e44753f68bb55d1bcb47ffce872744a')
  RETURNING "id"
)
DELETE FROM "support_knowledge_chunks" WHERE "article_id" IN (SELECT "id" FROM "changed");

WITH "changed" AS (
  UPDATE "support_knowledge_articles"
  SET "title" = $kb$Tài khoản, đăng nhập Google và quên mật khẩu$kb$,
      "category" = $kb$Tài khoản$kb$,
      "content_markdown" = $kb$## Tạo tài khoản
Bạn có thể đăng ký bằng email và mật khẩu hoặc bằng tài khoản Google trên ứng dụng. Mỗi email chỉ dùng cho một tài khoản AI Cinema. Thành viên phải từ 18 tuổi trở lên.

## Đăng nhập bằng Google
Nếu email của bạn đã có tài khoản đăng ký bằng mật khẩu, hãy đăng nhập bằng mật khẩu; đăng nhập Google bằng email đó sẽ bị từ chối và không tự liên kết hai cách đăng nhập.

## Quên mật khẩu
Chọn Quên mật khẩu trên màn hình đăng nhập và nhập email. AI Cinema gửi mã OTP 6 số qua Gmail; mã dùng một lần, hết hạn sau 10 phút hoặc sau 5 lần nhập sai, và mỗi phút chỉ gửi được một mã. Đặt mật khẩu mới xong, mọi phiên đăng nhập cũ bị đăng xuất. Nhân viên hỗ trợ không bao giờ hỏi mật khẩu, OTP hay số thẻ của bạn.

## Không nhận được mã OTP
Kiểm tra thư mục Spam hoặc Quảng cáo, đợi một phút rồi gửi lại. Nếu vẫn không nhận được, liên hệ nhân viên kèm địa chỉ email đăng ký.

## Đổi thông tin tài khoản
Họ tên, số điện thoại và ngày sinh đổi trong mục Hồ sơ; mật khẩu đổi trong phần Đổi mật khẩu. Email đăng nhập không tự đổi được.$kb$,
      "content_hash" = '86e7a9ebe86530395c30613def1233f7157300ac87dd5fc2c39f07965a762a9b',
      "version" = "version" + 1,
      "index_status" = 'PENDING',
      "index_error" = NULL,
      "indexed_at" = NULL,
      "updated_at" = now()
  WHERE "slug" = 'tai-khoan-dang-nhap-google' AND "locale" = 'vi'
    AND ("title" <> $kb$Tài khoản, đăng nhập Google và quên mật khẩu$kb$ OR "category" <> $kb$Tài khoản$kb$
      OR encode(sha256(convert_to("content_markdown", 'UTF8')), 'hex') <> '86e7a9ebe86530395c30613def1233f7157300ac87dd5fc2c39f07965a762a9b')
  RETURNING "id"
)
DELETE FROM "support_knowledge_chunks" WHERE "article_id" IN (SELECT "id" FROM "changed");

WITH "changed" AS (
  UPDATE "support_knowledge_articles"
  SET "title" = $kb$Lỗi phát video và chất lượng hình ảnh$kb$,
      "category" = $kb$Xem phim$kb$,
      "content_markdown" = $kb$## Video không phát được
1. Kiểm tra kết nối mạng và mở lại ứng dụng.
2. Thử một tập khác để xác định lỗi do tập phim hay do thiết bị.
3. Cập nhật ứng dụng lên phiên bản mới nhất.
4. Kiểm tra số thiết bị đang xem cùng lúc chưa vượt giới hạn của gói.

## Hình ảnh mờ hoặc giật
Chất lượng video tự điều chỉnh theo tốc độ mạng. Khi mạng yếu, trình phát giảm độ phân giải để tránh dừng hình. Wi-Fi ổn định hoặc mạng di động tốc độ cao cho hình ảnh tốt hơn. Bạn cũng có thể chọn chất lượng trong phần Cài đặt của trình phát, trong giới hạn của gói.

## Có tiếng nhưng không có hình
Tắt chế độ tiết kiệm pin rồi mở lại trình phát. Trên một số điện thoại cũ, định dạng video có thể không được hỗ trợ.

## Tập phim báo không có quyền xem
- Tập miễn phí: kiểm tra bạn đang đăng nhập đúng tài khoản.
- Tập trả phí: mở khóa bằng Coin hoặc đăng ký gói Tháng còn hiệu lực.
- Gói Tháng vừa hết hạn hoặc đang chờ thanh toán: nạp Coin để gói tự gia hạn lại, hoặc đăng ký lại.

## Khi nào cần nhân viên
Nếu một tập phát lỗi trên nhiều thiết bị và nhiều mạng khác nhau, hãy báo nhân viên kèm tên phim, số tập, thiết bị và thông báo lỗi hiện trên màn hình.$kb$,
      "content_hash" = '01dfdb0f5f19363b7b244c670aa65e4d4112589cff380117daa373255ee921ce',
      "version" = "version" + 1,
      "index_status" = 'PENDING',
      "index_error" = NULL,
      "indexed_at" = NULL,
      "updated_at" = now()
  WHERE "slug" = 'loi-phat-video-va-chat-luong-hls' AND "locale" = 'vi'
    AND ("title" <> $kb$Lỗi phát video và chất lượng hình ảnh$kb$ OR "category" <> $kb$Xem phim$kb$
      OR encode(sha256(convert_to("content_markdown", 'UTF8')), 'hex') <> '01dfdb0f5f19363b7b244c670aa65e4d4112589cff380117daa373255ee921ce')
  RETURNING "id"
)
DELETE FROM "support_knowledge_chunks" WHERE "article_id" IN (SELECT "id" FROM "changed");

WITH "changed" AS (
  UPDATE "support_knowledge_articles"
  SET "title" = $kb$Tập Free Starter và nội dung miễn phí$kb$,
      "category" = $kb$Mở khóa tập$kb$,
      "content_markdown" = $kb$## Tập Free Starter là gì?
Trước khi phát hành, Admin chọn riêng từng tập là miễn phí cho Khách, miễn phí cho Thành viên, hoặc trả phí. Tập miễn phí cho Khách thì Thành viên cũng xem miễn phí. Các tập này gọi chung là Free Starter.

## Số tập miễn phí
Tập miễn phí không nhất thiết là các tập đầu và có thể khác nhau giữa các phim. Nhãn Free hiển thị trên danh sách tập; một tập có thể chỉ miễn phí khi bạn đã đăng nhập.

## Tập giá 0 Coin
Ngoài Free Starter, một số tập có giá 0 Coin và cũng xem được mà không cần gói Tháng.

## Xem tiếp các tập sau
Các tập không miễn phí cần mở khóa từng tập bằng Coin hoặc xem bằng gói Tháng còn hiệu lực. Nếu bạn đang có gói mà vẫn bị yêu cầu mở khóa, kiểm tra trạng thái gói trong mục Gói dịch vụ.

## Khách xem không cần tài khoản
Khách xem được các tập miễn phí cho Khách, có quảng cáo, nhưng không có lịch sử xem, không nhận thông báo và không đồng bộ tiến độ. Đăng nhập để lưu tiến độ và mở khóa thêm tập.$kb$,
      "content_hash" = '80cb349fed9014b498a2b71d4604e33d9f1cba5efef205470bfd941470a74079',
      "version" = "version" + 1,
      "index_status" = 'PENDING',
      "index_error" = NULL,
      "indexed_at" = NULL,
      "updated_at" = now()
  WHERE "slug" = 'free-starter-va-noi-dung-mien-phi' AND "locale" = 'vi'
    AND ("title" <> $kb$Tập Free Starter và nội dung miễn phí$kb$ OR "category" <> $kb$Mở khóa tập$kb$
      OR encode(sha256(convert_to("content_markdown", 'UTF8')), 'hex') <> '80cb349fed9014b498a2b71d4604e33d9f1cba5efef205470bfd941470a74079')
  RETURNING "id"
)
DELETE FROM "support_knowledge_chunks" WHERE "article_id" IN (SELECT "id" FROM "changed");

WITH "changed" AS (
  UPDATE "support_knowledge_articles"
  SET "title" = $kb$Xem phim cùng nhóm (Watch Party)$kb$,
      "category" = $kb$Xem phim$kb$,
      "content_markdown" = $kb$## Tạo và vào phòng
Trưởng phòng tạo phòng cho một tập phim và chia sẻ mã dạng XXX-XXX hoặc đường link mời. Mỗi phòng tối đa 8 người. Nhập sai mã phòng 5 lần trong 10 phút sẽ bị khóa nhập mã 15 phút.

## Quyền xem khi xem nhóm
Mỗi người trong phòng phải tự có quyền xem tập: tập miễn phí, đã mở khóa bằng Coin hoặc có gói Tháng còn hạn. Không có quyền thì ứng dụng mời bạn mở khóa bằng Coin hoặc đăng ký gói Tháng trước khi vào phòng. Tập T18 chỉ dành cho tài khoản đủ 18 tuổi.

## Điều khiển phát
Chỉ Trưởng phòng được Phát, Tạm dừng và Tua. Thành viên tự chỉnh âm lượng, phụ đề và chat. Nếu mạng chậm, ứng dụng tự đuổi kịp Trưởng phòng.

## Khi Trưởng phòng mất kết nối
Phòng tạm dừng và chờ 45 giây. Quá thời gian, người vào phòng sớm nhất được chuyển làm Trưởng phòng. Nếu phòng bị tạm dừng quá 6 phút, các thành viên có thể bỏ phiếu chuyển quyền.

## Giới hạn thiết bị
Vào phòng cũng tính là một thiết bị đang xem. Nếu tài khoản đã đủ số thiết bị xem cùng lúc của gói, hãy dừng xem trên thiết bị khác. Mỗi tài khoản chỉ có một kết nối trong một phòng; vào từ máy thứ hai sẽ ngắt máy thứ nhất.

## Gói hết hạn giữa chừng
Bạn được xem hết tập đang phát; sang tập tiếp theo cần gia hạn gói hoặc mở khóa tập.$kb$,
      "content_hash" = 'cd9a55b4e1d92680460ba7c04fa8c66e2f6d4d651f972f7063f31f087a03ff93',
      "version" = "version" + 1,
      "index_status" = 'PENDING',
      "index_error" = NULL,
      "indexed_at" = NULL,
      "updated_at" = now()
  WHERE "slug" = 'xem-nhom-watch-party' AND "locale" = 'vi'
    AND ("title" <> $kb$Xem phim cùng nhóm (Watch Party)$kb$ OR "category" <> $kb$Xem phim$kb$
      OR encode(sha256(convert_to("content_markdown", 'UTF8')), 'hex') <> 'cd9a55b4e1d92680460ba7c04fa8c66e2f6d4d651f972f7063f31f087a03ff93')
  RETURNING "id"
)
DELETE FROM "support_knowledge_chunks" WHERE "article_id" IN (SELECT "id" FROM "changed");

WITH "changed" AS (
  UPDATE "support_knowledge_articles"
  SET "title" = $kb$Phim đề xuất cho bạn$kb$,
      "category" = $kb$Phim và đề xuất$kb$,
      "content_markdown" = $kb$## Cách đề xuất hoạt động
AI Cinema đọc cách bạn xem trong 90 ngày: phim bạn xem hết hoặc bấm thích được tính mạnh nhất, phim xem nhiều tập được tính vừa, phim bỏ giữa chừng được tính ít, còn phim mới vào đã thoát làm giảm điểm thể loại đó. Từ đó hệ thống chấm điểm thể loại và quốc gia hợp gu bạn, cộng với độ phổ biến và độ mới của phim. Mỗi phim đề xuất có kèm lý do, ví dụ "Hợp gu Hành động bạn hay xem hết".

## Sau khi xem xong một phim
Khi bạn xem hết tập cuối, khung "AI đề xuất cho bạn" hiện các phim giống phim vừa xem (cùng thể loại, cùng quốc gia) và hợp gu bạn. Trang chi tiết phim có mục "Phim tương tự".

## Cập nhật
Phim bạn đã mở hoặc đã thích không lặp lại. Danh sách được tính lại ngay khi bạn thích phim mới hoặc xem thêm.

## Khách chưa đăng nhập
Khách thấy danh sách phim thịnh hành và phim tương tự.

## Phim T18
Phim nhãn T18 chỉ được đề xuất cho tài khoản đã đủ 18 tuổi.$kb$,
      "content_hash" = '0fb8172dde524cd832f899d7c0b12ac10bcba5e72e40b8b94c0d5827374b2614',
      "version" = "version" + 1,
      "index_status" = 'PENDING',
      "index_error" = NULL,
      "indexed_at" = NULL,
      "updated_at" = now()
  WHERE "slug" = 'de-xuat-phim' AND "locale" = 'vi'
    AND ("title" <> $kb$Phim đề xuất cho bạn$kb$ OR "category" <> $kb$Phim và đề xuất$kb$
      OR encode(sha256(convert_to("content_markdown", 'UTF8')), 'hex') <> '0fb8172dde524cd832f899d7c0b12ac10bcba5e72e40b8b94c0d5827374b2614')
  RETURNING "id"
)
DELETE FROM "support_knowledge_chunks" WHERE "article_id" IN (SELECT "id" FROM "changed");

WITH "changed" AS (
  UPDATE "support_knowledge_articles"
  SET "title" = $kb$Quảng cáo khi xem phim$kb$,
      "category" = $kb$Xem phim$kb$,
      "content_markdown" = $kb$## Khi nào có quảng cáo
Khách và tài khoản gói Free gặp quảng cáo giữa tập ở các vị trí Admin đặt sẵn. Gói Tháng xem không quảng cáo.

## Bỏ qua quảng cáo
Quảng cáo phải chạy hết mới hiện nút Bỏ qua quảng cáo để quay lại phim; tua qua mốc quảng cáo cũng không bỏ được quảng cáo. Nếu quảng cáo lỗi, hãy thoát và mở lại tập; tiến độ xem được giữ.$kb$,
      "content_hash" = 'ec10ae2bbba0ce9dd55752953022dd0a40f4d79785c1628bba43e36c53f18747',
      "version" = "version" + 1,
      "index_status" = 'PENDING',
      "index_error" = NULL,
      "indexed_at" = NULL,
      "updated_at" = now()
  WHERE "slug" = 'quang-cao-khi-xem' AND "locale" = 'vi'
    AND ("title" <> $kb$Quảng cáo khi xem phim$kb$ OR "category" <> $kb$Xem phim$kb$
      OR encode(sha256(convert_to("content_markdown", 'UTF8')), 'hex') <> 'ec10ae2bbba0ce9dd55752953022dd0a40f4d79785c1628bba43e36c53f18747')
  RETURNING "id"
)
DELETE FROM "support_knowledge_chunks" WHERE "article_id" IN (SELECT "id" FROM "changed");

WITH "changed" AS (
  UPDATE "support_knowledge_articles"
  SET "title" = $kb$Nhãn nội dung do AI tạo$kb$,
      "category" = $kb$Xem phim$kb$,
      "content_markdown" = $kb$## Vì sao có nhãn AI trên video
Phim trên AI Cinema được tạo bằng trí tuệ nhân tạo. Theo Luật Trí tuệ nhân tạo và Nghị định hướng dẫn, nội dung do AI tạo phải được gắn nhãn rõ ràng khi phát, nên nhãn AI luôn hiện trên trình phát và không thể tắt.$kb$,
      "content_hash" = 'd6f3fc499b3f8965efea42d208f4bb786750acdf514af08cc4fdf31171251193',
      "version" = "version" + 1,
      "index_status" = 'PENDING',
      "index_error" = NULL,
      "indexed_at" = NULL,
      "updated_at" = now()
  WHERE "slug" = 'nhan-noi-dung-ai' AND "locale" = 'vi'
    AND ("title" <> $kb$Nhãn nội dung do AI tạo$kb$ OR "category" <> $kb$Xem phim$kb$
      OR encode(sha256(convert_to("content_markdown", 'UTF8')), 'hex') <> 'd6f3fc499b3f8965efea42d208f4bb786750acdf514af08cc4fdf31171251193')
  RETURNING "id"
)
DELETE FROM "support_knowledge_chunks" WHERE "article_id" IN (SELECT "id" FROM "changed");

WITH "changed" AS (
  UPDATE "support_knowledge_articles"
  SET "title" = $kb$Phân loại độ tuổi và phim T18$kb$,
      "category" = $kb$Tài khoản$kb$,
      "content_markdown" = $kb$## Nhãn độ tuổi
Mỗi phim có nhãn P, T13, T16 hoặc T18. Phim T18 chỉ xem và chỉ được đề xuất cho tài khoản có ngày sinh đủ 18 tuổi.

## Không vào được phim T18
Kiểm tra ngày sinh trong hồ sơ. Khách chưa đăng nhập không xem được phim T18. Phòng xem nhóm cũng áp dụng quy định này cho từng người tham gia.$kb$,
      "content_hash" = '21167434c842f7788cddc51cc022d921fbf730630d882419587441217240f7fb',
      "version" = "version" + 1,
      "index_status" = 'PENDING',
      "index_error" = NULL,
      "indexed_at" = NULL,
      "updated_at" = now()
  WHERE "slug" = 'do-tuoi-t18' AND "locale" = 'vi'
    AND ("title" <> $kb$Phân loại độ tuổi và phim T18$kb$ OR "category" <> $kb$Tài khoản$kb$
      OR encode(sha256(convert_to("content_markdown", 'UTF8')), 'hex') <> '21167434c842f7788cddc51cc022d921fbf730630d882419587441217240f7fb')
  RETURNING "id"
)
DELETE FROM "support_knowledge_chunks" WHERE "article_id" IN (SELECT "id" FROM "changed");
