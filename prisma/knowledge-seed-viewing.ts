import { KnowledgeSource, SupportAudience } from '@prisma/client';
import type { SeedArticle } from './knowledge-seed-data';

/** Account, devices and watching (MF-3, MF-4). */
export const VIEWING_ARTICLES: SeedArticle[] = [
  {
    slug: 'thiet-bi-va-phien-xem',
    title: 'Thiết bị đăng ký và số thiết bị xem cùng lúc',
    category: 'Thiết bị',
    audience: SupportAudience.MEMBER,
    source: KnowledgeSource.POLICY,
    markdown: `## Thiết bị được hỗ trợ
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

Nếu bạn bị dừng phiên liên tục dù chỉ xem trên một thiết bị, hãy liên hệ nhân viên kèm tên thiết bị và thời điểm xảy ra.`,
  },
  {
    slug: 'tai-khoan-dang-nhap-google',
    title: 'Tài khoản, đăng nhập Google và quên mật khẩu',
    category: 'Tài khoản',
    audience: SupportAudience.MEMBER,
    source: KnowledgeSource.FAQ,
    markdown: `## Tạo tài khoản
Bạn có thể đăng ký bằng email và mật khẩu hoặc bằng tài khoản Google trên ứng dụng. Mỗi email chỉ dùng cho một tài khoản AI Cinema. Thành viên phải từ 18 tuổi trở lên.

## Đăng nhập bằng Google
Nếu email của bạn đã có tài khoản đăng ký bằng mật khẩu, hãy đăng nhập bằng mật khẩu; đăng nhập Google bằng email đó sẽ bị từ chối và không tự liên kết hai cách đăng nhập.

## Quên mật khẩu
Chọn Quên mật khẩu trên màn hình đăng nhập và nhập email. AI Cinema gửi mã OTP 6 số qua Gmail; mã dùng một lần, hết hạn sau 10 phút hoặc sau 5 lần nhập sai, và mỗi phút chỉ gửi được một mã. Đặt mật khẩu mới xong, mọi phiên đăng nhập cũ bị đăng xuất. Nhân viên hỗ trợ không bao giờ hỏi mật khẩu, OTP hay số thẻ của bạn.

## Không nhận được mã OTP
Kiểm tra thư mục Spam hoặc Quảng cáo, đợi một phút rồi gửi lại. Nếu vẫn không nhận được, liên hệ nhân viên kèm địa chỉ email đăng ký.

## Đổi thông tin tài khoản
Họ tên, số điện thoại và ngày sinh đổi trong mục Hồ sơ; mật khẩu đổi trong phần Đổi mật khẩu. Email đăng nhập không tự đổi được.`,
  },
  {
    slug: 'loi-phat-video-va-chat-luong-hls',
    title: 'Lỗi phát video và chất lượng hình ảnh',
    category: 'Xem phim',
    audience: SupportAudience.MEMBER,
    source: KnowledgeSource.FAQ,
    markdown: `## Video không phát được
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
Nếu một tập phát lỗi trên nhiều thiết bị và nhiều mạng khác nhau, hãy báo nhân viên kèm tên phim, số tập, thiết bị và thông báo lỗi hiện trên màn hình.`,
  },
  {
    slug: 'free-starter-va-noi-dung-mien-phi',
    title: 'Tập Free Starter và nội dung miễn phí',
    category: 'Mở khóa tập',
    audience: SupportAudience.MEMBER,
    source: KnowledgeSource.POLICY,
    markdown: `## Tập Free Starter là gì?
Trước khi phát hành, Admin chọn riêng từng tập là miễn phí cho Khách, miễn phí cho Thành viên, hoặc trả phí. Tập miễn phí cho Khách thì Thành viên cũng xem miễn phí. Các tập này gọi chung là Free Starter.

## Số tập miễn phí
Tập miễn phí không nhất thiết là các tập đầu và có thể khác nhau giữa các phim. Nhãn Free hiển thị trên danh sách tập; một tập có thể chỉ miễn phí khi bạn đã đăng nhập.

## Tập giá 0 Coin
Ngoài Free Starter, một số tập có giá 0 Coin và cũng xem được mà không cần gói Tháng.

## Xem tiếp các tập sau
Các tập không miễn phí cần mở khóa từng tập bằng Coin hoặc xem bằng gói Tháng còn hiệu lực. Nếu bạn đang có gói mà vẫn bị yêu cầu mở khóa, kiểm tra trạng thái gói trong mục Gói dịch vụ.

## Khách xem không cần tài khoản
Khách xem được các tập miễn phí cho Khách, có quảng cáo, nhưng không có lịch sử xem, không nhận thông báo và không đồng bộ tiến độ. Đăng nhập để lưu tiến độ và mở khóa thêm tập.`,
  },
  {
    slug: 'xem-nhom-watch-party',
    title: 'Xem phim cùng nhóm (Watch Party)',
    category: 'Xem phim',
    audience: SupportAudience.MEMBER,
    source: KnowledgeSource.FAQ,
    markdown: `## Tạo và vào phòng
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
Bạn được xem hết tập đang phát; sang tập tiếp theo cần gia hạn gói hoặc mở khóa tập.`,
  },
  {
    slug: 'de-xuat-phim',
    title: 'Phim đề xuất cho bạn',
    category: 'Phim và đề xuất',
    audience: SupportAudience.MEMBER,
    source: KnowledgeSource.FAQ,
    markdown: `## Cách đề xuất hoạt động
AI Cinema đọc cách bạn xem trong 90 ngày: phim bạn xem hết hoặc bấm thích được tính mạnh nhất, phim xem nhiều tập được tính vừa, phim bỏ giữa chừng được tính ít, còn phim mới vào đã thoát làm giảm điểm thể loại đó. Từ đó hệ thống chấm điểm thể loại và quốc gia hợp gu bạn, cộng với độ phổ biến và độ mới của phim. Mỗi phim đề xuất có kèm lý do, ví dụ "Hợp gu Hành động bạn hay xem hết".

## Sau khi xem xong một phim
Khi bạn xem hết tập cuối, khung "AI đề xuất cho bạn" hiện các phim giống phim vừa xem (cùng thể loại, cùng quốc gia) và hợp gu bạn. Trang chi tiết phim có mục "Phim tương tự".

## Cập nhật
Phim bạn đã mở hoặc đã thích không lặp lại. Danh sách được tính lại ngay khi bạn thích phim mới hoặc xem thêm.

## Khách chưa đăng nhập
Khách thấy danh sách phim thịnh hành và phim tương tự.

## Phim T18
Phim nhãn T18 chỉ được đề xuất cho tài khoản đã đủ 18 tuổi.`,
  },
  {
    slug: 'quang-cao-khi-xem',
    title: 'Quảng cáo khi xem phim',
    category: 'Xem phim',
    audience: SupportAudience.MEMBER,
    source: KnowledgeSource.FAQ,
    markdown: `## Khi nào có quảng cáo
Khách và tài khoản gói Free gặp quảng cáo giữa tập ở các vị trí Admin đặt sẵn. Gói Tháng xem không quảng cáo.

## Bỏ qua quảng cáo
Quảng cáo phải chạy hết mới hiện nút Bỏ qua quảng cáo để quay lại phim; tua qua mốc quảng cáo cũng không bỏ được quảng cáo. Nếu quảng cáo lỗi, hãy thoát và mở lại tập; tiến độ xem được giữ.`,
  },
  {
    slug: 'nhan-noi-dung-ai',
    title: 'Nhãn nội dung do AI tạo',
    category: 'Xem phim',
    audience: SupportAudience.MEMBER,
    source: KnowledgeSource.FAQ,
    markdown: `## Vì sao có nhãn AI trên video
Phim trên AI Cinema được tạo bằng trí tuệ nhân tạo. Theo Luật Trí tuệ nhân tạo và Nghị định hướng dẫn, nội dung do AI tạo phải được gắn nhãn rõ ràng khi phát, nên nhãn AI luôn hiện trên trình phát và không thể tắt.`,
  },
  {
    slug: 'do-tuoi-t18',
    title: 'Phân loại độ tuổi và phim T18',
    category: 'Tài khoản',
    audience: SupportAudience.MEMBER,
    source: KnowledgeSource.FAQ,
    markdown: `## Nhãn độ tuổi
Mỗi phim có nhãn P, T13, T16 hoặc T18. Phim T18 chỉ xem và chỉ được đề xuất cho tài khoản có ngày sinh đủ 18 tuổi.

## Không vào được phim T18
Kiểm tra ngày sinh trong hồ sơ. Khách chưa đăng nhập không xem được phim T18. Phòng xem nhóm cũng áp dụng quy định này cho từng người tham gia.`,
  },
];
