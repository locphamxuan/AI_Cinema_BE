import { SupportEscalationReason } from '@prisma/client';
import type { ChatToolDefinition } from 'src/infrastructure/ai/llm-client';
import { SUPPORT_QUICK_REPLY } from '../../shared/support-status';

/** Read-only tools the AI may call (plan §5.2). None of them writes, and none takes memberId
 * from the model: the chat layer always passes the signed-in member's id. */
export const SUPPORT_TOOL = {
  GET_MEMBER_WALLET: 'get_member_wallet',
  GET_MEMBER_SUBSCRIPTION: 'get_member_subscription',
  GET_RECENT_TOPUPS: 'get_recent_topups',
  GET_RECENT_PAYMENTS: 'get_recent_payments',
  GET_RECENT_COIN_TRANSACTIONS: 'get_recent_coin_transactions',
  GET_PLAN_CATALOG: 'get_plan_catalog',
  SEARCH_CATALOG: 'search_catalog',
  GET_EPISODE_ACCESS: 'get_episode_access',
  GET_MEMBER_DEVICES: 'get_member_devices',
  GET_RECENT_STREAMING_SESSIONS: 'get_recent_streaming_sessions',
  GET_PLATFORM_POLICY_SNAPSHOT: 'get_platform_policy_snapshot',
  GET_TRENDING_MOVIES: 'get_trending_movies',
  GET_MY_RECOMMENDATIONS: 'get_my_recommendations',
  GET_WATCH_HISTORY: 'get_watch_history',
  GET_REWARD_STATUS: 'get_reward_status',
  GET_UNLOCKED_EPISODES: 'get_unlocked_episodes',
  GET_UPCOMING_RELEASES: 'get_upcoming_releases',
} as const;

export type SupportToolName = (typeof SUPPORT_TOOL)[keyof typeof SUPPORT_TOOL];

export interface SupportToolDefinition {
  name: SupportToolName;
  description: string;
  /** OpenAI-style function parameters; the handler ignores any id the model sends. */
  parameters: {
    type: 'object';
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
}

const noArguments = { type: 'object' as const, properties: {}, required: [] as string[] };

export const SUPPORT_TOOL_DEFINITIONS: SupportToolDefinition[] = [
  {
    name: SUPPORT_TOOL.GET_TRENDING_MOVIES,
    description: 'Top 10 phim đang có nhiều lượt xem nhất trên AI Cinema (bảng xếp hạng của app).',
    parameters: noArguments,
  },
  {
    name: SUPPORT_TOOL.GET_MY_RECOMMENDATIONS,
    description:
      'Năm phim AI đề xuất cho chính thành viên dựa trên lịch sử xem (xem hết, bỏ dở), thể loại và quốc gia, kèm lý do.',
    parameters: noArguments,
  },
  {
    name: SUPPORT_TOOL.GET_WATCH_HISTORY,
    description: 'Mười tập thành viên xem gần nhất: phim, tập, đã xem bao nhiêu giây, đã xem xong chưa.',
    parameters: noArguments,
  },
  {
    name: SUPPORT_TOOL.GET_REWARD_STATUS,
    description:
      'Điểm danh hôm nay đã nhận chưa, chuỗi ngày điểm danh, phần thưởng các mốc, Coin thưởng sắp hết hạn, số lượt vòng quay còn lại.',
    parameters: noArguments,
  },
  {
    name: SUPPORT_TOOL.GET_UNLOCKED_EPISODES,
    description:
      'Mười tập thành viên mở khóa gần nhất: phim, tập, nguồn quyền, số Coin đã trả, đã bị thu hồi / hoàn Coin chưa.',
    parameters: noArguments,
  },
  {
    name: SUPPORT_TOOL.GET_UPCOMING_RELEASES,
    description: 'Các tập đã lên lịch phát hành sắp tới: phim, tập, thời điểm phát hành.',
    parameters: noArguments,
  },
  {
    name: SUPPORT_TOOL.GET_MEMBER_WALLET,
    description: 'Số dư Coin chính và Coin thưởng, cùng hạn dùng của các lô Coin thưởng sắp hết hạn.',
    parameters: noArguments,
  },
  {
    name: SUPPORT_TOOL.GET_MEMBER_SUBSCRIPTION,
    description: 'Gói thành viên đang dùng: tên gói, trạng thái, kỳ hiện tại, tự gia hạn và hạn hủy.',
    parameters: noArguments,
  },
  {
    name: SUPPORT_TOOL.GET_RECENT_TOPUPS,
    description: 'Các lần nạp Coin gần đây: số tiền VND, Coin nhận được, trạng thái và lý do lỗi.',
    parameters: noArguments,
  },
  {
    name: SUPPORT_TOOL.GET_RECENT_PAYMENTS,
    description: 'Các giao dịch thanh toán gần đây: nhà cung cấp, số tiền, trạng thái.',
    parameters: noArguments,
  },
  {
    name: SUPPORT_TOOL.GET_RECENT_COIN_TRANSACTIONS,
    description: 'Sổ cái Coin gần đây: loại bút toán, số Coin thay đổi, thời điểm.',
    parameters: noArguments,
  },
  {
    name: SUPPORT_TOOL.GET_PLAN_CATALOG,
    description: 'Danh sách gói đang bán: tên, kỳ hạn, quyền lợi và giá Coin.',
    parameters: noArguments,
  },
  {
    name: SUPPORT_TOOL.SEARCH_CATALOG,
    description:
      'Tìm phim theo tên (chỉ phim đang bán có ít nhất một tập đã phát hành), kèm các tập đầu tiên: số thứ tự, giá Coin, free starter, trạng thái phát hành. Dùng để lấy episodeId cho get_episode_access.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Tên phim hoặc tập cần tìm' } },
      required: ['query'],
    },
  },
  {
    name: SUPPORT_TOOL.GET_EPISODE_ACCESS,
    description:
      'Quyền xem một tập cụ thể: có được xem không, nguồn quyền (free starter / gói subscription / mua lẻ), giá và bước tiếp theo để mở khóa. Cần episodeId (hãy dùng search_catalog để lấy khi chưa biết).',
    parameters: {
      type: 'object',
      properties: { episodeId: { type: 'string', description: 'Mã tập phim cần kiểm tra' } },
      required: ['episodeId'],
    },
  },
  {
    name: SUPPORT_TOOL.GET_MEMBER_DEVICES,
    description: 'Thiết bị đã đăng ký và lần đăng nhập gần nhất.',
    parameters: noArguments,
  },
  {
    name: SUPPORT_TOOL.GET_RECENT_STREAMING_SESSIONS,
    description: 'Phiên xem gần đây: trạng thái và lý do kết thúc. Không trả IP hay URL stream.',
    parameters: noArguments,
  },
  {
    name: SUPPORT_TOOL.GET_PLATFORM_POLICY_SNAPSHOT,
    description: 'Các chính sách đang áp dụng: tỷ giá Coin, hạn Coin thưởng, khoảng nạp, cửa sổ hủy gói.',
    parameters: noArguments,
  },
];

/**
 * Plan §5.3/§3.4: the model must answer through this tool, so the server receives a validated
 * object instead of parsing free text. The tool is only offered on the final turn.
 */
export const FINAL_ANSWER_TOOL_NAME = 'final_answer';

export const FINAL_ANSWER_TOOL: ChatToolDefinition = {
  name: FINAL_ANSWER_TOOL_NAME,
  description:
    'Gửi câu trả lời cuối cùng cho thành viên. Chỉ gọi sau khi đã kiểm tra tài liệu và dữ liệu công cụ cần thiết.',
  parameters: {
    type: 'object',
    properties: {
      reply: {
        type: 'string',
        description: 'Câu trả lời hiển thị cho thành viên, ngắn gọn, lịch sự, bằng tiếng Việt.',
      },
      resolution: {
        type: 'string',
        enum: ['ANSWERED', 'RESOLVED_SUGGESTED', 'NEEDS_HUMAN', 'UNCERTAIN'],
        description: 'Kết quả của lượt trả lời. NEEDS_HUMAN/UNCERTAIN sẽ chuyển cho nhân viên.',
      },
      escalationReason: {
        type: 'string',
        enum: Object.values(SupportEscalationReason),
        description: 'Lý do escalate khi resolution là NEEDS_HUMAN hoặc UNCERTAIN; bỏ trống nếu không escalate.',
      },
      confidence: {
        type: 'number',
        description: 'Độ tin cậy của câu trả lời, từ 0 đến 1.',
      },
      handoffSummary: {
        type: 'string',
        description: 'Tóm tắt vấn đề, dữ liệu đã kiểm tra và đề xuất cho nhân viên khi escalate.',
      },
      quickReplies: {
        type: 'array',
        items: { type: 'string', enum: Object.values(SUPPORT_QUICK_REPLY) },
        description: 'Các nút gợi ý cho thành viên; để trống nếu không cần.',
      },
    },
    required: ['reply', 'resolution', 'confidence', 'quickReplies'],
  },
};
