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

## 3 style cho MVP

Base model: **FLUX.1 [dev]** (`fal.ai/flux-dev@1.0`, open-weight — model duy nhất trong catalog train được LoRA). Các genre khác vẫn dùng prompt thuần (Level 1).

| Genre | Thư mục | Hướng phong cách cần gom ảnh |
|---|---|---|
| Hành động | `hanh-dong/aicinema-action-style/v1` | Tương phản cao, teal & orange, motion blur, góc máy thấp, khói/bụi, ánh sáng gắt |
| Kinh dị | `kinh-di/aicinema-horror-style/v1` | Low-key, bóng đổ sâu, tông lạnh xanh/xám, sương mù, khung hình nhiều khoảng tối |
| Khoa học viễn tưởng | `khoa-hoc-vien-tuong/aicinema-scifi-style/v1` | Neon cyan/magenta, rim light, bề mặt kim loại, hologram, bối cảnh đô thị tương lai |

## Quy tắc dataset

- Tối thiểu **15 ảnh** (`minSampleThreshold`) trước khi được train; nên 20–40 ảnh, ≥ 1024px cạnh ngắn.
- Chỉ gom **phong cách** (ánh sáng, màu, mood, bố cục) — **không** dùng ảnh có nhân vật/khuôn mặt người thật hay nhân vật có bản quyền, vì team không tái sử dụng nhân vật giữa các phim.
- Chỉ dùng ảnh team tự tạo hoặc có license cho phép dùng thương mại/huấn luyện.
- Caption mô tả nội dung ảnh bằng tiếng Anh, **không** chứa triggerKeyword (trainer tự thêm).
- File ảnh không được commit (đã chặn trong `.gitignore`), chỉ commit caption `.txt`; ảnh được chia sẻ qua storage chung của team.

## Quy trình

1. Reviewer tạo `GenreStyleModel` (seed đã tạo sẵn 3 bản `DRAFT` ở trên).
2. Bỏ ảnh + caption vào đúng thư mục `v<version>`.
3. `POST /genre-style-models/:id/import-dataset` — đăng ký toàn bộ ảnh mới trong thư mục thành sample; đủ ngưỡng thì status chuyển `DATASET_READY`.
4. `POST /genre-style-models/:id/start-training` → dịch vụ train thuê ngoài (fal.ai) → `complete-training` khi xong.
5. Khi `READY` + `isActive`, job `POSTER`/`THUMBNAIL` của project có `primaryGenreId` khớp sẽ tự gắn LoRA này.

Thư mục gốc đổi được qua biến môi trường `TRAINING_DATA_ROOT` (mặc định `training-data`, tính từ thư mục chạy BE).
