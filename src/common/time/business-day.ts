/** Deadlines are calendar days in Vietnam, whatever time zone the server runs in. */
export const BUSINESS_TIME_ZONE = 'Asia/Ho_Chi_Minh';

const dayFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Today in Vietnam as a date column holds it: midnight UTC of that calendar day. */
export function businessDay(now: Date = new Date()): Date {
  return new Date(dayFormat.format(now));
}
