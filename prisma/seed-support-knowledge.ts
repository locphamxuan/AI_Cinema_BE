/**
 * Seeds the Vietnamese support FAQ (plan §4.1) and, when an embedding provider is configured,
 * indexes it immediately. Idempotent by (slug, locale): re-running updates the text and rebuilds
 * the chunks. Run with `npm run seed:support-knowledge`.
 *
 * Dynamic values (Coin rate, balances, transaction states) are deliberately absent: the AI reads
 * them through tools so a seeded article can never go stale.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  KnowledgeArticleStatus,
  KnowledgeIndexStatus,
  KnowledgeSource,
  Prisma,
  PrismaClient,
  SupportAudience,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { HashingEmbeddingClient } from '../src/infrastructure/ai/hashing-embedding.client';
import { OpenAiCompatibleEmbeddingClient } from '../src/infrastructure/ai/openai-compatible-embedding.client';
import type { EmbeddingClient } from '../src/infrastructure/ai/llm-client';
import { ChunkingService } from '../src/modules/support/knowledge/chunking.service';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is not set');

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const chunking = new ChunkingService();

interface SeedArticle {
  slug: string;
  title: string;
  category: string;
  audience: SupportAudience;
  source: KnowledgeSource;
  markdown: string;
}

const ARTICLES: SeedArticle[] = [
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
4. Hoàn tất thanh toán trên ứng dụng của nhà cung cấp.

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
Nếu bạn đã tạo tài khoản bằng email, hãy đăng nhập bằng email đó. Google chỉ dùng để đăng ký tài khoản mới; email đã có tài khoản mật khẩu không đăng nhập bằng Google được.

## Quên mật khẩu
Chức năng đặt lại mật khẩu bằng mã OTP gửi qua Gmail sẽ có trong bản cập nhật sau. Hiện tại, hãy liên hệ nhân viên hỗ trợ kèm email đã đăng ký. Nhân viên hỗ trợ không bao giờ hỏi mật khẩu, OTP hay số thẻ của bạn.

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
1. Kiểm tra kết nối mạng và thử mở lại ứng dụng.
2. Thử một tập khác để xác định lỗi do tập phim hay do thiết bị.
3. Cập nhật ứng dụng lên phiên bản mới nhất.

## Hình ảnh mờ hoặc giật
Chất lượng HLS tự điều chỉnh theo băng thông. Khi mạng yếu, trình phát giảm độ phân giải để tránh dừng hình. Kết nối Wi-Fi ổn định hoặc mạng di động tốc độ cao sẽ cho hình ảnh tốt hơn.

## Âm thanh nhưng không có hình
Tắt chế độ tiết kiệm pin, sau đó mở lại trình phát. Trên một số thiết bị cũ, codec của phim có thể không được hỗ trợ.

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
Mỗi phim có một số tập đầu được xem miễn phí, gọi là Free Starter. Khách chưa đăng nhập và tài khoản Miễn phí đều xem được các tập này.

## Số tập miễn phí
Số tập Free Starter có thể khác nhau giữa các phim và do nền tảng hoặc nhà sản xuất quy định. Nhãn Free hiển thị trên danh sách tập.

## Tập giá 0 Coin
Ngoài Free Starter, một số tập có giá 0 Coin và cũng xem được mà không cần gói trả phí.

## Xem tiếp các tập sau
Các tập không miễn phí cần mua lẻ bằng Coin hoặc xem bằng gói trả phí còn hiệu lực. Nếu bạn đang có gói mà vẫn bị yêu cầu mua, kiểm tra trạng thái gói trong mục Gói dịch vụ.

## Khách xem không cần tài khoản
Khách có thể xem Free Starter nhưng không có lịch sử xem, không nhận thông báo và không đồng bộ tiến độ giữa các thiết bị. Đăng nhập để lưu tiến độ và mở khóa nội dung đã mua.`,
  },
];

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function chunkHash(model: string, content: string): string {
  return sha256(`${model}\u0000${content}`);
}

function embeddingClient(): EmbeddingClient | null {
  const mode = process.env.AI_MODE ?? 'live';
  const dimensions = Number(process.env.AI_EMBEDDING_DIMENSIONS ?? 768);
  if (mode === 'disabled') return null;
  if (mode === 'mock') return new HashingEmbeddingClient(dimensions);

  const baseUrl = process.env.AI_EMBEDDING_BASE_URL ?? process.env.AI_CHAT_BASE_URL;
  const apiKey = process.env.AI_EMBEDDING_API_KEY ?? process.env.AI_CHAT_API_KEY;
  if (!baseUrl || !apiKey) return null;

  return new OpenAiCompatibleEmbeddingClient({
    baseUrl,
    apiKey,
    model: process.env.AI_EMBEDDING_MODEL ?? 'text-embedding-004',
    dimensions,
    timeoutMs: Number(process.env.AI_TIMEOUT_MS ?? 30_000),
  });
}

async function main() {
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, select: { id: true } });
  const embeddings = embeddingClient();
  let indexed = 0;
  let pending = 0;

  for (const article of ARTICLES) {
    const contentHash = sha256(article.markdown);
    const shared = {
      title: article.title,
      category: article.category,
      audience: article.audience,
      locale: 'vi',
      contentMarkdown: article.markdown,
      status: KnowledgeArticleStatus.PUBLISHED,
      source: article.source,
      contentHash,
      indexStatus: KnowledgeIndexStatus.PENDING,
      indexError: null,
      indexedAt: null,
      ...(admin ? { createdById: admin.id, updatedById: admin.id } : {}),
    };

    const row = await prisma.supportKnowledgeArticle.upsert({
      where: { slug_locale: { slug: article.slug, locale: 'vi' } },
      update: shared,
      create: { ...shared, slug: article.slug },
      select: { id: true },
    });
    await prisma.supportKnowledgeChunk.deleteMany({ where: { articleId: row.id } });

    if (!embeddings) {
      pending += 1;
      continue;
    }

    try {
      const chunks = chunking.chunk(article.markdown, article.title);
      const vectors = await embeddings.embed(chunks.map((chunk) => chunk.content));
      if (vectors.length !== chunks.length) throw new Error('Embedding provider returned the wrong count');

      await prisma.$transaction(async (tx) => {
        if (chunks.length) {
          const rows = chunks.map(
            (chunk, index) =>
              Prisma.sql`(
              ${randomUUID()}::uuid, ${row.id}::uuid, ${chunk.chunkIndex}, ${chunk.heading},
              ${chunk.content}, ${chunk.tokenCount}, ${vectorLiteral(vectors[index])}::vector,
              ${embeddings.model}, ${embeddings.modelVersion ?? null}, ${chunkHash(embeddings.model, chunk.content)}
            )`,
          );
          await tx.$executeRaw(Prisma.sql`
            INSERT INTO "support_knowledge_chunks"
              ("id", "article_id", "chunk_index", "heading", "content", "token_count",
               "embedding", "embedding_model", "embedding_model_version", "content_hash")
            VALUES ${Prisma.join(rows)}
          `);
        }
        await tx.supportKnowledgeArticle.update({
          where: { id: row.id },
          data: { indexStatus: KnowledgeIndexStatus.INDEXED, indexedAt: new Date(), indexError: null },
        });
      });
      indexed += 1;
    } catch (error) {
      pending += 1;
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 2_000);
      await prisma.supportKnowledgeArticle.update({
        where: { id: row.id },
        data: { indexStatus: KnowledgeIndexStatus.FAILED, indexError: message },
      });
      console.warn(`Seed: article ${article.slug} left unindexed: ${message}`);
    }
  }

  console.log(
    `Support knowledge: ${ARTICLES.length} articles, ${indexed} indexed${pending ? `, ${pending} left for the index job` : ''}.`,
  );
}

function vectorLiteral(vector: number[]): string {
  return `[${vector.join(',')}]`;
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
