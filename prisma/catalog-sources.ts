/**
 * AI films for the demo catalog, all from Wikimedia Commons under a licence that allows reuse
 * (public domain or CC BY / CC BY 3.0 / 4.0, which only ask for attribution: author, licence and source
 * are stored with every episode). Picked by hand: no real-person likeness, politics, ads or third-party music.
 * Fetched from the Commons API on 2026-10-03.
 */

export interface CatalogEpisodeSource {
  title: string;
  synopsis: string;
  aiTools: string[];
  /** Commons file name. */
  file: string;
  url: string;
  thumb: string;
  page: string;
  duration: number;
  width: number;
  height: number;
  size: number;
  license: string;
  licenseUrl: string | null;
  artist: string;
}

export interface CatalogMovieSource {
  title: string;
  synopsis: string;
  genres: string[];
  ageRating: 'T16' | 'T18' | null;
  releaseYear: number;
  episodes: CatalogEpisodeSource[];
}

export const CATALOG_SOURCES: CatalogMovieSource[] = [
  {
    title: 'EXECUTE',
    genres: ['Khoa học viễn tưởng', 'Giật gân'],
    ageRating: 'T16',
    releaseYear: 2023,
    synopsis:
      'Phim ngắn khoa học viễn tưởng u tối: trong một thế giới do máy móc điều hành, lệnh "thực thi" cuối cùng sắp được ban ra.',
    episodes: [
      {
        file: 'EXECUTE -- dark Sci-Fi AI-short film.webm',
        title: 'EXECUTE',
        synopsis: 'Toàn bộ phim ngắn. Hình ảnh tạo bằng Runway Gen-2, âm thanh tổng hợp bằng AI.',
        aiTools: ['Runway Gen-2'],
        url: 'https://upload.wikimedia.org/wikipedia/commons/8/8c/EXECUTE_--_dark_Sci-Fi_AI-short_film.webm?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original',
        thumb:
          'https://thumb.wikimedia.org/wikipedia/commons/thumb/8/8c/EXECUTE_--_dark_Sci-Fi_AI-short_film.webm/960px--EXECUTE_--_dark_Sci-Fi_AI-short_film.webm.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo',
        page: 'https://commons.wikimedia.org/wiki/File:EXECUTE_--_dark_Sci-Fi_AI-short_film.webm',
        duration: 603,
        width: 1920,
        height: 1080,
        size: 481690068,
        license: 'CC BY 3.0',
        licenseUrl: 'https://creativecommons.org/licenses/by/3.0',
        artist: 'Vincent Chang Deng',
      },
    ],
  },
  {
    title: 'Lịch Sử Trái Đất',
    genres: ['Tài liệu', 'Lịch sử'],
    ageRating: null,
    releaseYear: 2024,
    synopsis: 'Phim tài liệu dựng bằng AI kể lại hành trình hình thành sự sống trên Trái Đất.',
    episodes: [
      {
        file: 'History of Earth E2 - The Origin of Life - The First Microbes 4k - see how life on Earth was born.webm',
        title: 'Nguồn gốc sự sống — những vi sinh vật đầu tiên',
        synopsis: 'Sự sống đầu tiên trên Trái Đất, 4,54–4,0 tỷ năm trước, tái hiện bằng hình ảnh AI.',
        aiTools: ['AI video generation'],
        url: 'https://upload.wikimedia.org/wikipedia/commons/f/f1/History_of_Earth_E2_-_The_Origin_of_Life_-_The_First_Microbes_4k_-_see_how_life_on_Earth_was_born.webm?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original',
        thumb:
          'https://thumb.wikimedia.org/wikipedia/commons/thumb/f/f1/History_of_Earth_E2_-_The_Origin_of_Life_-_The_First_Microbes_4k_-_see_how_life_on_Earth_was_born.webm/960px--History_of_Earth_E2_-_The_Origin_of_Life_-_The_First_Microbes_4k_-_see_how_life_on_Earth_was_born.webm.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo',
        page: 'https://commons.wikimedia.org/wiki/File:History_of_Earth_E2_-_The_Origin_of_Life_-_The_First_Microbes_4k_-_see_how_life_on_Earth_was_born.webm',
        duration: 506,
        width: 1800,
        height: 1080,
        size: 311771550,
        license: 'CC BY 3.0',
        licenseUrl: 'https://creativecommons.org/licenses/by/3.0',
        artist: 'Global Science Inc.',
      },
    ],
  },
  {
    title: 'Le Temple — Ngôi Đền',
    genres: ['Kinh dị', 'Bí ẩn'],
    ageRating: 'T16',
    releaseYear: 2024,
    synopsis:
      'Truyện kinh dị của H.P. Lovecraft (đọc tiếng Pháp) kèm hình ảnh tạo bằng AI: một chiếc tàu ngầm Đức năm 1915 trôi dạt tới một ngôi đền dưới đáy biển.',
    episodes: [
      {
        file: '"Le Temple" Une nouvelle fantastique de H.P. Lovecraft - Livre audio.webm',
        title: 'Le Temple',
        synopsis: 'Bản đọc tiếng Pháp toàn truyện, minh hoạ bằng hình ảnh AI.',
        aiTools: ['AI image generation'],
        url: 'https://upload.wikimedia.org/wikipedia/commons/7/7d/%22Le_Temple%22_Une_nouvelle_fantastique_de_H.P._Lovecraft_-_Livre_audio.webm?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original',
        thumb:
          'https://thumb.wikimedia.org/wikipedia/commons/thumb/7/7d/%22Le_Temple%22_Une_nouvelle_fantastique_de_H.P._Lovecraft_-_Livre_audio.webm/960px--%22Le_Temple%22_Une_nouvelle_fantastique_de_H.P._Lovecraft_-_Livre_audio.webm.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo',
        page: 'https://commons.wikimedia.org/wiki/File:%22Le_Temple%22_Une_nouvelle_fantastique_de_H.P._Lovecraft_-_Livre_audio.webm',
        duration: 2215,
        width: 1920,
        height: 1080,
        size: 126999496,
        license: 'CC BY 4.0',
        licenseUrl: 'https://creativecommons.org/licenses/by/4.0',
        artist: 'Eric Hansen - Fantastique et Science-Fiction',
      },
    ],
  },
  {
    title: 'Tuyển Tập Phim Ngắn AI',
    genres: ['Hoạt hình', 'Hài', 'Chính kịch'],
    ageRating: null,
    releaseYear: 2025,
    synopsis: 'Những phim ngắn làm hoàn toàn bằng công cụ AI: từ hài văn phòng tới câu chuyện môi trường.',
    episodes: [
      {
        file: 'POOF (AI Short Film).webm',
        title: 'POOF',
        synopsis: 'Ở những ô làm việc vô hồn của Corpo-Tech, áp lực cứ tăng dần… cho tới khi mọi thứ nổ tung.',
        aiTools: ['Luma Dream Machine'],
        url: 'https://upload.wikimedia.org/wikipedia/commons/2/29/POOF_%28AI_Short_Film%29.webm?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original',
        thumb:
          'https://thumb.wikimedia.org/wikipedia/commons/thumb/2/29/POOF_%28AI_Short_Film%29.webm/960px--POOF_%28AI_Short_Film%29.webm.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo',
        page: 'https://commons.wikimedia.org/wiki/File:POOF_(AI_Short_Film).webm',
        duration: 59,
        width: 1920,
        height: 1080,
        size: 19259240,
        license: 'Public domain',
        licenseUrl: null,
        artist: 'Pizza Later',
      },
      {
        file: 'The Forgotten Aral – An AI-generated visual history of a vanished sea (2025).webm',
        title: 'Biển Aral bị lãng quên',
        synopsis: 'Tái hiện thảm hoạ môi trường khiến biển Aral gần như biến mất.',
        aiTools: ['Sora', 'Krea AI', 'Hailuo AI', 'Kling AI'],
        url: 'https://upload.wikimedia.org/wikipedia/commons/b/b8/The_Forgotten_Aral_%E2%80%93_An_AI-generated_visual_history_of_a_vanished_sea_%282025%29.webm?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original',
        thumb:
          'https://thumb.wikimedia.org/wikipedia/commons/thumb/b/b8/The_Forgotten_Aral_%E2%80%93_An_AI-generated_visual_history_of_a_vanished_sea_%282025%29.webm/960px--The_Forgotten_Aral_%E2%80%93_An_AI-generated_visual_history_of_a_vanished_sea_%282025%29.webm.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo',
        page: 'https://commons.wikimedia.org/wiki/File:The_Forgotten_Aral_%E2%80%93_An_AI-generated_visual_history_of_a_vanished_sea_(2025).webm',
        duration: 98,
        width: 1280,
        height: 718,
        size: 20096158,
        license: 'Public domain',
        licenseUrl: null,
        artist:
          'Sora.chatgpt.org, Krea AI, Hailuo AI, Kling AI, ChatGPT This work was created using multiple AI tools. Scene writing and',
      },
      {
        file: 'МАБОЙЧИКИ - Трейлер - Мультфильм (2024).webm',
        title: 'MABOYCHIKI (trailer)',
        synopsis: 'Trailer phim hoạt hình: một gia đình chuyển nhà và phát hiện căn gác xép đầy phép thuật.',
        aiTools: ['AI animation'],
        url: 'https://upload.wikimedia.org/wikipedia/commons/2/2b/%D0%9C%D0%90%D0%91%D0%9E%D0%99%D0%A7%D0%98%D0%9A%D0%98_-_%D0%A2%D1%80%D0%B5%D0%B9%D0%BB%D0%B5%D1%80_-_%D0%9C%D1%83%D0%BB%D1%8C%D1%82%D1%84%D0%B8%D0%BB%D1%8C%D0%BC_%282024%29.webm?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original',
        thumb:
          'https://thumb.wikimedia.org/wikipedia/commons/thumb/2/2b/%D0%9C%D0%90%D0%91%D0%9E%D0%99%D0%A7%D0%98%D0%9A%D0%98_-_%D0%A2%D1%80%D0%B5%D0%B9%D0%BB%D0%B5%D1%80_-_%D0%9C%D1%83%D0%BB%D1%8C%D1%82%D1%84%D0%B8%D0%BB%D1%8C%D0%BC_%282024%29.webm/960px--%D0%9C%D0%90%D0%91%D0%9E%D0%99%D0%A7%D0%98%D0%9A%D0%98_-_%D0%A2%D1%80%D0%B5%D0%B9%D0%BB%D0%B5%D1%80_-_%D0%9C%D1%83%D0%BB%D1%8C%D1%82%D1%84%D0%B8%D0%BB%D1%8C%D0%BC_%282024%29.webm.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo',
        page: 'https://commons.wikimedia.org/wiki/File:%D0%9C%D0%90%D0%91%D0%9E%D0%99%D0%A7%D0%98%D0%9A%D0%98_-_%D0%A2%D1%80%D0%B5%D0%B9%D0%BB%D0%B5%D1%80_-_%D0%9C%D1%83%D0%BB%D1%8C%D1%82%D1%84%D0%B8%D0%BB%D1%8C%D0%BC_(2024).webm',
        duration: 69,
        width: 1920,
        height: 1080,
        size: 11890455,
        license: 'Public domain',
        licenseUrl: null,
        artist: 'Arteki Studio',
      },
    ],
  },
  {
    title: 'Âm Nhạc AI',
    genres: ['Nhạc kịch', 'Giả tưởng'],
    ageRating: null,
    releaseYear: 2024,
    synopsis: 'Tuyển tập MV có hình ảnh tạo bằng AI: cyberpunk, synthwave và phù thủy trong rừng sâu.',
    episodes: [
      {
        file: 'Extra Terra & Infraction – Void (AI-generated music video & cyberpunk music).webm',
        title: 'Void',
        synopsis: 'MV cyberpunk 4K.',
        aiTools: ['Stable Diffusion'],
        url: 'https://upload.wikimedia.org/wikipedia/commons/3/30/Extra_Terra_%26_Infraction_%E2%80%93_Void_%28AI-generated_music_video_%26_cyberpunk_music%29.webm?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original',
        thumb:
          'https://thumb.wikimedia.org/wikipedia/commons/thumb/3/30/Extra_Terra_%26_Infraction_%E2%80%93_Void_%28AI-generated_music_video_%26_cyberpunk_music%29.webm/960px--Extra_Terra_%26_Infraction_%E2%80%93_Void_%28AI-generated_music_video_%26_cyberpunk_music%29.webm.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo',
        page: 'https://commons.wikimedia.org/wiki/File:Extra_Terra_%26_Infraction_%E2%80%93_Void_(AI-generated_music_video_%26_cyberpunk_music).webm',
        duration: 209,
        width: 3840,
        height: 2160,
        size: 152491855,
        license: 'Public domain',
        licenseUrl: null,
        artist: 'Infraction - No Copyright Music',
      },
      {
        file: 'Sorelius Beats – Robo Knightwolf (Synthwave Music Video with Stable Diffusion).webm',
        title: 'Robo Knightwolf',
        synopsis: 'MV synthwave về chiến binh sói robot.',
        aiTools: ['Stable Diffusion'],
        url: 'https://upload.wikimedia.org/wikipedia/commons/8/85/Sorelius_Beats_%E2%80%93_Robo_Knightwolf_%28Synthwave_Music_Video_with_Stable_Diffusion%29.webm?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original',
        thumb:
          'https://thumb.wikimedia.org/wikipedia/commons/thumb/8/85/Sorelius_Beats_%E2%80%93_Robo_Knightwolf_%28Synthwave_Music_Video_with_Stable_Diffusion%29.webm/960px--Sorelius_Beats_%E2%80%93_Robo_Knightwolf_%28Synthwave_Music_Video_with_Stable_Diffusion%29.webm.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo',
        page: 'https://commons.wikimedia.org/wiki/File:Sorelius_Beats_%E2%80%93_Robo_Knightwolf_(Synthwave_Music_Video_with_Stable_Diffusion).webm',
        duration: 102,
        width: 3840,
        height: 2160,
        size: 212611274,
        license: 'CC BY 3.0',
        licenseUrl: 'https://creativecommons.org/licenses/by/3.0',
        artist: 'Sorelius Beats',
      },
      {
        file: 'Witches Wood (Vocal AI music with AI animation music video).webm',
        title: 'Witches Wood',
        synopsis: 'Giọng hát AI và hoạt hình AI trong khu rừng phù thủy.',
        aiTools: ['Stable Diffusion', 'AI vocal'],
        url: 'https://upload.wikimedia.org/wikipedia/commons/7/75/Witches_Wood_%28Vocal_AI_music_with_AI_animation_music_video%29.webm?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original',
        thumb:
          'https://thumb.wikimedia.org/wikipedia/commons/thumb/7/75/Witches_Wood_%28Vocal_AI_music_with_AI_animation_music_video%29.webm/960px--Witches_Wood_%28Vocal_AI_music_with_AI_animation_music_video%29.webm.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo',
        page: 'https://commons.wikimedia.org/wiki/File:Witches_Wood_(Vocal_AI_music_with_AI_animation_music_video).webm',
        duration: 68,
        width: 3840,
        height: 2160,
        size: 171120459,
        license: 'CC BY 3.0',
        licenseUrl: 'https://creativecommons.org/licenses/by/3.0',
        artist: 'Vortex Project Studios',
      },
    ],
  },
  {
    title: 'Thế Giới Qua Mắt Sora & Veo',
    genres: ['Tài liệu', 'Phiêu lưu'],
    ageRating: null,
    releaseYear: 2025,
    synopsis: 'Những thước phim trình diễn của các mô hình tạo video Sora (OpenAI) và Veo (Google).',
    episodes: [
      {
        file: 'OpenAI Sora in Action- Tokyo Walk.webm',
        title: 'Dạo phố Tokyo',
        synopsis: 'Một cô gái sải bước trên phố Tokyo rực đèn neon sau cơn mưa.',
        aiTools: ['Sora'],
        url: 'https://upload.wikimedia.org/wikipedia/commons/0/0e/OpenAI_Sora_in_Action-_Tokyo_Walk.webm?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original',
        thumb:
          'https://thumb.wikimedia.org/wikipedia/commons/thumb/0/0e/OpenAI_Sora_in_Action-_Tokyo_Walk.webm/960px--OpenAI_Sora_in_Action-_Tokyo_Walk.webm.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo',
        page: 'https://commons.wikimedia.org/wiki/File:OpenAI_Sora_in_Action-_Tokyo_Walk.webm',
        duration: 60,
        width: 1920,
        height: 1080,
        size: 14436472,
        license: 'Public domain',
        licenseUrl: null,
        artist: 'Sora / OpenAI',
      },
      {
        file: 'OpenAI - This is Sora 2.webm',
        title: 'Đây là Sora 2',
        synopsis: 'Tổng hợp cảnh quay do Sora 2 tạo.',
        aiTools: ['Sora 2'],
        url: 'https://upload.wikimedia.org/wikipedia/commons/5/5b/OpenAI_-_This_is_Sora_2.webm?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original',
        thumb:
          'https://thumb.wikimedia.org/wikipedia/commons/thumb/5/5b/OpenAI_-_This_is_Sora_2.webm/960px--OpenAI_-_This_is_Sora_2.webm.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo',
        page: 'https://commons.wikimedia.org/wiki/File:OpenAI_-_This_is_Sora_2.webm',
        duration: 57,
        width: 1920,
        height: 1080,
        size: 9113021,
        license: 'Public domain',
        licenseUrl: null,
        artist: 'Sora / OpenAI',
      },
      {
        file: 'Googleveo3-2.webm',
        title: 'Veo 3 trình diễn',
        synopsis: 'Cảnh quay do Google Veo 3 tạo từ mô tả văn bản.',
        aiTools: ['Veo 3'],
        url: 'https://upload.wikimedia.org/wikipedia/commons/5/5b/Googleveo3-2.webm?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original',
        thumb:
          'https://thumb.wikimedia.org/wikipedia/commons/thumb/5/5b/Googleveo3-2.webm/960px--Googleveo3-2.webm.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo',
        page: 'https://commons.wikimedia.org/wiki/File:Googleveo3-2.webm',
        duration: 60,
        width: 1920,
        height: 1080,
        size: 16128608,
        license: 'Public domain',
        licenseUrl: null,
        artist: 'Google Veo 3',
      },
      {
        file: 'Veo 3 demo Owl and Badger.webm',
        title: 'Cú và lửng',
        synopsis: 'Cú mèo và lửng gặp nhau trong rừng đêm.',
        aiTools: ['Veo 3'],
        url: 'https://upload.wikimedia.org/wikipedia/commons/e/ef/Veo_3_demo_Owl_and_Badger.webm?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original',
        thumb:
          'https://thumb.wikimedia.org/wikipedia/commons/thumb/e/ef/Veo_3_demo_Owl_and_Badger.webm/960px--Veo_3_demo_Owl_and_Badger.webm.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo',
        page: 'https://commons.wikimedia.org/wiki/File:Veo_3_demo_Owl_and_Badger.webm',
        duration: 23,
        width: 3840,
        height: 2160,
        size: 29293365,
        license: 'Public domain',
        licenseUrl: null,
        artist: 'Google DeepMind',
      },
      {
        file: 'Origami-undersea.webm',
        title: 'Đại dương giấy',
        synopsis: 'Thế giới dưới nước làm từ giấy gấp origami.',
        aiTools: ['Sora'],
        url: 'https://upload.wikimedia.org/wikipedia/commons/1/13/Origami-undersea.webm?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original',
        thumb:
          'https://thumb.wikimedia.org/wikipedia/commons/thumb/1/13/Origami-undersea.webm/960px--Origami-undersea.webm.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo',
        page: 'https://commons.wikimedia.org/wiki/File:Origami-undersea.webm',
        duration: 20,
        width: 1920,
        height: 1080,
        size: 20776931,
        license: 'Public domain',
        licenseUrl: null,
        artist: 'Sora/OpenAI',
      },
      {
        file: 'Amalfi-coast.webm',
        title: 'Bờ biển Amalfi',
        synopsis: 'Bay trên bờ biển Amalfi lúc hoàng hôn.',
        aiTools: ['Sora'],
        url: 'https://upload.wikimedia.org/wikipedia/commons/d/d2/Amalfi-coast.webm?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original',
        thumb:
          'https://thumb.wikimedia.org/wikipedia/commons/thumb/d/d2/Amalfi-coast.webm/960px--Amalfi-coast.webm.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo',
        page: 'https://commons.wikimedia.org/wiki/File:Amalfi-coast.webm',
        duration: 20,
        width: 1280,
        height: 720,
        size: 18101552,
        license: 'Public domain',
        licenseUrl: null,
        artist: 'Sora/OpenAI',
      },
      {
        file: 'Paper-airplanes.webm',
        title: 'Máy bay giấy',
        synopsis: 'Đàn máy bay giấy bay qua khu rừng.',
        aiTools: ['Sora'],
        url: 'https://upload.wikimedia.org/wikipedia/commons/0/09/Paper-airplanes.webm?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=original',
        thumb:
          'https://thumb.wikimedia.org/wikipedia/commons/thumb/0/09/Paper-airplanes.webm/960px--Paper-airplanes.webm.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo',
        page: 'https://commons.wikimedia.org/wiki/File:Paper-airplanes.webm',
        duration: 20,
        width: 1280,
        height: 720,
        size: 36820708,
        license: 'Public domain',
        licenseUrl: null,
        artist: 'Sora/OpenAI',
      },
    ],
  },
];
