/** The columns that describe the poster a studio sent; the storage key never leaves the API. */
export const STUDIO_POSTER_FIELDS = { studioPosterFileName: true, studioPosterUploadedAt: true } as const;

export type StudioPosterView = { fileName: string; uploadedAt: Date } | null;

/** What the screens see of the poster a studio sent: its file name and when, or null before it sends one. */
export function studioPosterOf(row: {
  studioPosterFileName: string | null;
  studioPosterUploadedAt: Date | null;
}): StudioPosterView {
  if (!row.studioPosterFileName || !row.studioPosterUploadedAt) return null;
  return { fileName: row.studioPosterFileName, uploadedAt: row.studioPosterUploadedAt };
}
