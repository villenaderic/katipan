import type { LangCode } from '../types';
import { BOOKS, bookName } from './books';

/**
 * Reading plans. The plans are not stored as data: each one is a list of
 * chapters in reading order, spread evenly over its days by one small
 * function, so there is no big file to keep correct and nothing to download.
 * Every chapter of the plan appears exactly once, in canon order.
 *
 * A plan is a SEQUENCE, not a calendar. Day 12 is the twelfth reading, not
 * "the 12th of the month", so a person who misses a week is not behind: the
 * next reading is simply the first one not yet read. That is how the app keeps
 * its promise of no guilt (see planService.ts).
 *
 * Book ids follow the canon order in books.ts: 19 Psalms, 20 Proverbs,
 * 40 Matthew, 66 Revelation.
 *
 * Names and descriptions are translated in i18n under plans.<id>.name and
 * plans.<id>.about.
 */

export const PLAN_IDS = ['bible-year', 'nt-90', 'psalms-proverbs'] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export function isPlanId(value: unknown): value is PlanId {
  return typeof value === 'string' && (PLAN_IDS as readonly string[]).includes(value);
}

export interface PlanChapter {
  readonly book: number;
  readonly chapter: number;
}

export interface PlanDay {
  /** 1-based position in the plan. */
  readonly day: number;
  readonly chapters: readonly PlanChapter[];
}


const PSALMS = 19;
const PROVERBS = 20;
const MATTHEW = 40;
const REVELATION = 66;

/** Every chapter of books `first` to `last` (inclusive), in order. */
function chaptersOfBooks(first: number, last: number): PlanChapter[] {
  const list: PlanChapter[] = [];
  for (const book of BOOKS) {
    if (book.id < first || book.id > last) continue;
    for (let chapter = 1; chapter <= book.chapters; chapter += 1) {
      list.push({ book: book.id, chapter });
    }
  }
  return list;
}

/** Cut `list` into `days` runs of nearly equal length. Every run has at least one chapter. */
function spread(list: readonly PlanChapter[], days: number): PlanDay[] {
  const result: PlanDay[] = [];
  for (let day = 1; day <= days; day += 1) {
    const start = Math.floor(((day - 1) * list.length) / days);
    const end = Math.floor((day * list.length) / days);
    result.push({ day, chapters: list.slice(start, end) });
  }
  return result;
}

interface PlanDef {
  readonly id: PlanId;
  readonly totalDays: number;
  readonly chapters: () => PlanChapter[];
}

const PLANS: Readonly<Record<PlanId, PlanDef>> = {
  // All 1,189 chapters, about 3 a day.
  'bible-year': { id: 'bible-year', totalDays: 365, chapters: () => chaptersOfBooks(1, REVELATION) },
  // Matthew to Revelation, 260 chapters, about 3 a day.
  'nt-90': { id: 'nt-90', totalDays: 90, chapters: () => chaptersOfBooks(MATTHEW, REVELATION) },
  // All 150 Psalms, then all 31 chapters of Proverbs, about 3 a day.
  'psalms-proverbs': {
    id: 'psalms-proverbs',
    totalDays: 60,
    chapters: () => [...chaptersOfBooks(PSALMS, PSALMS), ...chaptersOfBooks(PROVERBS, PROVERBS)],
  },
};

const schedules = new Map<PlanId, readonly PlanDay[]>();

/** The whole schedule of a plan, built once and kept. */
export function getPlanDays(id: PlanId): readonly PlanDay[] {
  const cached = schedules.get(id);
  if (cached) return cached;
  const plan = PLANS[id];
  const days = spread(plan.chapters(), plan.totalDays);
  schedules.set(id, days);
  return days;
}

export function getPlanTotalDays(id: PlanId): number {
  return PLANS[id].totalDays;
}

/**
 * Readings as a person would write them: consecutive chapters of one book are
 * joined ("Genesis 1\u20133"), and different books are separated by "; "
 * ("Genesis 50; Exodus 1\u20132").
 */
export function formatReadings(chapters: readonly PlanChapter[], lang: LangCode): string {
  const parts: string[] = [];
  let index = 0;

  while (index < chapters.length) {
    const first = chapters[index];
    if (!first) break;

    let last = first;
    let next = index + 1;
    for (;;) {
      const candidate = chapters[next];
      if (!candidate || candidate.book !== last.book || candidate.chapter !== last.chapter + 1) break;
      last = candidate;
      next += 1;
    }

    const name = bookName(first.book, lang);
    parts.push(
      last.chapter === first.chapter
        ? `${name} ${first.chapter}`
        : `${name} ${first.chapter}\u2013${last.chapter}`,
    );
    index = next;
  }

  return parts.join('; ');
}

/** One chapter as text, for rows that open a single chapter: "Genesis 3". */
export function formatChapter(chapter: PlanChapter, lang: LangCode): string {
  return `${bookName(chapter.book, lang)} ${chapter.chapter}`;
}
