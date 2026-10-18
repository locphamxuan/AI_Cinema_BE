/** Heartbeat pacing for viewing updates (step 15): resume-hint cadence and watch-time credit. */

/**
 * Heartbeats run every 10–15s to keep the session alive, but watch_progress is a resume
 * hint, not a liveness signal: one write a minute is plenty. Stop and complete always write.
 */
export const PROGRESS_WRITE_INTERVAL_MS = 60_000;

const HEARTBEAT_INTERVAL_SECONDS = 15;

/**
 * Watch time one viewing update may credit at most: two beats' worth. Players beat every
 * 10–15s (see HeartbeatRequestDto), so a wider gap is not time the server can vouch for.
 */
export const MAX_WATCH_CREDIT_SECONDS = 2 * HEARTBEAT_INTERVAL_SECONDS;

/** True when a heartbeat is allowed to write the resume hint again. */
export function progressWriteDue(session: { lastProgressAt: Date | null }, now: Date): boolean {
  const last = session.lastProgressAt;
  return !last || now.getTime() - last.getTime() >= PROGRESS_WRITE_INTERVAL_MS;
}

/**
 * Watch time credited for one viewing update: the server-measured gap since the previous
 * update, capped at two heartbeat intervals (a longer gap is not time we can vouch for).
 * The client's claim may only clamp the credit down — an inflated number never adds a
 * second, it is just ignored past the cap.
 */
export function watchCreditSeconds(lastHeartbeatAt: Date, now: Date, claim: number | undefined): number {
  const elapsed = Math.floor(Math.max(0, now.getTime() - lastHeartbeatAt.getTime()) / 1000);
  const credit = Math.min(elapsed, MAX_WATCH_CREDIT_SECONDS);
  if (claim === undefined || !Number.isFinite(claim)) return credit;
  return Math.min(credit, Math.max(0, Math.floor(claim)));
}
