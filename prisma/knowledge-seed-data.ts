import { KnowledgeSource, SupportAudience } from '@prisma/client';

export interface SeedArticle {
  slug: string;
  title: string;
  category: string;
  audience: SupportAudience;
  source: KnowledgeSource;
  markdown: string;
}

export const SEED_ARTICLES: SeedArticle[] = [
  {
    slug: 'goi-dich-vu-va-quyen-loi',
    title: 'Các gói dịch vụ và quyền lợi',
    category: 'Plans',
    audience: SupportAudience.MEMBER,
    source: KnowledgeSource.PLAN,
    markdown: `## AI Cinema có những gói nào?
AI Cinema có gói Miễn phí (Free) cho mọi tài khoản và các gói trả phí theo tuần, tháng hoặc năm. Gói trả phí mở khóa toàn bộ tập phim đã phát hành trong thời gian gói còn hiệu lực, không cần mua lẻ từng tập.

## Quyền lợi của gói trả phí
- Xem không giới hạn các tập đã phát hành của mọi phim.
- Không cần dùng Coin để mở khóa từng tập.
- Số thiết bị đăng ký và số phiên xem đồng thời phụ thuộc vào gói đang dùng; xem thông tin gói trên màn hình Gói dịch vụ.
- Có thể bật hoặc tắt tự gia hạn bất cứ lúc nào trước thời hạn hủy.

## Gói Miễn phí xem được gì?
Tài khoản Miễn phí vẫn xem được các tập Free Starter của mỗi phim và các tập có giá 0 Coin. Muốn xem tiếp các tập khác, bạn có thể mua lẻ bằng Coin hoặc đăng ký gói trả phí.

## Làm sao biết gói nào phù hợp?
Mỗi gói hiển thị thời hạn, quyền lợi và giá Coin hiện tại trên màn hình Gói dịch vụ. Giá có thể thay đổi theo chính sách; giao dịch đã hoàn tất giữ nguyên giá tại thời điểm mua.`,
  },
  {
    slug: 'coin-main-va-coin-thuong',
    title: 'Coin chính và Coin thưởng khác nhau thế nào?',
    category: 'Coin',
    audience: SupportAudience.MEMBER,
    source: KnowledgeSource.POLICY,
    markdown: `## Hai loại Coin
AI Cinema dùng hai loại Coin trong cùng một ví:

- **Coin chính**: Coin bạn nhận từ việc nạp tiền. Coin chính không hết hạn.
- **Coin thưởng**: Coin tặng từ khuyến mãi, điểm danh, vòng quay may mắn hoặc các chương trình ưu đãi. Mỗi lô Coin thưởng có hạn dùng riêng.

## Thứ tự sử dụng
Khi mua tập phim hoặc thanh toán gói, hệ thống dùng Coin chính trước, sau đó mới đến Coin thưởng. Coin thưởng sắp hết hạn được dùng trước các lô còn hạn lâu hơn.

## Coin thưởng hết hạn
Coin thưởng hết hạn sẽ bị trừ khỏi ví và không được hoàn lại. Bạn xem hạn dùng của từng lô trong mục Ví Coin. Số ngày hết hạn của Coin thưởng do chính sách nền tảng quy định và có thể thay đổi theo từng chương trình.

## Kiểm tra số dư
Số dư Coin chính, Coin thưởng và hạn dùng của từng lô luôn hiển thị trong mục Ví Coin của ứng dụng. Nếu số dư hiển thị không khớp với giao dịch gần đây, hãy liên hệ nhân viên hỗ trợ kèm thời điểm và số Coin dự kiến.`,
  },
  {
    slug: 'nap-coin-qua-vnpay',
    title: 'Nạp Coin qua VNPay',
    category: 'Payments',
    audience: SupportAudience.MEMBER,
    source: KnowledgeSource.FAQ,
    markdown: `## Cách nạp Coin
1. Mở mục Ví Coin và chọn Nạp Coin.
2. Chọn số tiền VND muốn nạp trong khoảng hệ thống cho phép.
3. Xác nhận để chuyển sang cổng thanh toán VNPay.
4. Hoàn tất thanh toán trên ứng dụng VNPay hoặc trang của nhà cung cấp.

## Trạng thái đơn nạp
- **PENDING**: Đơn đã tạo nhưng cổng thanh toán chưa xác nhận. Coin chưa được cộng.
- **PAID**: Thanh toán thành công và Coin đã được cộng vào ví.
- **FAILED**: Thanh toán thất bại, Coin không được cộng.
- **CANCELLED**: Đơn đã bị hủy.
- **EXPIRED**: Đơn quá thời gian thanh toán và đã hết hiệu lực.

## Coin chưa vào sau khi thanh toán
Cổng thanh toán có thể cần vài phút để gửi kết quả về AI Cinema. Nếu đơn vẫn ở trạng thái PENDING sau khoảng 15 phút, hãy liên hệ nhân viên hỗ trợ và gửi kèm mã đơn nạp. Không gửi mật khẩu, mã OTP hay số thẻ cho bất kỳ ai, kể cả nhân viên.

## Lưu ý
Số Coin nhận được tính theo tỷ giá tại thời điểm tạo đơn; tỷ giá hiện tại hiển thị trên màn hình nạp Coin. Nạp Coin chỉ cộng Coin chính, trừ khi có chương trình khuyến mãi Coin thưởng đi kèm.`,
  },
  {
    slug: 'mua-tap-va-hoan-coin',
    title: 'Mua lẻ tập phim và hoàn Coin khi tập bị gỡ',
    category: 'Episodes',
    audience: SupportAudience.MEMBER,
    source: KnowledgeSource.POLICY,
    markdown: `## Mua lẻ một tập
Mỗi tập phim có giá Coin riêng, hiển thị trên trang phim và trang xem tập. Khi bạn xác nhận mua, Coin được trừ ngay và quyền xem tập được mở vĩnh viễn, kể cả khi sau đó bạn không còn gói trả phí.

## Quyền xem đã mua
Quyền xem đã mua không bị mất khi bạn hủy gói hoặc khi gói hết hạn. Bạn có thể kiểm tra trong mục Nội dung đã mua.

## Tập bị gỡ và hoàn Coin
Nếu một tập bạn đã mua bị gỡ vĩnh viễn vì lý do nội dung, hệ thống hoàn lại số Coin đã trả bằng Coin chính theo chính sách hoàn tiền của nền tảng. Thông báo hoàn Coin xuất hiện trong mục Thông báo và trong lịch sử giao dịch.

## Tập tạm ẩn để chỉnh sửa
Tập tạm ẩn để chỉnh sửa sẽ trở lại khi hoàn tất. Trường hợp này không hoàn Coin vì quyền xem vẫn còn hiệu lực sau khi tập được phát hành lại.

## Khi nào cần nhân viên hỗ trợ
Nếu bạn đã bị trừ Coin nhưng quyền xem chưa mở, hoặc số Coin hoàn không khớp với giá đã trả, hãy liên hệ nhân viên kèm tên phim, số tập và thời điểm mua.`,
  },
  {
    slug: 'dang-ky-gia-han-huy-goi',
    title: 'Đăng ký, tự gia hạn và hủy gói',
    category: 'Subscriptions',
    audience: SupportAudience.MEMBER,
    source: KnowledgeSource.POLICY,
    markdown: `## Đăng ký gói
Bạn thanh toán gói bằng Coin tại màn hình Gói dịch vụ. Khi giao dịch thành công, gói có hiệu lực ngay và thời hạn được tính từ thời điểm kích hoạt.

## Tự gia hạn
Gói có thể bật tự gia hạn. Đến ngày gia hạn, hệ thống tự trừ Coin theo giá đang áp dụng cho gói. Nếu ví không đủ Coin, gói chuyển sang trạng thái **PAST_DUE** và quyền xem tạm dừng; hệ thống sẽ thử lại trong thời gian ân hạn. Nạp thêm Coin trong thời gian này có thể khôi phục gói tự động.

## Hủy tự gia hạn
Bạn có thể tắt tự gia hạn trong mục Gói dịch vụ. Chỉ yêu cầu gửi trước thời hạn hủy hiển thị trên màn hình gói mới được áp dụng cho kỳ tiếp theo; yêu cầu sau thời hạn đó sẽ được áp dụng từ kỳ sau nữa. Gói vẫn dùng được đến hết kỳ đã trả.

## Gói hết hạn
Khi gói hết hạn, quyền xem theo gói dừng lại. Các tập đã mua lẻ bằng Coin vẫn xem được bình thường.

## Hoàn Coin cho gói
Gói đã kích hoạt không được hoàn Coin vì đã sử dụng quyền lợi, trừ trường hợp lỗi hệ thống được xác minh. Mọi điều chỉnh Coin phải do nhân viên có thẩm quyền thực hiện.`,
  },
  {
    slug: 'thiet-bi-va-phien-xem',
    title: 'Thiết bị đăng ký và số phiên xem đồng thời',
    category: 'Devices',
    audience: SupportAudience.MEMBER,
    source: KnowledgeSource.POLICY,
    markdown: `## Thiết bị đăng ký
Mỗi tài khoản có thể đăng ký một số thiết bị nhất định tùy theo gói. Thiết bị được nhận diện bằng mã cài đặt do ứng dụng tạo; gỡ ứng dụng hoặc đổi máy có thể tạo mã mới.

## Quản lý thiết bị
Mở mục Thiết bị để xem tên thiết bị, nền tảng và lần hoạt động gần nhất. Bạn có thể gỡ một thiết bị không còn dùng; thao tác này kết thúc các phiên xem đang mở trên thiết bị đó.

## Số phiên xem đồng thời
Số phiên xem cùng lúc phụ thuộc vào gói. Khi vượt giới hạn, phiên cũ có thể bị kết thúc để mở phiên mới. Đây không phải lỗi tài khoản.

## Phiên xem bị dừng
Phiên xem có thể kết thúc vì:
- Bạn dừng xem hoặc đóng trình phát.
- Phiên quá thời gian không có tín hiệu từ trình phát.
- Một thiết bị khác mở phiên mới vượt giới hạn.
- Tập phim được thay bằng phiên bản mới.

Nếu bạn bị dừng phiên liên tục dù chỉ xem trên một thiết bị, hãy liên hệ nhân viên kèm tên thiết bị và thời điểm xảy ra.`,
  },
  {
    slug: 'tai-khoan-dang-nhap-google',
    title: 'Tài khoản, đăng nhập Google và xác thực email',
    category: 'Account',
    audience: SupportAudience.MEMBER,
    source: KnowledgeSource.FAQ,
    markdown: `## Tạo tài khoản
Bạn có thể đăng ký bằng email hoặc đăng nhập bằng Google. Mỗi email chỉ dùng cho một tài khoản AI Cinema. Thành viên phải từ 18 tuổi trở lên.

## Đăng nhập bằng Google
Nếu bạn đã tạo tài khoản bằng email, hãy đăng nhập bằng email đó. Đăng nhập Google bằng một email khác sẽ tạo tài khoản riêng và không tự liên kết với tài khoản cũ.

## Quên mật khẩu
Dùng chức năng Quên mật khẩu trên màn hình đăng nhập. AI Cinema gửi liên kết đặt lại mật khẩu đến email đã đăng ký; liên kết có thời hạn. Nhân viên hỗ trợ không bao giờ hỏi mật khẩu, OTP hay số thẻ của bạn.

## Xác thực email
Một số tính năng yêu cầu email đã xác thực. Nếu chưa nhận được email xác thực, kiểm tra thư mục Spam và thử gửi lại. Nếu vẫn không nhận được, liên hệ nhân viên kèm địa chỉ email đăng ký.

## Đổi email hoặc số điện thoại
Thông tin tài khoản có thể thay đổi trong mục Hồ sơ. Một số thay đổi nhạy cảm cần nhân viên xác minh để tránh chiếm đoạt tài khoản.`,
  },
  {
    slug: 'quy-dinh-hoan-tien-khieu-nai',
    title: 'Quy định hoàn tiền và khiếu nại',
    category: 'Policy',
    audience: SupportAudience.MEMBER,
    source: KnowledgeSource.POLICY,
    markdown: `## Nguyên tắc chung
AI Cinema xem xét hoàn Coin cho các trường hợp lỗi hệ thống đã được xác minh hoặc nội dung bị gỡ vĩnh viễn. Giao dịch đã hoàn tất và đã sử dụng quyền lợi không được hoàn Coin theo yêu cầu.

## Các trường hợp được xem xét
- Bị trừ Coin nhưng quyền xem hoặc gói không được kích hoạt.
- Nạp Coin thành công nhưng Coin không vào ví sau thời gian chờ.
- Tập đã mua bị gỡ vĩnh viễn.
- Lỗi hệ thống dẫn đến trừ Coin hai lần cho cùng một giao dịch.

## Cách gửi khiếu nại
Liên hệ nhân viên hỗ trợ trong ứng dụng và cung cấp:
- Mã giao dịch hoặc mã đơn nạp.
- Thời điểm xảy ra.
- Số Coin hoặc số tiền dự kiến.
- Ảnh chụp màn hình nếu có.

Không gửi mật khẩu, mã OTP, số thẻ hoặc thông tin đăng nhập. Nhân viên sẽ không bao giờ yêu cầu những thông tin này.

## Thời gian xử lý
Khiếu nại được tiếp nhận và chuyển đến nhân viên phụ trách. Thời gian xử lý phụ thuộc vào việc cần đối soát với cổng thanh toán. Bạn sẽ nhận thông báo trong ứng dụng khi có kết quả. AI chỉ có thể hướng dẫn quy trình, không tự quyết định hoàn Coin.`,
  },
  {
    slug: 'loi-phat-video-va-chat-luong-hls',
    title: 'Lỗi phát video và chất lượng hình ảnh',
    category: 'Playback',
    audience: SupportAudience.MEMBER,
    source: KnowledgeSource.FAQ,
    markdown: `## Video không phát được
1. Kiểm tra kết nối mạng và thử tải lại trang hoặc mở lại ứng dụng.
2. Thử một tập khác để xác định lỗi do tập phim hay do thiết bị.
3. Cập nhật ứng dụng lên phiên bản mới nhất.
4. Nếu dùng trình duyệt, thử tắt tiện ích chặn quảng cáo cho AI Cinema.

## Hình ảnh mờ hoặc giật
Chất lượng HLS tự điều chỉnh theo băng thông. Khi mạng yếu, trình phát giảm độ phân giải để tránh dừng hình. Kết nối Wi-Fi ổn định hoặc mạng di động tốc độ cao sẽ cho hình ảnh tốt hơn.

## Âm thanh nhưng không có hình
Tắt chế độ tiết kiệm pin hoặc trình tăng tốc phần cứng của trình duyệt, sau đó mở lại trình phát. Trên một số thiết bị cũ, codec của phim có thể không được hỗ trợ.

## Tập phim báo không có quyền xem
- Tập Free Starter: kiểm tra bạn đang đăng nhập đúng tài khoản.
- Tập trả phí: mua lẻ bằng Coin hoặc đăng ký gói còn hiệu lực.
- Gói vừa hết hạn hoặc đang PAST_DUE: gia hạn hoặc nạp Coin để khôi phục.

## Khi nào cần nhân viên
Nếu một tập phát lỗi trên nhiều thiết bị và nhiều mạng khác nhau, hãy báo nhân viên kèm tên phim, số tập, thiết bị và mã lỗi hiển thị trên màn hình.`,
  },
  {
    slug: 'free-starter-va-noi-dung-mien-phi',
    title: 'Tập Free Starter và nội dung miễn phí',
    category: 'Episodes',
    audience: SupportAudience.MEMBER,
    source: KnowledgeSource.POLICY,
    markdown: `## Tập Free Starter là gì?
Trước khi phát hành, Admin chọn riêng từng tập là miễn phí cho Khách, miễn phí cho Thành viên, hoặc trả phí. Tập miễn phí cho Khách thì Thành viên cũng xem miễn phí. Các tập này gọi chung là Free Starter.

## Số tập miễn phí
Tập miễn phí không nhất thiết là các tập đầu và có thể khác nhau giữa các phim. Nhãn Free hiển thị trên danh sách tập; một tập có thể chỉ miễn phí khi bạn đã đăng nhập.

## Tập giá 0 Coin
Ngoài Free Starter, một số tập có giá 0 Coin và cũng xem được mà không cần gói trả phí.

## Xem tiếp các tập sau
Các tập không miễn phí cần mua lẻ bằng Coin hoặc xem bằng gói trả phí còn hiệu lực. Nếu bạn đang có gói mà vẫn bị yêu cầu mua, kiểm tra trạng thái gói trong mục Gói dịch vụ.

## Khách xem không cần tài khoản
Khách có thể xem Free Starter nhưng không có lịch sử xem, không nhận thông báo và không đồng bộ tiến độ giữa các thiết bị. Đăng nhập để lưu tiến độ và mở khóa nội dung đã mua.`,
  },
  {
    slug: 'xem-nhom-watch-party',
    title: 'Xem phim cùng nhóm (Watch Party)',
    category: 'Playback',
    audience: SupportAudience.MEMBER,
    source: KnowledgeSource.FAQ,
    markdown: `## Tạo và vào phòng
Trưởng phòng tạo phòng cho một tập phim và chia sẻ mã dạng XXX-XXX hoặc đường link mời. Mỗi phòng tối đa 8 người. Nhập sai mã phòng 5 lần trong 10 phút sẽ bị khóa nhập mã 15 phút.

## Quyền xem khi xem nhóm
Mỗi người trong phòng phải tự có quyền xem tập: tập miễn phí, đã mở khóa bằng Coin hoặc có gói Tháng còn hạn. Không có quyền thì ứng dụng mời bạn mở khóa bằng Coin hoặc nâng cấp gói trước khi vào phòng. Tập T18 chỉ dành cho tài khoản đủ 18 tuổi.

## Điều khiển phát
Chỉ Trưởng phòng được Phát, Tạm dừng và Tua. Thành viên tự chỉnh âm lượng, phụ đề và chat. Nếu mạng chậm, ứng dụng tự đuổi kịp Trưởng phòng.

## Khi Trưởng phòng mất kết nối
Phòng tạm dừng và chờ 45 giây. Quá thời gian, người vào phòng sớm nhất được chuyển làm Trưởng phòng. Nếu phòng bị tạm dừng quá 6 phút, các thành viên có thể bỏ phiếu chuyển quyền.

## Giới hạn thiết bị
Vào phòng cũng tính là một luồng phát. Nếu tài khoản đã đạt số thiết bị phát đồng thời của gói, hãy dừng phát trên thiết bị khác trong mục Thiết bị. Mỗi tài khoản chỉ có một kết nối trong một phòng; vào từ máy thứ hai sẽ ngắt máy thứ nhất.

## Gói hết hạn giữa chừng
Bạn được xem hết tập đang phát; sang tập tiếp theo cần gia hạn gói hoặc mở khóa tập.`,
  },
  {
    slug: 'de-xuat-phim',
    title: 'Phim đề xuất cho bạn',
    category: 'Catalog',
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
Phim nhãn T18 chỉ được đề xuất cho tài khoản đã xác nhận đủ 18 tuổi.`,
  },
  {
    slug: 'quang-cao-khi-xem',
    title: 'Quảng cáo khi xem phim',
    category: 'Playback',
    audience: SupportAudience.MEMBER,
    source: KnowledgeSource.FAQ,
    markdown: `## Khi nào có quảng cáo
Tài khoản không có gói Tháng có thể gặp quảng cáo giữa tập ở các vị trí Admin đặt sẵn. Gói Tháng xem không quảng cáo.

## Bỏ qua quảng cáo
Quảng cáo phải chạy hết mới tiếp tục tập phim. Nếu quảng cáo lỗi, hãy thoát và mở lại tập; tiến độ xem được giữ.`,
  },
  {
    slug: 'nhan-noi-dung-ai',
    title: 'Nhãn nội dung do AI tạo',
    category: 'Playback',
    audience: SupportAudience.MEMBER,
    source: KnowledgeSource.FAQ,
    markdown: `## Vì sao có nhãn AI trên video
Phim trên AI Cinema được tạo bằng trí tuệ nhân tạo. Theo Luật Trí tuệ nhân tạo và Nghị định hướng dẫn, nội dung do AI tạo phải được gắn nhãn rõ ràng khi phát, nên nhãn AI luôn hiện trên trình phát và không thể tắt.`,
  },
  {
    slug: 'do-tuoi-t18',
    title: 'Phân loại độ tuổi và phim T18',
    category: 'Account',
    audience: SupportAudience.MEMBER,
    source: KnowledgeSource.FAQ,
    markdown: `## Nhãn độ tuổi
Mỗi phim có nhãn P, T13, T16 hoặc T18. Phim T18 chỉ xem và chỉ được đề xuất cho tài khoản có ngày sinh đủ 18 tuổi.

## Không vào được phim T18
Kiểm tra ngày sinh trong hồ sơ. Khách chưa đăng nhập không xem được phim T18. Phòng xem nhóm cũng áp dụng quy định này cho từng người tham gia.`,
  },
  {
    slug: 'diem-danh-vong-quay',
    title: 'Điểm danh hằng ngày và vòng quay thưởng',
    category: 'Coin',
    audience: SupportAudience.MEMBER,
    source: KnowledgeSource.FAQ,
    markdown: `## Điểm danh
Mỗi ngày (theo giờ Việt Nam) bạn điểm danh một lần để nhận Coin thưởng theo chuỗi ngày liên tiếp. Bỏ một ngày thì chuỗi bắt đầu lại từ ngày 1.

## Vòng quay
Đạt mốc chuỗi điểm danh sẽ được lượt quay. Giải thưởng là Coin thưởng, có hạn dùng; Coin thưởng được dùng sau Coin chính khi mở khóa tập.

## Kiểm tra
Trợ lý AI có thể cho bạn biết hôm nay đã điểm danh chưa, chuỗi hiện tại và số lượt quay còn lại.`,
  },
];
