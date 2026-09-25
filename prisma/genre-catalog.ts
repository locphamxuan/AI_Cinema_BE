/**
 * Full genre catalog — TMDB/IMDb standard genres plus the ones Vietnamese
 * streaming platforms list separately (Võ thuật, Cổ trang, Thần thoại, Học đường).
 * Biography is intentionally absent: it requires depicting real people,
 * which BR-43 forbids for AI-generated content.
 *
 * styleKey names the genre's Genre Style LoRA (trigger keyword
 * `aicinema-<styleKey>-style`, dataset folder training-data/genre-styles/<slug>/…)
 * and styleBrief tells the team what reference images to collect for it
 * (PROJECT_OVERVIEW.md §4.1.8.1).
 */
export interface GenreCatalogEntry {
  name: string;
  description: string;
  styleKey: string;
  styleBrief: string;
}

export const GENRE_CATALOG: GenreCatalogEntry[] = [
  {
    name: 'Hành động',
    description: 'Phim nổi bật với các màn chiến đấu, truy đuổi, pha hành động và những tình huống kịch tính.',
    styleKey: 'action',
    styleBrief: 'High contrast, teal & orange grade, motion blur, low camera angles, smoke and dust, hard light',
  },
  {
    name: 'Phiêu lưu',
    description: 'Phim xoay quanh những chuyến hành trình, khám phá và các cuộc phiêu lưu đầy thử thách.',
    styleKey: 'adventure',
    styleBrief: 'Sweeping wide landscapes, golden hour, warm saturated colors, small figures against vast scenery',
  },
  {
    name: 'Hài',
    description: 'Phim tập trung vào sự hài hước, các tình huống vui nhộn và nhằm mang lại tiếng cười cho khán giả.',
    styleKey: 'comedy',
    styleBrief: 'Bright high-key lighting, cheerful saturated colors, clean symmetrical framing, few shadows',
  },
  {
    name: 'Tội phạm',
    description:
      'Phim xoay quanh tội phạm, điều tra, cảnh sát, các băng nhóm và những xung đột liên quan đến pháp luật.',
    styleKey: 'crime',
    styleBrief: 'Neo-noir, sodium streetlights, wet asphalt reflections, desaturated greens, venetian-blind shadows',
  },
  {
    name: 'Chính kịch',
    description: 'Phim tập trung vào cảm xúc, tâm lý nhân vật và những xung đột trong cuộc sống.',
    styleKey: 'drama',
    styleBrief: 'Naturalistic soft window light, muted palette, intimate close framing, shallow depth of field',
  },
  {
    name: 'Gia đình',
    description: 'Phim phù hợp với nhiều độ tuổi, thường xoay quanh gia đình, tình cảm và các giá trị nhân văn.',
    styleKey: 'family',
    styleBrief: 'Warm soft light, gentle pastel palette, cozy lived-in interiors, sunny outdoor scenes',
  },
  {
    name: 'Giả tưởng',
    description: 'Phim lấy bối cảnh trong những thế giới phép thuật, sinh vật huyền bí hoặc các hiện tượng siêu nhiên.',
    styleKey: 'fantasy',
    styleBrief: 'Ethereal glow, volumetric god rays, rich jewel tones, floating magical particles, enchanted forests',
  },
  {
    name: 'Kinh dị',
    description: 'Phim tạo cảm giác sợ hãi, bất an và căng thẳng thông qua các yếu tố kinh dị hoặc siêu nhiên.',
    styleKey: 'horror',
    styleBrief: 'Low-key lighting, deep shadows, cold blue-grey tones, fog, large dark negative space in frame',
  },
  {
    name: 'Bí ẩn',
    description: 'Phim xoay quanh những bí mật, vụ án hoặc sự kiện khó giải thích được hé lộ dần trong câu chuyện.',
    styleKey: 'mystery',
    styleBrief:
      'Chiaroscuro, isolated pools of lamp light, mist, muted amber and slate tones, partially hidden details',
  },
  {
    name: 'Lãng mạn',
    description: 'Phim tập trung vào tình yêu, các mối quan hệ và hành trình cảm xúc của nhân vật.',
    styleKey: 'romance',
    styleBrief: 'Soft diffusion, warm backlight, creamy bokeh, blush and pastel tones, dreamy golden hour',
  },
  {
    name: 'Khoa học viễn tưởng',
    description: 'Phim khai thác khoa học, công nghệ tương lai, trí tuệ nhân tạo, không gian hoặc những thực tại khác.',
    styleKey: 'scifi',
    styleBrief: 'Neon cyan & magenta, rim light, brushed metal surfaces, holograms, futuristic cityscapes',
  },
  {
    name: 'Giật gân',
    description:
      'Phim tạo ra sự hồi hộp và căng thẳng thông qua những tình tiết bất ngờ, nguy hiểm và các bước ngoặt trong cốt truyện.',
    styleKey: 'thriller',
    styleBrief: 'Cold desaturated grade, hard shadows, tight claustrophobic framing, dutch angles, sickly green tint',
  },
  {
    name: 'Tâm lý',
    description: 'Phim tập trung vào suy nghĩ, cảm xúc, hành vi và những biến chuyển tâm lý phức tạp của nhân vật.',
    styleKey: 'psychological',
    styleBrief: 'Surreal compositions, isolated subjects, warm/cold split lighting, mirrors and reflections',
  },
  {
    name: 'Lịch sử',
    description: 'Phim lấy cảm hứng từ hoặc tái hiện các sự kiện, nhân vật và giai đoạn lịch sử.',
    styleKey: 'history',
    styleBrief: 'Period-accurate settings, candle and natural light, earthy sepia tones, painterly composition',
  },
  {
    name: 'Tài liệu',
    description: 'Phim phi hư cấu trình bày con người, sự kiện, hiện tượng hoặc những câu chuyện có thật.',
    styleKey: 'documentary',
    styleBrief: 'Available natural light, handheld realism, neutral true-to-life grade, observational framing',
  },
  {
    name: 'Thể thao',
    description: 'Phim xoay quanh vận động viên, các cuộc thi, quá trình luyện tập và hành trình theo đuổi thành tích.',
    styleKey: 'sports',
    styleBrief: 'Stadium floodlights, frozen peak-action motion, sweat and texture detail, high saturation',
  },
  {
    name: 'Chiến tranh',
    description: 'Phim mô tả các cuộc chiến, xung đột vũ trang và ảnh hưởng của chiến tranh đến con người.',
    styleKey: 'war',
    styleBrief: 'Bleach-bypass desaturation, gritty texture, smoke and debris, overcast skies, muddy earth tones',
  },
  {
    name: 'Miền Tây',
    description:
      'Phim lấy bối cảnh miền Tây nước Mỹ, thường có cao bồi, thị trấn biên giới, kẻ ngoài vòng pháp luật và những cuộc đấu súng.',
    styleKey: 'western',
    styleBrief: 'Dusty sun-baked desert, warm ochre palette, harsh noon sun, wide frontier landscapes, long shadows',
  },
  {
    name: 'Nhạc kịch',
    description: 'Phim kết hợp âm nhạc, ca hát và vũ đạo trực tiếp vào quá trình kể chuyện.',
    styleKey: 'musical',
    styleBrief: 'Theatrical stage lighting, spotlights, vivid costume colors, choreographed wide ensemble shots',
  },
  {
    name: 'Hoạt hình',
    description: 'Phim được thể hiện bằng hình ảnh vẽ tay, đồ họa 2D/3D hoặc stop-motion thay vì người đóng.',
    styleKey: 'animation',
    styleBrief: 'Stylized 3D/2D illustration, clean shapes, cel shading, bright appealing palette, expressive staging',
  },
  {
    name: 'Võ thuật',
    description: 'Phim lấy các môn võ, cao thủ, môn phái và những trận đấu võ nghệ làm trọng tâm.',
    styleKey: 'martial-arts',
    styleBrief: 'Misty mountains, bamboo forests, flowing fabric in motion, dynamic poses, muted jade and ink tones',
  },
  {
    name: 'Cổ trang',
    description: 'Phim lấy bối cảnh thời phong kiến với trang phục, cung đình và lễ nghi cổ xưa.',
    styleKey: 'period',
    styleBrief: 'Palace interiors, silk costumes, paper lanterns, rich crimson and gold, symmetrical formal framing',
  },
  {
    name: 'Thần thoại',
    description: 'Phim dựa trên truyền thuyết, thần thoại và cổ tích với thần linh, yêu quái và phép thuật dân gian.',
    styleKey: 'mythology',
    styleBrief: 'Epic celestial skies, glowing auras, cloud-sea landscapes, ancient temples, gold and azure palette',
  },
  {
    name: 'Học đường',
    description: 'Phim xoay quanh tuổi học trò, trường lớp, tình bạn và những rung động tuổi mới lớn.',
    styleKey: 'school',
    styleBrief: 'Bright daylight, classrooms and school yards, fresh youthful pastels, soft lens flare, clean look',
  },
  {
    name: 'Siêu anh hùng',
    description: 'Phim về những nhân vật sở hữu năng lực phi thường bảo vệ thế giới khỏi các thế lực đe dọa.',
    styleKey: 'superhero',
    styleBrief: 'Heroic low angles, high-contrast saturated color, lens flares, dramatic skies, energy effects',
  },
  {
    name: 'Thảm họa',
    description: 'Phim mô tả thiên tai, sự cố quy mô lớn và cuộc chiến sinh tồn của con người trước thảm họa.',
    styleKey: 'disaster',
    styleBrief: 'Apocalyptic skies, orange-grey haze, massive scale destruction, debris in the air, tiny human figures',
  },
];

export const genreStyleTriggerKeyword = (styleKey: string) => `aicinema-${styleKey}-style`;
