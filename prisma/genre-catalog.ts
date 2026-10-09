/**
 * Full genre catalog — TMDB/IMDb standard genres plus the ones Vietnamese
 * streaming platforms list separately (Võ thuật, Cổ trang, Thần thoại, Học đường).
 * Biography is intentionally absent: it requires depicting real people,
 * which BR-43 forbids for AI-generated content.
 */
export interface GenreCatalogEntry {
  name: string;
  description: string;
}

export const GENRE_CATALOG: GenreCatalogEntry[] = [
  {
    name: 'Hành động',
    description: 'Phim nổi bật với các màn chiến đấu, truy đuổi, pha hành động và những tình huống kịch tính.',
  },
  {
    name: 'Phiêu lưu',
    description: 'Phim xoay quanh những chuyến hành trình, khám phá và các cuộc phiêu lưu đầy thử thách.',
  },
  {
    name: 'Hài',
    description: 'Phim tập trung vào sự hài hước, các tình huống vui nhộn và nhằm mang lại tiếng cười cho khán giả.',
  },
  {
    name: 'Tội phạm',
    description:
      'Phim xoay quanh tội phạm, điều tra, cảnh sát, các băng nhóm và những xung đột liên quan đến pháp luật.',
  },
  {
    name: 'Chính kịch',
    description: 'Phim tập trung vào cảm xúc, tâm lý nhân vật và những xung đột trong cuộc sống.',
  },
  {
    name: 'Gia đình',
    description: 'Phim phù hợp với nhiều độ tuổi, thường xoay quanh gia đình, tình cảm và các giá trị nhân văn.',
  },
  {
    name: 'Giả tưởng',
    description: 'Phim lấy bối cảnh trong những thế giới phép thuật, sinh vật huyền bí hoặc các hiện tượng siêu nhiên.',
  },
  {
    name: 'Kinh dị',
    description: 'Phim tạo cảm giác sợ hãi, bất an và căng thẳng thông qua các yếu tố kinh dị hoặc siêu nhiên.',
  },
  {
    name: 'Bí ẩn',
    description: 'Phim xoay quanh những bí mật, vụ án hoặc sự kiện khó giải thích được hé lộ dần trong câu chuyện.',
  },
  {
    name: 'Lãng mạn',
    description: 'Phim tập trung vào tình yêu, các mối quan hệ và hành trình cảm xúc của nhân vật.',
  },
  {
    name: 'Khoa học viễn tưởng',
    description: 'Phim khai thác khoa học, công nghệ tương lai, trí tuệ nhân tạo, không gian hoặc những thực tại khác.',
  },
  {
    name: 'Giật gân',
    description:
      'Phim tạo ra sự hồi hộp và căng thẳng thông qua những tình tiết bất ngờ, nguy hiểm và các bước ngoặt trong cốt truyện.',
  },
  {
    name: 'Tâm lý',
    description: 'Phim tập trung vào suy nghĩ, cảm xúc, hành vi và những biến chuyển tâm lý phức tạp của nhân vật.',
  },
  {
    name: 'Lịch sử',
    description: 'Phim lấy cảm hứng từ hoặc tái hiện các sự kiện, nhân vật và giai đoạn lịch sử.',
  },
  {
    name: 'Tài liệu',
    description: 'Phim phi hư cấu trình bày con người, sự kiện, hiện tượng hoặc những câu chuyện có thật.',
  },
  {
    name: 'Thể thao',
    description: 'Phim xoay quanh vận động viên, các cuộc thi, quá trình luyện tập và hành trình theo đuổi thành tích.',
  },
  {
    name: 'Chiến tranh',
    description: 'Phim mô tả các cuộc chiến, xung đột vũ trang và ảnh hưởng của chiến tranh đến con người.',
  },
  {
    name: 'Miền Tây',
    description:
      'Phim lấy bối cảnh miền Tây nước Mỹ, thường có cao bồi, thị trấn biên giới, kẻ ngoài vòng pháp luật và những cuộc đấu súng.',
  },
  {
    name: 'Nhạc kịch',
    description: 'Phim kết hợp âm nhạc, ca hát và vũ đạo trực tiếp vào quá trình kể chuyện.',
  },
  {
    name: 'Hoạt hình',
    description: 'Phim được thể hiện bằng hình ảnh vẽ tay, đồ họa 2D/3D hoặc stop-motion thay vì người đóng.',
  },
  {
    name: 'Võ thuật',
    description: 'Phim lấy các môn võ, cao thủ, môn phái và những trận đấu võ nghệ làm trọng tâm.',
  },
  {
    name: 'Cổ trang',
    description: 'Phim lấy bối cảnh thời phong kiến với trang phục, cung đình và lễ nghi cổ xưa.',
  },
  {
    name: 'Thần thoại',
    description: 'Phim dựa trên truyền thuyết, thần thoại và cổ tích với thần linh, yêu quái và phép thuật dân gian.',
  },
  {
    name: 'Học đường',
    description: 'Phim xoay quanh tuổi học trò, trường lớp, tình bạn và những rung động tuổi mới lớn.',
  },
  {
    name: 'Siêu anh hùng',
    description: 'Phim về những nhân vật sở hữu năng lực phi thường bảo vệ thế giới khỏi các thế lực đe dọa.',
  },
  {
    name: 'Thảm họa',
    description: 'Phim mô tả thiên tai, sự cố quy mô lớn và cuộc chiến sinh tồn của con người trước thảm họa.',
  },
];
