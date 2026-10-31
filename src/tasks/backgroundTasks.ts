import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';

import { UPDATES } from '../constants/config';
import { getTranslator } from '../i18n';
import { initBibleService } from '../services/bibleService';
import {
  syncDailyVerseNotifications,
  type NotificationLabels,
} from '../services/notificationService';
import { checkForUpdates } from '../services/updateService';
import { ensureSettingsLoaded, getSettings } from '../store/settingsStore';

/**
 * The periodic background task (Section 3, Section 8). One task does the two
 * quiet chores that must happen even when the app is closed:
 *
 *   1. Check for updates   checkForUpdates({ manual: false }) decides for
 *                          itself whether to go ahead: update mode Off means
 *                          no check, less than 24 hours since the last check
 *                          means no check, Wi-Fi only means no check on mobile
 *                          data. In "Auto" mode small packs are installed.
 *   2. Refresh reminders   re-schedule the next 14 days of daily verse
 *                          notifications, so the schedule never runs out for
 *                          someone who does not open the app for a while.
 *
 * Android decides when a background task really runs (usually every few
 * hours at best, less often in battery saver). The 24-hour rule lives in
 * updateService, so waking up often costs nothing: a wake-up that has nothing
 * to do ends in a few milliseconds and makes no network request.
 *
 * WIRING (app/_layout.tsx)
 *   - `import '@/tasks/backgroundTasks';` at the top, so defineTask runs on
 *     every start of the JS engine, including a background start. Android can
 *     start the app only to run this task, and a task that was never defined
 *     in that run is silently skipped.
 *   - Call syncBackgroundTasks() after boot, and again whenever the update
 *     mode or the notification toggle changes.
 *
 * Nothing in this file throws. A failure inside the task is reported to
 * Android as Failed, which only makes it wait longer before the next try.
 */

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

const TASK_NAME = UPDATES.backgroundTaskName;

/** A request to Android, in seconds. Android may run it less often. */
const MINIMUM_INTERVAL_SECONDS = Math.round(UPDATES.minIntervalMs / 1000);

/* ------------------------------------------------------------------ */
/* The task                                                            */
/* ------------------------------------------------------------------ */

/**
 * One run of the task. Exported so it can be called from a test or a
 * debug button; Android calls it through TaskManager below.
 */
export async function runBackgroundWork(): Promise<BackgroundFetch.BackgroundFetchResult> {
  let result: BackgroundFetch.BackgroundFetchResult = BackgroundFetch.BackgroundFetchResult.NoData;

  try {
    // The task can run in a fresh JS engine where the app never opened.
    await ensureSettingsLoaded();

    // 1. Updates first, so a new daily verse list is in place before the
    //    notifications below are written from it.
    try {
      await initBibleService();
      const outcome = await checkForUpdates({ manual: false });
      if (outcome === 'updated') {
        result = BackgroundFetch.BackgroundFetchResult.NewData;
      } else if (outcome === 'error') {
        result = BackgroundFetch.BackgroundFetchResult.Failed;
      }
    } catch {
      result = BackgroundFetch.BackgroundFetchResult.Failed;
    }

    // 2. Reminders. Read the settings again: a check in Auto mode does not
    //    change them, but the person may have changed them in the meantime.
    try {
      const current = getSettings();
      const t = getTranslator(current.uiLanguage);
      const labels: NotificationLabels = {
        title: t('notifications.title'),
        channelName: t('notifications.channelName'),
        channelDescription: t('notifications.channelDescription'),
      };
      await syncDailyVerseNotifications(
        {
          notificationsEnabled: current.notificationsEnabled,
          notificationTime: current.notificationTime,
          translation: current.translation,
        },
        current.uiLanguage,
        labels,
      );
    } catch {
      // The next run tries again.
    }
  } catch {
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }

  return result;
}

// Must run at module level, not inside a component or an effect.
TaskManager.defineTask(TASK_NAME, runBackgroundWork);

/* ------------------------------------------------------------------ */
/* Registration                                                        */
/* ------------------------------------------------------------------ */

/** True when the person's settings call for the task to exist at all. */
function isTaskWanted(): boolean {
  const settings = getSettings();
  return settings.updateMode !== 'off' || settings.notificationsEnabled;
}

async function isRegistered(): Promise<boolean> {
  try {
    return await TaskManager.isTaskRegisteredAsync(TASK_NAME);
  } catch {
    return false;
  }
}

/**
 * Make the registration match the settings: register the task while an
 * update check or a daily reminder is wanted, remove it when neither is.
 * Safe to call as often as needed (after boot, after a settings change).
 * Returns true when the task is registered afterwards.
 */
export async function syncBackgroundTasks(): Promise<boolean> {
  try {
    await ensureSettingsLoaded();
    const registered = await isRegistered();

    if (!isTaskWanted()) {
      if (registered) await BackgroundFetch.unregisterTaskAsync(TASK_NAME);
      return false;
    }

    // Background work switched off by the phone (battery saver, restricted app).
    const status = await BackgroundFetch.getStatusAsync();
    if (
      status === BackgroundFetch.BackgroundFetchStatus.Denied ||
      status === BackgroundFetch.BackgroundFetchStatus.Restricted
    ) {
      return registered;
    }

    // Registering again with the same name replaces the old registration, so
    // an interval change in a later version takes effect without extra code.
    await BackgroundFetch.registerTaskAsync(TASK_NAME, {
      minimumInterval: MINIMUM_INTERVAL_SECONDS,
      stopOnTerminate: false,
      startOnBoot: true,
    });
    return true;
  } catch {
    return false;
  }
}

/** Remove the task. Used when the person turns everything off. */
export async function unregisterBackgroundTasks(): Promise<void> {
  try {
    if (await isRegistered()) await BackgroundFetch.unregisterTaskAsync(TASK_NAME);
  } catch {
    // Not registered, or the phone refused: either way there is nothing left to stop.
  }
}
