import { useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Linking, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { Divider } from '@/components/ui/Divider';
import { Row } from '@/components/ui/Row';
import { Sheet } from '@/components/ui/Sheet';
import { Text } from '@/components/ui/Text';
import { READER } from '@/constants/config';
import { useI18n } from '@/i18n';
import {
  requestNotificationPermission,
  type NotificationLabels,
} from '@/services/notificationService';
import { selectHasUpdate, useDownloadsStore } from '@/store/downloadsStore';
import { selectSettings, useSettingsStore } from '@/store/settingsStore';
import { useTheme } from '@/theme/ThemeProvider';
import { space } from '@/theme/tokens';
import { formatTimeLabel, formatTimeOfDay, parseTimeOfDay, type TimeOfDay } from '@/utils/date';

/**
 * More tab: settings and the quiet corners of the app.
 *
 *  - Daily verse reminder: one toggle and one time. One notification a day,
 *    at the chosen time. Turning it on asks for permission; if the phone
 *    refuses, the toggle stays off and a plain line explains how to allow it.
 *    The schedule itself is kept in step by the root layout whenever these
 *    two settings change, so nothing is scheduled here.
 *  - Appearance, Translations, Updates, About and Privacy: rows that open
 *    their own screens. The Updates row shows a quiet "Update available"
 *    line, never a badge or a number.
 *
 * Every string comes from i18n.
 */

/** Hours offered for the reminder, 5 AM to 10 PM. */
const FIRST_HOUR = 5;
const LAST_HOUR = 22;

/** Ignore a second tap on the same control inside this time. */
const DOUBLE_TAP_MS = 800;

const REMINDER_TIMES: readonly TimeOfDay[] = Array.from(
  { length: LAST_HOUR - FIRST_HOUR + 1 },
  (_, index) => ({ hour: FIRST_HOUR + index, minute: 0 }),
);

type ReminderNotice = 'none' | 'blocked';

export default function MoreScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useI18n();
  const { notificationsEnabled, notificationTime, translation } = useSettingsStore(selectSettings);
  const setSetting = useSettingsStore((state) => state.setSetting);
  const hasUpdate = useDownloadsStore(selectHasUpdate);

  const [timeSheetOpen, setTimeSheetOpen] = useState(false);
  const [notice, setNotice] = useState<ReminderNotice>('none');
  const [asking, setAsking] = useState(false);
  const lastTap = useRef(0);

  const acceptTap = useCallback((): boolean => {
    const now = Date.now();
    if (now - lastTap.current < DOUBLE_TAP_MS) return false;
    lastTap.current = now;
    return true;
  }, []);

  const go = useCallback(
    (path: '/appearance' | '/translations' | '/updates' | '/about'): void => {
      if (!acceptTap()) return;
      router.push(path);
    },
    [acceptTap, router],
  );

  const notificationLabels = useMemo<NotificationLabels>(
    () => ({
      title: t('notifications.title'),
      channelName: t('notifications.channelName'),
      channelDescription: t('notifications.channelDescription'),
    }),
    [t],
  );

  /* ---------------- Daily verse reminder ---------------- */

  const toggleReminder = useCallback((): void => {
    if (asking) return;
    if (notificationsEnabled) {
      setNotice('none');
      setSetting('notificationsEnabled', false);
      return;
    }

    setAsking(true);
    void (async () => {
      try {
        const permission = await requestNotificationPermission(notificationLabels);
        if (permission === 'granted') {
          setNotice('none');
          setSetting('notificationsEnabled', true);
        } else {
          setNotice('blocked');
        }
      } catch {
        setNotice('blocked');
      } finally {
        setAsking(false);
      }
    })();
  }, [asking, notificationsEnabled, notificationLabels, setSetting]);

  const openPhoneSettings = useCallback((): void => {
    Linking.openSettings().catch(() => {
      // The phone could not open its settings: nothing more to do here.
    });
  }, []);

  const chosenTime = useMemo<TimeOfDay>(
    () => parseTimeOfDay(notificationTime) ?? { hour: 7, minute: 0 },
    [notificationTime],
  );
  const timeLabel = formatTimeLabel(chosenTime, false);

  const pickTime = useCallback(
    (time: TimeOfDay): void => {
      setSetting('notificationTime', formatTimeOfDay(time));
      setTimeSheetOpen(false);
    },
    [setSetting],
  );

  const reminderValue = notificationsEnabled ? t('common.on') : t('common.off');

  /* ---------------- Screen ---------------- */

  return (
    <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.content, { paddingBottom: space.xxxl }]}
      >
        <Text variant="title" style={styles.heading}>
          {t('tabs.more')}
        </Text>

        <Text variant="label" tone="muted" accessibilityRole="header" style={styles.section}>
          {t('more.dailyVerse')}
        </Text>
        <Divider />
        <Row
          title={t('more.reminder')}
          value={reminderValue}
          onPress={toggleReminder}
          disabled={asking}
          accessibilityLabel={t('more.reminderA11y', { state: reminderValue })}
          accessibilityHint={
            notificationsEnabled ? t('more.reminderHintOff') : t('more.reminderHintOn')
          }
        />
        {notificationsEnabled ? (
          <Row
            title={t('more.reminderTime')}
            value={timeLabel}
            chevron
            onPress={() => setTimeSheetOpen(true)}
            accessibilityLabel={t('more.reminderTimeA11y', { time: timeLabel })}
            accessibilityHint={t('more.reminderTimeHint')}
          />
        ) : null}
        {notice === 'blocked' ? (
          <View style={styles.notice}>
            <Text variant="label" tone="muted">
              {t('more.reminderBlocked')}
            </Text>
            <Button
              label={t('more.openPhoneSettings')}
              onPress={openPhoneSettings}
              style={styles.noticeButton}
            />
          </View>
        ) : null}

        <Text variant="label" tone="muted" accessibilityRole="header" style={styles.section}>
          {t('more.app')}
        </Text>
        <Divider />
        <Row
          title={t('appearance.title')}
          chevron
          onPress={() => go('/appearance')}
          accessibilityHint={t('more.openHint')}
        />
        <Row
          title={t('translations.title')}
          value={translation.toUpperCase()}
          chevron
          onPress={() => go('/translations')}
          accessibilityHint={t('more.openHint')}
        />
        <Row
          title={t('updates.title')}
          subtitle={hasUpdate ? t('more.updateAvailable') : undefined}
          chevron
          onPress={() => go('/updates')}
          accessibilityHint={t('more.openHint')}
        />
        <Row
          title={t('more.aboutPrivacy')}
          chevron
          onPress={() => go('/about')}
          accessibilityHint={t('more.openHint')}
        />
      </ScrollView>

      <Sheet
        visible={timeSheetOpen}
        onClose={() => setTimeSheetOpen(false)}
        title={t('more.reminderTime')}
        closeLabel={t('common.close')}
      >
        <ScrollView showsVerticalScrollIndicator={false}>
          {REMINDER_TIMES.map((time) => {
            const label = formatTimeLabel(time, false);
            const selected = time.hour === chosenTime.hour && chosenTime.minute === 0;
            return (
              <Row
                key={time.hour}
                title={label}
                selected={selected}
                onPress={() => pickTime(time)}
                accessibilityLabel={label}
              />
            );
          })}
        </ScrollView>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    width: '100%',
    maxWidth: READER.maxColumnWidth,
    alignSelf: 'center',
  },
  heading: {
    marginTop: space.xl,
    marginBottom: space.md,
    paddingHorizontal: space.xl,
  },
  section: {
    paddingHorizontal: space.xl,
    paddingTop: space.xl,
    paddingBottom: space.sm,
  },
  notice: {
    paddingHorizontal: space.xl,
    paddingVertical: space.md,
  },
  noticeButton: {
    alignSelf: 'flex-start',
    marginLeft: -space.lg,
    marginTop: space.xs,
  },
});
