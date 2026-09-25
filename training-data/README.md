# Training data — Genre Style LoRA (Level 1.5)

Dữ liệu train LoRA phong cách theo thể loại phim, xem `docs/PROJECT_OVERVIEW.md` §4.1.8.1. Mỗi `GenreStyleModel` (1 genre + 1 base model + 1 version) có đúng **1 thư mục** dataset riêng:

```text
training-data/
└── genre-styles/
    └── <genre-slug>/                 # slug không dấu của Genre.name
        └── <triggerKeyword>/         # token kích hoạt LoRA trong prompt
            └── v<version>/           # retrain = thư mục version mới, không ghi đè bản cũ
                ├── 001.png
                ├── 001.txt           # caption cho 001.png (cùng tên file)
                └── ...
```

`storageKey` của từng sample = đường dẫn tính từ `training-data/` (vd. `genre-styles/kinh-di/aicinema-horror-style/v1/001.png`). API trả về đường dẫn này trong field `datasetFolder` của `GET /genre-style-models/:id`, và từ chối sample nằm ngoài thư mục đó.

## Thư mục theo thể loại

Base model: **FLUX.1 [dev]** (`fal.ai/flux-dev@1.0`, open-weight — model duy nhất trong catalog train được LoRA). Danh sách genre, mô tả và hướng phong cách lấy từ `prisma/genre-catalog.ts` (nguồn chung cho seed): 19 genre chuẩn TMDB/IMDb + các thể loại các nền tảng VN tách riêng (Hoạt hình, Võ thuật, Cổ trang, Thần thoại, Học đường, Siêu anh hùng, Thảm họa). Không có Tiểu sử (Biography) vì bắt buộc mô phỏng người thật (BR-43).

Mỗi genre đã có sẵn thư mục `v1` và 1 `GenreStyleModel` `DRAFT` trong seed. **MVP chỉ train 2–3 style** (ưu tiên Hành động, Kinh dị, Khoa học viễn tưởng); genre chưa train vẫn dùng prompt thuần (Level 1).

| Genre | Thư mục (dưới `genre-styles/`) | Hướng phong cách cần gom ảnh |
|---|---|---|
| Hành động | `hanh-dong/aicinema-action-style/v1` | High contrast, teal & orange grade, motion blur, low camera angles, smoke and dust, hard light |
| Phiêu lưu | `phieu-luu/aicinema-adventure-style/v1` | Sweeping wide landscapes, golden hour, warm saturated colors, small figures against vast scenery |
| Hài | `hai/aicinema-comedy-style/v1` | Bright high-key lighting, cheerful saturated colors, clean symmetrical framing, few shadows |
| Tội phạm | `toi-pham/aicinema-crime-style/v1` | Neo-noir, sodium streetlights, wet asphalt reflections, desaturated greens, venetian-blind shadows |
| Chính kịch | `chinh-kich/aicinema-drama-style/v1` | Naturalistic soft window light, muted palette, intimate close framing, shallow depth of field |
| Gia đình | `gia-dinh/aicinema-family-style/v1` | Warm soft light, gentle pastel palette, cozy lived-in interiors, sunny outdoor scenes |
| Giả tưởng | `gia-tuong/aicinema-fantasy-style/v1` | Ethereal glow, volumetric god rays, rich jewel tones, floating magical particles, enchanted forests |
| Kinh dị | `kinh-di/aicinema-horror-style/v1` | Low-key lighting, deep shadows, cold blue-grey tones, fog, large dark negative space in frame |
| Bí ẩn | `bi-an/aicinema-mystery-style/v1` | Chiaroscuro, isolated pools of lamp light, mist, muted amber and slate tones, partially hidden details |
| Lãng mạn | `lang-man/aicinema-romance-style/v1` | Soft diffusion, warm backlight, creamy bokeh, blush and pastel tones, dreamy golden hour |
| Khoa học viễn tưởng | `khoa-hoc-vien-tuong/aicinema-scifi-style/v1` | Neon cyan & magenta, rim light, brushed metal surfaces, holograms, futuristic cityscapes |
| Giật gân | `giat-gan/aicinema-thriller-style/v1` | Cold desaturated grade, hard shadows, tight claustrophobic framing, dutch angles, sickly green tint |
| Tâm lý | `tam-ly/aicinema-psychological-style/v1` | Surreal compositions, isolated subjects, warm/cold split lighting, mirrors and reflections |
| Lịch sử | `lich-su/aicinema-history-style/v1` | Period-accurate settings, candle and natural light, earthy sepia tones, painterly composition |
| Tài liệu | `tai-lieu/aicinema-documentary-style/v1` | Available natural light, handheld realism, neutral true-to-life grade, observational framing |
| Thể thao | `the-thao/aicinema-sports-style/v1` | Stadium floodlights, frozen peak-action motion, sweat and texture detail, high saturation |
| Chiến tranh | `chien-tranh/aicinema-war-style/v1` | Bleach-bypass desaturation, gritty texture, smoke and debris, overcast skies, muddy earth tones |
| Miền Tây | `mien-tay/aicinema-western-style/v1` | Dusty sun-baked desert, warm ochre palette, harsh noon sun, wide frontier landscapes, long shadows |
| Nhạc kịch | `nhac-kich/aicinema-musical-style/v1` | Theatrical stage lighting, spotlights, vivid costume colors, choreographed wide ensemble shots |
| Hoạt hình | `hoat-hinh/aicinema-animation-style/v1` | Stylized 3D/2D illustration, clean shapes, cel shading, bright appealing palette, expressive staging |
| Võ thuật | `vo-thuat/aicinema-martial-arts-style/v1` | Misty mountains, bamboo forests, flowing fabric in motion, dynamic poses, muted jade and ink tones |
| Cổ trang | `co-trang/aicinema-period-style/v1` | Palace interiors, silk costumes, paper lanterns, rich crimson and gold, symmetrical formal framing |
| Thần thoại | `than-thoai/aicinema-mythology-style/v1` | Epic celestial skies, glowing auras, cloud-sea landscapes, ancient temples, gold and azure palette |
| Học đường | `hoc-duong/aicinema-school-style/v1` | Bright daylight, classrooms and school yards, fresh youthful pastels, soft lens flare, clean look |
| Siêu anh hùng | `sieu-anh-hung/aicinema-superhero-style/v1` | Heroic low angles, high-contrast saturated color, lens flares, dramatic skies, energy effects |
| Thảm họa | `tham-hoa/aicinema-disaster-style/v1` | Apocalyptic skies, orange-grey haze, massive scale destruction, debris in the air, tiny human figures |

## Quy tắc dataset

- Tối thiểu **15 ảnh** (`minSampleThreshold`) trước khi được train; nên 20–40 ảnh, ≥ 1024px cạnh ngắn.
- Chỉ gom **phong cách** (ánh sáng, màu, mood, bố cục) — **không** dùng ảnh có nhân vật/khuôn mặt người thật hay nhân vật có bản quyền, vì team không tái sử dụng nhân vật giữa các phim.
- Chỉ dùng ảnh team tự tạo hoặc có license cho phép dùng thương mại/huấn luyện.
- Caption mô tả nội dung ảnh bằng tiếng Anh, **không** chứa triggerKeyword (trainer tự thêm).
- File ảnh không được commit (đã chặn trong `.gitignore`), chỉ commit caption `.txt`; ảnh được chia sẻ qua storage chung của team.

## Quy trình

1. Reviewer tạo `GenreStyleModel` (seed đã tạo sẵn 1 bản `DRAFT` cho mỗi genre ở trên).
2. Bỏ ảnh + caption vào đúng thư mục `v<version>`.
3. `POST /genre-style-models/:id/import-dataset` — đăng ký toàn bộ ảnh mới trong thư mục thành sample; đủ ngưỡng thì status chuyển `DATASET_READY`.
4. `POST /genre-style-models/:id/start-training` → dịch vụ train thuê ngoài (fal.ai) → `complete-training` khi xong.
5. Khi `READY` + `isActive`, job `POSTER`/`THUMBNAIL` của project có `primaryGenreId` khớp sẽ tự gắn LoRA này.

Thư mục gốc đổi được qua biến môi trường `TRAINING_DATA_ROOT` (mặc định `training-data`, tính từ thư mục chạy BE).
