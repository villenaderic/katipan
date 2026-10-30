import type { LangCode } from '../types';

/**
 * Date helpers. Everything uses the phone's LOCAL calendar, because "today's
 * verse" must change at the person's midnight, not at UTC midnight.
 *
 * No Intl and no toLocale*String: month and weekday names are written out so
 * the result is identical on every Android version and in every language.
 */

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

export const MS_PER_MINUTE = 60_000;
export const MS_PER_HOUR = 3_600_000;
export const MS_PER_DAY = 86_400_000;

/** daily-verses.json always has this many references (Feb 29 gets its own). */
const DAILY_VERSE_SLOTS = 366;

/** Days in each month of a leap year. Used so every date has one fixed slot. */
const LEAP_MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

const MONTHS: Record<LangCode, readonly string[]> = {
  en: [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ],
  fil: [
    'Enero', 'Pebrero', 'Marso', 'Abril', 'Mayo', 'Hunyo',
    'Hulyo', 'Agosto', 'Setyembre', 'Oktubre', 'Nobyembre', 'Disyembre',
  ],
};

/** Index 0 is Sunday, matching Date.getDay(). */
const WEEKDAYS: Record<LangCode, readonly string[]> = {
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  fil: ['Linggo', 'Lunes', 'Martes', 'Miyerkules', 'Huwebes', 'Biyernes', 'Sabado'],
};

/* ------------------------------------------------------------------ */
/* Basics                                                              */
/* ------------------------------------------------------------------ */

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** Midnight at the start of the given local day. Returns a new Date. */
export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * Add whole calendar days. Uses the calendar, not 24-hour blocks, so a
 * daylight-saving change cannot push the result onto the wrong day.
 */
export function addDays(date: Date, days: number): Date {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + days,
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
    date.getMilliseconds(),
  );
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Whole calendar days from `from` to `to` (negative if `to` is earlier). */
export function daysBetween(from: Date, to: Date): number {
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b - a) / MS_PER_DAY);
}

/** "2026-10-30", the local date. Good as a key for "done today" records. */
export function toDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** Inverse of toDateKey. Returns null for anything that is not a real date. */
export function fromDateKey(key: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  const valid =
    date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
  return valid ? date : null;
}

/* ------------------------------------------------------------------ */
/* Daily verse                                                         */
/* ------------------------------------------------------------------ */

/**
 * Position of the date in a fixed 366-day calendar, 0 to 365. Every year is
 * treated as a leap year, so March 1 is always slot 60 and December 31 is
 * always slot 365. The same calendar date therefore gets the same verse every
 * year, in every leap or non-leap year, for everyone, with no internet.
 *
 * Use it as: references[dailyVerseIndex(new Date())].
 */
export function dailyVerseIndex(date: Date): number {
  const month = date.getMonth();
  let slot = date.getDate() - 1;
  for (let m = 0; m < month; m += 1) slot += LEAP_MONTH_DAYS[m] ?? 0;
  return slot % DAILY_VERSE_SLOTS;
}

/* ------------------------------------------------------------------ */
/* Time of day ("HH:mm", the notification time setting)                */
/* ------------------------------------------------------------------ */

export interface TimeOfDay {
  hour: number;
  minute: number;
}

/** Parse "07:30" or "7:30". Returns null if it is not a valid 24-hour time. */
export function parseTimeOfDay(value: string): TimeOfDay | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

/** Always "HH:mm", the form stored in settings. */
export function formatTimeOfDay(time: TimeOfDay): string {
  return `${pad2(time.hour)}:${pad2(time.minute)}`;
}

/**
 * Time for display, following the person's 12 or 24 hour preference:
 * "7:30 AM" or "07:30".
 */
export function formatTimeLabel(time: TimeOfDay, use24Hour: boolean): string {
  if (use24Hour) return formatTimeOfDay(time);
  const suffix = time.hour >= 12 ? 'PM' : 'AM';
  const hour12 = time.hour % 12 === 0 ? 12 : time.hour % 12;
  return `${hour12}:${pad2(time.minute)} ${suffix}`;
}

/**
 * The next `count` moments at `time`, one per day, for scheduling the daily
 * verse notifications (the app schedules 14 days ahead on every open). Today
 * is skipped when that time has already passed.
 */
export function nextTriggerDates(time: TimeOfDay, count: number, now: Date = new Date()): Date[] {
  const dates: Date[] = [];
  if (count <= 0) return dates;

  const todayAtTime = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    time.hour,
    time.minute,
    0,
    0,
  );
  const firstOffset = todayAtTime.getTime() > now.getTime() ? 0 : 1;

  for (let i = 0; i < count; i += 1) {
    dates.push(addDays(todayAtTime, firstOffset + i));
  }
  return dates;
}

/* ------------------------------------------------------------------ */
/* Display                                                             */
/* ------------------------------------------------------------------ */

export function monthName(monthIndex: number, lang: LangCode): string {
  return MONTHS[lang][monthIndex] ?? '';
}

export function weekdayName(dayIndex: number, lang: LangCode): string {
  return WEEKDAYS[lang][dayIndex] ?? '';
}

/**
 * The line at the top of the Today screen.
 *   en:  "Friday, October 30"
 *   fil: "Biyernes, Oktubre 30"
 * Pass includeYear for backups and the About screen.
 */
export function formatLongDate(date: Date, lang: LangCode, includeYear = false): string {
  const weekday = weekdayName(date.getDay(), lang);
  const month = monthName(date.getMonth(), lang);
  const base = `${weekday}, ${month} ${date.getDate()}`;
  return includeYear ? `${base}, ${date.getFullYear()}` : base;
}

/** "2026-10-30 14:05", for backup file names and the "last checked" line. */
export function formatDateTimeStamp(date: Date): string {
  return `${toDateKey(date)} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/** Same as formatDateTimeStamp but safe inside a file name: "2026-10-30_1405". */
export function formatFileStamp(date: Date): string {
  return `${toDateKey(date)}_${pad2(date.getHours())}${pad2(date.getMinutes())}`;
}

/* ------------------------------------------------------------------ */
/* Elapsed time                                                        */
/* ------------------------------------------------------------------ */

/**
 * True when `timestampMs` is at least `ageMs` old. A timestamp of 0 (never)
 * is always old. A timestamp in the future (clock was changed) is treated as
 * old too, so the update check can never get stuck waiting on a wrong clock.
 */
export function isOlderThan(timestampMs: number, ageMs: number, now: number = Date.now()): boolean {
  if (timestampMs <= 0) return true;
  if (timestampMs > now) return true;
  return now - timestampMs >= ageMs;
}

/**
 * Short relative label for "Last checked": "just now", "5 min ago",
 * "3 h ago", "2 days ago", or "never" for 0. Kept as plain pieces so i18n
 * can translate: the caller maps `unit` to a string.
 */
export interface Elapsed {
  unit: 'never' | 'now' | 'minutes' | 'hours' | 'days';
  value: number;
}

export function elapsedSince(timestampMs: number, now: number = Date.now()): Elapsed {
  if (timestampMs <= 0) return { unit: 'never', value: 0 };
  const diff = Math.max(0, now - timestampMs);
  if (diff < MS_PER_MINUTE) return { unit: 'now', value: 0 };
  if (diff < MS_PER_HOUR) return { unit: 'minutes', value: Math.floor(diff / MS_PER_MINUTE) };
  if (diff < MS_PER_DAY) return { unit: 'hours', value: Math.floor(diff / MS_PER_HOUR) };
  return { unit: 'days', value: Math.floor(diff / MS_PER_DAY) };
}
