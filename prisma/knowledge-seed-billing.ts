import { KnowledgeSource, SupportAudience } from '@prisma/client';
import type { SeedArticle } from './knowledge-seed-data';

/** Plans, Coins, top-ups, refunds and rewards (MF-2). Numbers that an Admin can change stay out. */
export const BILLING_ARTICLES: SeedArticle[] = [
  {
    slug: 'goi-dich-vu-va-quyen-loi',
    title: 'Các gói dịch vụ và quyền lợi',
    category: 'Gói Tháng',
    audience: SupportAudience.MEMBER,
    source: KnowledgeSource.PLAN,
    markdown: `## AI Cinema có những gói nào?
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
Giá Coin của gói Tháng hiện trên màn hình Gói dịch vụ và có thể thay đổi theo chính sách; giao dịch đã hoàn tất giữ nguyên giá tại thời điểm mua.`,
  },
  {
    slug: 'coin-main-va-coin-thuong',
    title: 'Coin chính và Coin thưởng khác nhau thế nào?',
    category: 'Coin',
    audience: SupportAudience.MEMBER,
    source: KnowledgeSource.POLICY,
    markdown: `## Hai loại Coin
AI Cinema dùng hai loại Coin trong cùng một ví:

- **Coin chính**: Coin bạn nhận khi nạp tiền qua VNPay.
- **Coin thưởng**: Coin tặng từ điểm danh hằng ngày, vòng quay thưởng và quà chào mừng thành viên mới. Không thể nạp tiền để lấy Coin thưởng.

Coin chỉ dùng để mở khóa từng tập phim hoặc trả phí gói Tháng; không có mua trọn bộ phim.

## Thứ tự sử dụng
Khi mở khóa tập hoặc trả phí gói Tháng, hệ thống trừ Coin chính trước. Chỉ khi Coin chính không đủ, Coin thưởng mới bù phần còn thiếu. Coin thưởng nhận trước được dùng trước.

## Coin thưởng có hết hạn không?
Không. Cả Coin chính và Coin thưởng đều không hết hạn: Coin ở lại trong ví cho đến khi bạn dùng.

## Kiểm tra số dư
Số dư Coin chính, Coin thưởng và tổng Coin có thể dùng luôn hiển thị trong mục Ví Coin của ứng dụng. Nếu số dư không khớp với giao dịch gần đây, hãy liên hệ nhân viên hỗ trợ kèm thời điểm và số Coin dự kiến.`,
  },
  {
    slug: 'nap-coin-qua-vnpay',
    title: 'Nạp Coin qua VNPay',
    category: 'Nạp Coin',
    audience: SupportAudience.MEMBER,
    source: KnowledgeSource.FAQ,
    markdown: `## Cách nạp Coin
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
Số Coin nhận được tính theo tỷ giá tại thời điểm tạo đơn; tỷ giá hiện tại hiển thị trên màn hình nạp Coin. Nạp tiền chỉ cộng Coin chính.`,
  },
  {
    slug: 'mua-tap-va-hoan-coin',
    title: 'Mở khóa tập phim và hoàn Coin khi tập bị gỡ',
    category: 'Mở khóa tập',
    audience: SupportAudience.MEMBER,
    source: KnowledgeSource.POLICY,
    markdown: `## Mở khóa một tập
Mỗi tập phim có giá Coin riêng, hiển thị trên trang phim và trang xem tập. AI Cinema chỉ bán lẻ từng tập, không bán trọn bộ phim. Khi bạn xác nhận, màn hình cho biết dùng bao nhiêu Coin chính và Coin thưởng (Coin chính trước, Coin thưởng bù phần thiếu); Coin được trừ ngay và quyền xem tập được mở vĩnh viễn.

## Quyền xem đã mua
Quyền xem tập đã mở khóa bằng Coin không bị mất khi bạn hủy gói Tháng hoặc khi gói hết hạn. Bạn có thể kiểm tra trong mục Nội dung đã mua.

## Tập bị gỡ và hoàn Coin
Nếu một tập bạn đã mua bị gỡ hẳn, hệ thống tự hoàn lại đúng số Coin đã trả: phần Coin chính về Coin chính, phần Coin thưởng về Coin thưởng. Thông báo hoàn Coin xuất hiện trong mục Thông báo và trong lịch sử giao dịch.

## Tập tạm ẩn để chỉnh sửa
Tập tạm ẩn để chỉnh sửa sẽ trở lại khi hoàn tất. Trường hợp này không hoàn Coin vì quyền xem vẫn còn hiệu lực sau khi tập được phát hành lại.

## Khi nào cần nhân viên hỗ trợ
Nếu bạn đã bị trừ Coin nhưng quyền xem chưa mở, hoặc số Coin hoàn không khớp với giá đã trả, hãy liên hệ nhân viên kèm tên phim, số tập và thời điểm mua.`,
  },
  {
    slug: 'dang-ky-gia-han-huy-goi',
    title: 'Đăng ký, tự gia hạn và hủy gói Tháng',
    category: 'Gói Tháng',
    audience: SupportAudience.MEMBER,
    source: KnowledgeSource.POLICY,
    markdown: `## Đăng ký gói Tháng
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
Gói đã kích hoạt không được hoàn Coin, trừ trường hợp lỗi hệ thống được xác minh. Mọi điều chỉnh Coin phải do nhân viên có thẩm quyền thực hiện.`,
  },
  {
    slug: 'quy-dinh-hoan-tien-khieu-nai',
    title: 'Quy định hoàn Coin và khiếu nại',
    category: 'Hoàn Coin và khiếu nại',
    audience: SupportAudience.MEMBER,
    source: KnowledgeSource.POLICY,
    markdown: `## Nguyên tắc chung
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
Khiếu nại được chuyển đến nhân viên phụ trách. Thời gian xử lý phụ thuộc vào việc cần đối soát với VNPay. Bạn sẽ nhận thông báo trong ứng dụng khi có kết quả. Trợ lý AI chỉ hướng dẫn quy trình, không tự quyết định hoàn Coin.`,
  },
  {
    slug: 'diem-danh-vong-quay',
    title: 'Điểm danh hằng ngày và vòng quay thưởng',
    category: 'Điểm danh và vòng quay',
    audience: SupportAudience.MEMBER,
    source: KnowledgeSource.FAQ,
    markdown: `## Điểm danh
Mỗi ngày (tính theo giờ Việt Nam, sang ngày mới lúc 0 giờ) bạn điểm danh một lần để nhận Coin thưởng theo chuỗi ngày liên tiếp. Chuỗi có 7 ngày, hết ngày 7 thì quay lại ngày 1. Bỏ một ngày thì chuỗi bắt đầu lại từ ngày 1. Phần thưởng từng ngày do AI Cinema đặt và hiện trên màn hình điểm danh.

## Vòng quay
Ngày mốc của chuỗi điểm danh tặng thêm một lượt quay. Giải thưởng là Coin thưởng hoặc một số ngày gói Tháng. Ngày gói Tháng được cộng vào gói đang dùng; nếu chưa có gói thì mở gói Tháng đúng số ngày đó và không tự gia hạn.

## Coin thưởng nhận được
Coin thưởng từ điểm danh và vòng quay không hết hạn. Khi mở khóa tập hoặc trả phí gói, Coin chính được trừ trước, Coin thưởng bù phần thiếu.

## Kiểm tra
Trợ lý AI có thể cho bạn biết hôm nay đã điểm danh chưa, chuỗi hiện tại và số lượt quay còn lại.`,
  },
];
