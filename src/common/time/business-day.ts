/** Deadlines are calendar days in Vietnam, whatever time zone the server runs in. */
const BUSINESS_TIME_ZONE = 'Asia/Ho_Chi_Minh';

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

const stampFormat = new Intl.DateTimeFormat('vi-VN', {
  timeZone: BUSINESS_TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** A moment as a Vietnamese document prints it: "10/11/2026 14:05 (giờ Việt Nam)". */
export function businessStamp(at: Date): string {
  return `${stampFormat.format(at).replace(', ', ' ')} (giờ Việt Nam)`;
}
