import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { UPDATES } from '../constants/config';
import type { LangCode, Settings, VerseId } from '../types';
import { nextTriggerDates, parseTimeOfDay } from '../utils/date';
import { truncate } from '../utils/format';
import { getDailyVersesAhead } from './dailyVerseService';

/**
 * Daily verse notifications. Local only: no push server, no token, no network.
 *
 *  - One notification per day, at the time the person chose.
 *  - The next 14 days are scheduled every time the app opens or the update
 *    task runs (call syncDailyVerseNotifications). Each run cancels the old
 *    ones first, so a changed time, language or translation takes effect at
 *    once and nothing is ever doubled.
 *  - Turning notifications off cancels everything.
 *  - Permission is asked only when the person turns the toggle on, never at
 *    first launch.
 *
 * Every visible string comes from the caller (built from i18n), so this file
 * has no text of its own.
 */

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

/** Strings the caller takes from i18n. */
export interface NotificationLabels {
  /** Title of every notification, for example "Today's verse". */
  title: string;
  /** Android channel name, shown in the phone's notification settings. */
  channelName: string;
  /** Android channel description. */
  channelDescription: string;
}

/** Data carried by a notification, used to open the verse in context on tap. */
export interface NotificationTarget {
  verseId: VerseId;
  translation: string;
}

export type NotificationPermission = 'granted' | 'denied' | 'undetermined';

export type SyncResult =
  | { status: 'scheduled'; count: number }
  | { status: 'disabled' }
  | { status: 'no-permission' }
  | { status: 'invalid-time' };

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

const CHANNEL_ID = 'daily-verse';

/** Android shows about this many characters of the body before cutting it off. */
const BODY_MAX_CHARS = 180;

/* ------------------------------------------------------------------ */
/* Setup                                                               */
/* ------------------------------------------------------------------ */

let handlerInstalled = false;

/**
 * Call once at startup (app/_layout.tsx). While the app is open a daily verse
 * notification is shown quietly: no sound, no badge.
 */
export function installNotificationHandler(): void {
  if (handlerInstalled) return;
  handlerInstalled = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

async function ensureChannel(labels: NotificationLabels): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: labels.channelName,
    description: labels.channelDescription,
    importance: Notifications.AndroidImportance.DEFAULT,
    sound: null,
    vibrationPattern: null,
    enableVibrate: false,
    showBadge: false,
  });
}

/* ------------------------------------------------------------------ */
/* Permission                                                          */
/* ------------------------------------------------------------------ */

export async function getNotificationPermission(): Promise<NotificationPermission> {
  const result = await Notifications.getPermissionsAsync();
  if (result.granted) return 'granted';
  return result.canAskAgain ? 'undetermined' : 'denied';
}

/**
 * Ask for permission (Android 13+ shows a system dialog; older versions grant
 * it automatically). Call this when the person turns the toggle on.
 */
export async function requestNotificationPermission(
  labels: NotificationLabels,
): Promise<NotificationPermission> {
  // Android 13+ only shows the permission dialog once a channel exists.
  await ensureChannel(labels);
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return 'granted';
  if (!current.canAskAgain) return 'denied';

  const asked = await Notifications.requestPermissionsAsync();
  if (asked.granted) return 'granted';
  return asked.canAskAgain ? 'undetermined' : 'denied';
}

/* ------------------------------------------------------------------ */
/* Scheduling                                                          */
/* ------------------------------------------------------------------ */

/** Cancel every scheduled daily verse notification. Safe to call at any time. */
export async function cancelDailyVerseNotifications(): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync();
}

/**
 * Make the schedule match the settings: cancel what is scheduled, then
 * schedule the next 14 days. Call on app open, after any change to the
 * notification settings, and from the background update task.
 *
 * Never throws for a normal "cannot schedule" situation; it returns a status
 * instead, so callers in the background task do not need a try/catch for it.
 */
export async function syncDailyVerseNotifications(
  settings: Pick<Settings, 'notificationsEnabled' | 'notificationTime' | 'translation'>,
  lang: LangCode,
  labels: NotificationLabels,
  now: Date = new Date(),
): Promise<SyncResult> {
  await cancelDailyVerseNotifications();

  if (!settings.notificationsEnabled) return { status: 'disabled' };

  const time = parseTimeOfDay(settings.notificationTime);
  if (!time) return { status: 'invalid-time' };

  if ((await getNotificationPermission()) !== 'granted') {
    return { status: 'no-permission' };
  }

  await ensureChannel(labels);

  const triggers = nextTriggerDates(time, UPDATES.notificationDaysAhead, now);
  if (triggers.length === 0) return { status: 'scheduled', count: 0 };

  // The verse must match the day it is delivered. The first trigger may be
  // tomorrow (when today's time has passed), so ask for verses starting on
  // the first trigger's own date.
  const first = triggers[0];
  if (!first) return { status: 'scheduled', count: 0 };
  const verses = await getDailyVersesAhead(
    settings.translation,
    lang,
    triggers.length,
    first,
  );
  const byDate = new Map(verses.map((verse) => [verse.date, verse]));

  let count = 0;
  for (const when of triggers) {
    const key = `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, '0')}-${String(
      when.getDate(),
    ).padStart(2, '0')}`;
    const verse = byDate.get(key);
    if (!verse) continue;

    const target: NotificationTarget = {
      verseId: verse.verseId,
      translation: verse.translation,
    };

    await Notifications.scheduleNotificationAsync({
      content: {
        title: labels.title,
        subtitle: verse.reference,
        body: truncate(`${verse.reference}  ${verse.text}`, BODY_MAX_CHARS),
        data: { ...target },
        sound: false,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: when,
        channelId: CHANNEL_ID,
      },
    });
    count += 1;
  }

  return { status: 'scheduled', count };
}

/* ------------------------------------------------------------------ */
/* Tap handling                                                        */
/* ------------------------------------------------------------------ */

/**
 * Read the data of a tapped notification. Returns null for anything that is
 * not one of ours or is malformed, so the caller can simply ignore it.
 */
export function parseNotificationTarget(data: unknown): NotificationTarget | null {
  if (typeof data !== 'object' || data === null) return null;
  const candidate = data as { verseId?: unknown; translation?: unknown };
  const { verseId, translation } = candidate;
  if (typeof verseId !== 'number' || !Number.isInteger(verseId) || verseId <= 0) return null;
  if (typeof translation !== 'string' || translation.length === 0) return null;
  return { verseId, translation };
}

/**
 * Subscribe to taps on a notification. Returns a function that removes the
 * listener. Use from app/_layout.tsx and route to
 * /reader/[book]/[chapter] using parseVerseId(target.verseId).
 */
export function onNotificationOpened(callback: (target: NotificationTarget) => void): () => void {
  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    const target = parseNotificationTarget(response.notification.request.content.data);
    if (target) callback(target);
  });
  return () => subscription.remove();
}

/**
 * The target of the notification that launched the app from a closed state,
 * if any. Call once at startup.
 */
export async function getLaunchNotificationTarget(): Promise<NotificationTarget | null> {
  const response = await Notifications.getLastNotificationResponseAsync();
  if (!response) return null;
  return parseNotificationTarget(response.notification.request.content.data);
}
