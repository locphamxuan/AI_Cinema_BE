// TODO: cursor pagination helper dùng chung cho các list endpoint (?cursor=&limit=).
export interface CursorPage<T> {
  data: T[];
  meta: { nextCursor: string | null };
}
