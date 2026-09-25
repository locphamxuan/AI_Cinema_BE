-- Role-based access control the Admin can edit: the permission catalog and which role holds which permission.
-- Defaults follow the RBAC matrix of PROJECT_OVERVIEW.md §2.2 (the Admin only oversees production).

-- CreateTable
CREATE TABLE "permissions" (
    "key" VARCHAR(64) NOT NULL,
    "area" VARCHAR(32) NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role" "UserRole" NOT NULL,
    "permission_key" VARCHAR(64) NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role","permission_key")
);

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_key_fkey" FOREIGN KEY ("permission_key") REFERENCES "permissions"("key") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "permissions" ("key", "area", "description") VALUES
    ('production:read', 'production', 'Xem dự án, kế hoạch, cảnh và kết quả tạo'),
    ('production:project.manage', 'production', 'Tạo, sửa, huỷ dự án phim và đặt cột mốc'),
    ('production:milestone.update', 'production', 'Cập nhật trạng thái cột mốc'),
    ('production:plan.write', 'production', 'Soạn, lưu nháp và gửi kế hoạch sản xuất'),
    ('production:plan.review', 'production', 'Duyệt hoặc trả kế hoạch sản xuất'),
    ('production:quota.request', 'production', 'Xin thêm token cho tập'),
    ('production:quota.manage', 'production', 'Cấp token và duyệt yêu cầu xin thêm token'),
    ('production:generate', 'production', 'Tạo nội dung bằng AI trong Studio'),
    ('episode:submit', 'production', 'Ghép và gửi bản dựng tập phim'),
    ('episode:review', 'production', 'Kiểm định bản dựng, gắn nhãn AI'),
    ('movie:publish', 'production', 'Đưa vào danh mục, lên lịch và phát hành tập phim'),
    ('genre:manage', 'production', 'Thêm thể loại phim'),
    ('genre-style:manage', 'production', 'Quản lý và huấn luyện phong cách thể loại (LoRA)'),
    ('film:analytics.read', 'operations', 'Xem hiệu suất phim và lịch phát hành'),
    ('member:ops.read', 'operations', 'Xem thông tin member (chỉ đọc)'),
    ('billing:read', 'operations', 'Xem Coin, giao dịch, gói thành viên (chỉ đọc)'),
    ('support:manage', 'operations', 'Xử lý yêu cầu hỗ trợ khách hàng'),
    ('marketing:manage', 'operations', 'Tạo và theo dõi chiến dịch marketing'),
    ('user:read', 'admin', 'Xem danh sách tài khoản nội bộ'),
    ('user:manage', 'admin', 'Đổi vai trò, khoá và mở tài khoản'),
    ('role:manage', 'admin', 'Sửa quyền của từng vai trò'),
    ('platform:settings.manage', 'admin', 'Sửa cài đặt nền tảng (thời lượng tối đa mỗi tập)');

INSERT INTO "role_permissions" ("role", "permission_key") VALUES
    ('CONTENT_CREATOR', 'production:read'),
    ('CONTENT_CREATOR', 'production:milestone.update'),
    ('CONTENT_CREATOR', 'production:plan.write'),
    ('CONTENT_CREATOR', 'production:quota.request'),
    ('CONTENT_CREATOR', 'production:generate'),
    ('CONTENT_CREATOR', 'episode:submit'),
    ('CONTENT_REVIEWER', 'production:read'),
    ('CONTENT_REVIEWER', 'production:project.manage'),
    ('CONTENT_REVIEWER', 'production:milestone.update'),
    ('CONTENT_REVIEWER', 'production:plan.review'),
    ('CONTENT_REVIEWER', 'production:quota.manage'),
    ('CONTENT_REVIEWER', 'episode:review'),
    ('CONTENT_REVIEWER', 'movie:publish'),
    ('CONTENT_REVIEWER', 'genre:manage'),
    ('CONTENT_REVIEWER', 'genre-style:manage'),
    ('CONTENT_REVIEWER', 'user:read'),
    ('STAFF', 'film:analytics.read'),
    ('STAFF', 'member:ops.read'),
    ('STAFF', 'billing:read'),
    ('STAFF', 'support:manage'),
    ('STAFF', 'marketing:manage'),
    ('ADMIN', 'production:read'),
    ('ADMIN', 'film:analytics.read'),
    ('ADMIN', 'member:ops.read'),
    ('ADMIN', 'billing:read'),
    ('ADMIN', 'support:manage'),
    ('ADMIN', 'marketing:manage'),
    ('ADMIN', 'user:read'),
    ('ADMIN', 'user:manage'),
    ('ADMIN', 'role:manage'),
    ('ADMIN', 'platform:settings.manage');
