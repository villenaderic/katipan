import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { getDailyVerse, type DailyVerse } from '../services/dailyVerseService';
import { selectSettings, useSettingsStore } from '../store/settingsStore';
import { addDays, startOfDay, toDateKey } from '../utils/date';

/**
 * Today's verse for the Today screen.
 *
 *  - Works offline: the reference comes from the bundled list and the text from
 *    an installed pack.
 *  - Follows the settings: a different translation or interface language
 *    updates the verse at once.
 *  - Follows the calendar: when the phone's date changes (the app was left
 *    open past midnight, or comes back to the foreground on a new day) the
 *    verse changes without the person doing anything.
 *
 * It does not return a loading spinner state for the common case: the verse
 * is read from local files in a few milliseconds, so `verse` simply appears.
 * While the first read is running `status` is "loading".
 */

export type DailyVerseStatus = 'loading' | 'ready' | 'error';

export interface UseDailyVerse {
  status: DailyVerseStatus;
  /** Null until status is "ready". */
  verse: DailyVerse | null;
  /** Try again after an error. */
  retry: () => void;
}

/** Milliseconds until the phone's next midnight, plus a second of margin. */
function msUntilMidnight(now: Date = new Date()): number {
  const midnight = addDays(startOfDay(now), 1);
  return Math.max(1_000, midnight.getTime() - now.getTime() + 1_000);
}

/** The current calendar date, "2026-10-30". Changes at the person's midnight. */
function useTodayKey(): string {
  const [key, setKey] = useState(() => toDateKey(new Date()));

  useEffect(() => {
    const update = (): void => {
      const next = toDateKey(new Date());
      setKey((current) => (current === next ? current : next));
    };

    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = (): void => {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => {
        update();
        schedule();
      }, msUntilMidnight());
    };
    schedule();

    // Timers can pause while the app is in the background, so check again on return.
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        update();
        schedule();
      }
    });

    return () => {
      if (timer !== undefined) clearTimeout(timer);
      subscription.remove();
    };
  }, []);

  return key;
}

export function useDailyVerse(): UseDailyVerse {
  const { translation, uiLanguage } = useSettingsStore(selectSettings);
  const todayKey = useTodayKey();

  const [status, setStatus] = useState<DailyVerseStatus>('loading');
  const [verse, setVerse] = useState<DailyVerse | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const found = await getDailyVerse(translation, uiLanguage, new Date());
        if (cancelled) return;
        if (found) {
          setVerse(found);
          setStatus('ready');
        } else {
          setStatus('error');
        }
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
    };
    // todayKey is a dependency on purpose: a new day must read a new verse.
  }, [translation, uiLanguage, todayKey, attempt]);

  const retry = useCallback((): void => {
    setStatus('loading');
    setAttempt((value) => value + 1);
  }, []);

  return { status, verse, retry };
}
