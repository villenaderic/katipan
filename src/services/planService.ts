import { getUserDb } from '../db/client';
import { getPlanProgress, saveSetting, setPlanDayDone } from '../db/queries/user';
import {
  getPlanDays,
  getPlanTotalDays,
  isPlanId,
  PLAN_IDS,
  type PlanChapter,
  type PlanId,
} from '../constants/plans';
import { addDays, startOfDay, toDateKey } from '../utils/date';

/**
 * Reading plans: which plan is active, what has been read, and what is next.
 *
 * THE RULES THAT KEEP IT KIND
 *   - A plan is a sequence, not a calendar. "Next" is the first reading not
 *     yet marked as read. There is no deadline, no "days behind", no "you
 *     missed", and nothing is ever shown in red.
 *   - The streak is only ever good news. It counts the days in a row, up to
 *     today or yesterday, on which something was marked as read. When the run
 *     is broken it is simply not mentioned: there is no "streak lost".
 *   - Catch-up is the person's choice: "I have read everything up to here"
 *     marks the earlier days as read in one tap (for someone who read in
 *     another Bible, or wants to skip ahead).
 *   - Stopping a plan keeps its progress. Starting it again carries on where
 *     it was. Only "Start over" clears it, and only when asked.
 *
 * WHERE IT IS STORED (user.db, never touched by updates)
 *   plan_progress(plan_id, day, done_at)   one row per day read
 *   settings 'activePlanId'                which plan is active, or null
 */

const ACTIVE_KEY = 'activePlanId';

export interface PlanState {
  readonly planId: PlanId;
  readonly totalDays: number;
  /** Days marked as read. */
  readonly doneDays: ReadonlySet<number>;
  readonly doneCount: number;
  /** The first day not yet read, or null when every day has been read. */
  readonly nextDay: number | null;
  /** Days in a row with something read, ending today or yesterday. 0 when the run is broken. */
  readonly streak: number;
}

export interface TodayPlanItem {
  readonly planId: PlanId;
  readonly day: number;
  readonly totalDays: number;
  readonly chapters: readonly PlanChapter[];
}

/* ------------------------------------------------------------------ */
/* Which plan is active                                                */
/* ------------------------------------------------------------------ */

export async function getActivePlanId(): Promise<PlanId | null> {
  const db = await getUserDb();
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM settings WHERE key = ?',
    ACTIVE_KEY,
  );
  if (!row) return null;
  try {
    const parsed: unknown = JSON.parse(row.value);
    return isPlanId(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Make this the active plan. Earlier progress on it, if any, is kept. */
export async function startPlan(id: PlanId): Promise<void> {
  await saveSetting(await getUserDb(), ACTIVE_KEY, id);
}

/** No plan is active any more. Progress is kept. */
export async function stopPlan(): Promise<void> {
  await saveSetting(await getUserDb(), ACTIVE_KEY, null);
}

/** Erase the progress of one plan, so it begins again at day 1. */
export async function restartPlan(id: PlanId): Promise<void> {
  const db = await getUserDb();
  await db.runAsync('DELETE FROM plan_progress WHERE plan_id = ?', id);
}

/* ------------------------------------------------------------------ */
/* Progress                                                            */
/* ------------------------------------------------------------------ */

/** Consecutive days with a reading, counted back from today (or from yesterday if today has none yet). */
function countStreak(doneAt: readonly number[], now: Date): number {
  const keys = new Set<string>(doneAt.map((ms) => toDateKey(new Date(ms))));

  const today = startOfDay(now);
  let cursor = keys.has(toDateKey(today)) ? today : addDays(today, -1);

  let streak = 0;
  while (keys.has(toDateKey(cursor))) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

export async function getPlanState(id: PlanId, now: Date = new Date()): Promise<PlanState> {
  const rows = await getPlanProgress(await getUserDb(), id);
  const totalDays = getPlanTotalDays(id);

  const doneDays = new Set<number>();
  for (const row of rows) {
    if (row.day >= 1 && row.day <= totalDays) doneDays.add(row.day);
  }

  let nextDay: number | null = null;
  for (let day = 1; day <= totalDays; day += 1) {
    if (!doneDays.has(day)) {
      nextDay = day;
      break;
    }
  }

  return {
    planId: id,
    totalDays,
    doneDays,
    doneCount: doneDays.size,
    nextDay,
    streak: countStreak(
      rows.map((row) => row.done_at),
      now,
    ),
  };
}

/** The state of every plan, for the list where a plan is chosen. */
export async function getAllPlanStates(): Promise<PlanState[]> {
  return Promise.all(PLAN_IDS.map((id) => getPlanState(id)));
}

/** Mark one day as read, or as not read. */
export async function setDayDone(id: PlanId, day: number, done: boolean): Promise<void> {
  if (!Number.isInteger(day) || day < 1 || day > getPlanTotalDays(id)) return;
  await setPlanDayDone(await getUserDb(), id, day, done);
}

/** Mark days 1 to `day` as read, in one step. Days already read are left as they are. */
export async function markDaysThrough(id: PlanId, day: number): Promise<void> {
  const last = Math.min(Math.floor(day), getPlanTotalDays(id));
  if (last < 1) return;
  const db = await getUserDb();
  await db.withTransactionAsync(async () => {
    for (let current = 1; current <= last; current += 1) {
      await setPlanDayDone(db, id, current, true);
    }
  });
}

/* ------------------------------------------------------------------ */
/* For the Today screen                                                */
/* ------------------------------------------------------------------ */

/**
 * The next reading of the active plan, or null when there is no active plan
 * or it has been finished. Never throws: Today must always open.
 */
export async function getTodayPlanItem(): Promise<TodayPlanItem | null> {
  try {
    const planId = await getActivePlanId();
    if (planId === null) return null;

    const state = await getPlanState(planId);
    if (state.nextDay === null) return null;

    const day = getPlanDays(planId)[state.nextDay - 1];
    if (!day) return null;

    return { planId, day: day.day, totalDays: state.totalDays, chapters: day.chapters };
  } catch {
    return null;
  }
}
