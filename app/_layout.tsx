import { Stack, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { useI18n } from '@/i18n';
import { initBibleService } from '@/services/bibleService';
import {
  getLaunchNotificationTarget,
  installNotificationHandler,
  onNotificationOpened,
  syncDailyVerseNotifications,
  type NotificationLabels,
  type NotificationTarget,
} from '@/services/notificationService';
import { tidyDownloads } from '@/services/updateService';
import { hasUnseenWhatsNew } from '@/services/whatsNewService';
// Importing this module is what runs TaskManager.defineTask, at module level, on
// every start of the JS engine (including a background start with no screen).
import { syncBackgroundTasks } from '@/tasks/backgroundTasks';
import { ensureSettingsLoaded, selectSettings, useSettingsStore } from '@/store/settingsStore';
import { useReaderStore } from '@/store/readerStore';
import { ThemeProvider, useTheme } from '@/theme/ThemeProvider';
import { space } from '@/theme/tokens';
import { parseVerseId } from '@/utils/reference';

/**
 * Root layout. Three jobs, in this order:
 *
 *  1. Boot. Keep the splash screen up until the settings are read from
 *     user.db, the bundled Bible packs are in place (the first launch copies
 *     them out of the APK) and the last-read chapter is known. If something
 *     fails the person sees a plain message with a Retry button instead of a
 *     blank screen.
 *  2. Theme. Everything below ThemeProvider follows the saved theme, high
 *     contrast and Lite mode, so a change in Appearance shows at once.
 *  3. Shell. The navigator, the daily-verse notification schedule, the
 *     background update task, "What's new" after an update, and what happens
 *     when a notification is tapped.
 *
 * The reading font needs no loading code: the expo-font plugin in app.json
 * embeds the three Literata files into the APK.
 */

SplashScreen.preventAutoHideAsync().catch(() => {
  // Already hidden or not available: nothing to do.
});

installNotificationHandler();

/** Ignore a second tap on the same notification that arrives within this time (cold start delivers it twice). */
const DUPLICATE_TAP_WINDOW_MS = 3_000;

function runAfterInteractions(callback: () => void): { cancel: () => void } {
  const timer = setTimeout(callback, 100);
  return { cancel: () => clearTimeout(timer) };
}

/* ------------------------------------------------------------------ */
/* Notification schedule                                               */
/* ------------------------------------------------------------------ */

let syncChain: Promise<void> = Promise.resolve();

/** Runs schedule updates one after another, so two quick setting changes cannot interleave. */
function queueNotificationSync(run: () => Promise<unknown>): void {
  syncChain = syncChain.then(run).then(
    () => undefined,
    () => undefined,
  );
}

/* ------------------------------------------------------------------ */
/* Shell                                                               */
/* ------------------------------------------------------------------ */

function AppShell() {
  const router = useRouter();
  const { colors, animationsEnabled } = useTheme();
  const { t } = useI18n();
  const settings = useSettingsStore(selectSettings);
  const { notificationsEnabled, notificationTime, translation, uiLanguage, updateMode } = settings;

  const lastTap = useRef<{ key: string; at: number } | null>(null);

  const notificationLabels = useMemo<NotificationLabels>(
    () => ({
      title: t('notifications.title'),
      channelName: t('notifications.channelName'),
      channelDescription: t('notifications.channelDescription'),
    }),
    [t],
  );

  // Keep the next 14 days of verse notifications in step with the settings.
  // Runs on open and whenever the toggle, time, translation or language change.
  useEffect(() => {
    const task = runAfterInteractions(() => {
      queueNotificationSync(() =>
        syncDailyVerseNotifications(
          { notificationsEnabled, notificationTime, translation },
          uiLanguage,
          notificationLabels,
        ),
      );
    });
    return () => task.cancel();
  }, [notificationsEnabled, notificationTime, translation, uiLanguage, notificationLabels]);

  // Keep the background task (update check and reminder refresh) registered
  // only while an update check or a reminder is wanted.
  useEffect(() => {
    const task = runAfterInteractions(() => {
      void syncBackgroundTasks();
    });
    return () => task.cancel();
  }, [updateMode, notificationsEnabled]);

  // Once per start, remove download leftovers and APKs from earlier updates.
  // No installer can be open at launch, and nothing is downloading yet.
  useEffect(() => {
    const task = runAfterInteractions(() => {
      tidyDownloads({ apks: true });
    });
    return () => task.cancel();
  }, []);

  // After an update, show "What's new" once. A fresh install shows nothing:
  // hasUnseenWhatsNew() records the version and returns false. The check runs
  // once per start, a moment after the first screen is up.
  useEffect(() => {
    let active = true;
    const task = runAfterInteractions(() => {
      void hasUnseenWhatsNew().then((unseen) => {
        if (active && unseen) router.push('/whats-new');
      });
    });
    return () => {
      active = false;
      task.cancel();
    };
    // Only on the first run of the shell: opening the screen marks it as seen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tapping a notification opens the verse in context. The reader always shows
  // the translation chosen in Settings, so only the reference is used here.
  const openTarget = useCallback(
    (target: NotificationTarget): void => {
      const key = `${target.verseId}:${target.translation}`;
      const now = Date.now();
      const previous = lastTap.current;
      if (previous && previous.key === key && now - previous.at < DUPLICATE_TAP_WINDOW_MS) return;
      lastTap.current = { key, at: now };

      const ref = parseVerseId(target.verseId);
      router.push({
        pathname: '/reader/[book]/[chapter]',
        params: {
          book: String(ref.book),
          chapter: String(ref.chapter),
          verse: String(ref.verse),
        },
      });
    },
    [router],
  );

  useEffect(() => {
    let active = true;
    getLaunchNotificationTarget()
      .then((target) => {
        if (active && target) openTarget(target);
      })
      .catch(() => {
        // No launch notification, or it could not be read: open normally.
      });
    const stopListening = onNotificationOpened(openTarget);
    return () => {
      active = false;
      stopListening();
    };
  }, [openTarget]);

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        headerShadowVisible: false,
        headerTitleAlign: 'left',
        contentStyle: { backgroundColor: colors.background },
        animation: animationsEnabled ? 'fade' : 'none',
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="reader/[book]/[chapter]" options={{ headerShown: false }} />
      <Stack.Screen name="books" options={{ title: t('books.title') }} />
      <Stack.Screen name="translations" options={{ title: t('translations.title') }} />
      <Stack.Screen name="updates" options={{ title: t('updates.title') }} />
      <Stack.Screen name="plans" options={{ title: t('plans.title') }} />
      <Stack.Screen name="backup" options={{ title: t('backup.title') }} />
      <Stack.Screen name="whats-new" options={{ title: t('whatsNew.title') }} />
      <Stack.Screen name="note-editor" options={{ title: t('noteEditor.title') }} />
      <Stack.Screen name="appearance" options={{ title: t('appearance.title') }} />
      <Stack.Screen name="about" options={{ title: t('about.title') }} />
      <Stack.Screen name="+not-found" options={{ headerShown: false }} />
    </Stack>
  );
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

type BootState = 'booting' | 'ready' | 'error';

function BootError({ onRetry }: { onRetry: () => void }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.bootError,
        {
          backgroundColor: colors.background,
          paddingTop: insets.top + space.xl,
          paddingBottom: insets.bottom + space.xl,
        },
      ]}
    >
      <Text variant="title" style={styles.centered}>
        {t('boot.errorTitle')}
      </Text>
      <Text variant="body" tone="muted" style={[styles.centered, styles.errorBody]}>
        {t('boot.errorBody')}
      </Text>
      <Button label={t('common.retry')} variant="filled" onPress={onRetry} />
    </View>
  );
}

function Boot() {
  const [state, setState] = useState<BootState>('booting');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        // Independent of each other, so they run side by side.
        await Promise.all([
          ensureSettingsLoaded(),
          initBibleService(),
          useReaderStore.getState().restore(),
        ]);
        if (!cancelled) setState('ready');
      } catch {
        if (!cancelled) setState('error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [attempt]);

  useEffect(() => {
    if (state !== 'booting') {
      SplashScreen.hideAsync().catch(() => {
        // Already hidden: nothing to do.
      });
    }
  }, [state]);

  const retry = useCallback((): void => {
    setState('booting');
    setAttempt((value) => value + 1);
  }, []);

  if (state === 'booting') return null;
  if (state === 'error') return <BootError onRetry={retry} />;
  return <AppShell />;
}

/* ------------------------------------------------------------------ */
/* Root                                                                */
/* ------------------------------------------------------------------ */

export default function RootLayout() {
  // One primitive per selector: a selector that builds a new object on every
  // call would make the store re-render this component forever.
  const theme = useSettingsStore((state) => state.settings.theme);
  const highContrast = useSettingsStore((state) => state.settings.highContrast);
  const liteMode = useSettingsStore((state) => state.settings.liteMode);

  return (
    <SafeAreaProvider>
      <ThemeProvider themeName={theme} highContrast={highContrast} liteMode={liteMode}>
        <Boot />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  bootError: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xl,
  },
  centered: {
    textAlign: 'center',
  },
  errorBody: {
    marginTop: space.md,
    marginBottom: space.xl,
  },
});
