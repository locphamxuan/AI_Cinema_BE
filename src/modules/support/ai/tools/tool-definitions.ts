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
    description: 'Tìm phim/tập đã publish theo tên.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Tên phim hoặc tập cần tìm' } },
      required: ['query'],
    },
  },
  {
    name: SUPPORT_TOOL.GET_EPISODE_ACCESS,
    description: 'Quyền xem đã mua của thành viên: tập, nguồn quyền, số Coin đã trả, trạng thái thu hồi.',
    parameters: {
      type: 'object',
      properties: { episodeId: { type: 'string', description: 'Mã tập phim, nếu muốn kiểm tra một tập cụ thể' } },
      required: [],
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
