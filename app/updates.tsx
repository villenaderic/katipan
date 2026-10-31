import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ProgressBar } from '@/components/updates/ProgressBar';
import { Button } from '@/components/ui/Button';
import { Divider } from '@/components/ui/Divider';
import { Text } from '@/components/ui/Text';
import {
  A11Y,
  APP_VERSION,
  IS_SIGNING_KEY_CONFIGURED,
  MANIFEST_URL,
  READER,
} from '@/constants/config';
import { useUpdates } from '@/hooks/useUpdates';
import { useI18n } from '@/i18n';
import { openInstallPermissionSettings } from '@/services/appUpdateService';
import { getPackInfo } from '@/services/bibleService';
import { appMeetsMinVersion, type CheckOutcome } from '@/services/updateService';
import { getTaskFraction, isTaskActive, type DownloadTask } from '@/store/downloadsStore';
import { useSettingsStore } from '@/store/settingsStore';
import { syncBackgroundTasks } from '@/tasks/backgroundTasks';
import { useTheme } from '@/theme/ThemeProvider';
import { hairline, space } from '@/theme/tokens';
import type { ManifestPack, UpdateMode } from '@/types';
import { formatDateTimeStamp } from '@/utils/date';
import { formatBytes, formatPercent } from '@/utils/format';

/**
 * Updates: route /updates, opened from the More tab. The navigator draws the
 * header (see app/_layout.tsx).
 *
 * One scroll, in this order:
 *  - Status: installed version, when the last check was, "Check now".
 *  - App update (only when one is offered): the notes, the Update button, and
 *    an honest line that Android will ask the person to tap Install.
 *  - Bible texts: the daily verse list and any newer pack, each with its size
 *    and its own progress. Packs over 10 MB need an explicit tap, and say so.
 *  - How updates work: Auto, Manual or Off, and Wi-Fi only.
 *
 * Nothing starts by itself. Every download begins with a tap on a button that
 * shows its size. A failed download says plainly that nothing was changed,
 * because that is true (downloads only ever touch tmp/ until verified).
 *
 * Every string comes from i18n. Every control is at least 48dp.
 */

const UPDATE_MODES: readonly UpdateMode[] = ['auto', 'manual', 'off'];

export default function UpdatesScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t, lang } = useI18n();
  const updates = useUpdates();
  const setSetting = useSettingsStore((state) => state.setSetting);

  const {
    available,
    manifest,
    tasks,
    checkStatus,
    lastCheck,
    updateMode,
    wifiOnly,
    needsConfirmation,
  } = updates;

  const [outcome, setOutcome] = useState<CheckOutcome | null>(null);
  const [permissionFailed, setPermissionFailed] = useState(false);
  const [names, setNames] = useState<Readonly<Record<string, string>>>({});

  /* ---------------- Pack names ---------------- */

  // The manifest lists ids and sizes; the readable name lives in the installed pack.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const next: Record<string, string> = {};
      for (const pack of available.packs) {
        try {
          const info = await getPackInfo(pack.id);
          if (info) next[pack.id] = info.name;
        } catch {
          // The id is shown instead.
        }
      }
      if (!cancelled) setNames(next);
    })();

    return () => {
      cancelled = true;
    };
  }, [available.packs]);

  /* ---------------- Actions ---------------- */

  const checking = checkStatus === 'checking';

  const checkNow = useCallback((): void => {
    setOutcome(null);
    void updates.checkNow().then(setOutcome);
  }, [updates]);

  const allowInstall = useCallback((): void => {
    setPermissionFailed(false);
    void openInstallPermissionSettings().then((opened) => {
      if (!opened) setPermissionFailed(true);
    });
  }, []);

  const chooseMode = useCallback(
    (mode: UpdateMode): void => {
      setSetting('updateMode', mode);
      // Register or remove the background task to match.
      void syncBackgroundTasks();
    },
    [setSetting],
  );

  const toggleWifiOnly = useCallback((): void => {
    setSetting('wifiOnly', !wifiOnly);
  }, [setSetting, wifiOnly]);

  /* ---------------- Derived ---------------- */

  const notConfigured = MANIFEST_URL === '' || !IS_SIGNING_KEY_CONFIGURED;
  const appTooOld = manifest !== null && !appMeetsMinVersion(manifest);

  const lastCheckedText =
    lastCheck > 0
      ? t('updates.lastChecked', { time: formatDateTimeStamp(new Date(lastCheck)) })
      : t('updates.neverChecked');

  const outcomeText =
    outcome === 'updated'
      ? t('updates.result.updated')
      : outcome === 'up-to-date'
        ? t('updates.result.upToDate')
        : outcome === 'error'
          ? t('updates.result.error')
          : null;

  const app = available.app;
  const appTask = tasks.apk;
  const appNotes = app ? (app.notes[lang] || app.notes.en).trim() : '';

  const versesTask = tasks.dailyVerses;
  const nothingForTexts = available.packs.length === 0 && available.dailyVerses === null;

  /* ---------------- Screen ---------------- */

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space.xxxl }]}
      >
        {/* ---------------- Status ---------------- */}
        <View style={styles.block}>
          <Text variant="body">{t('updates.version', { version: APP_VERSION })}</Text>
          <Text variant="caption" tone="muted" style={styles.gap}>
            {lastCheckedText}
          </Text>
          <View style={styles.actions}>
            <Button
              label={checking ? t('updates.checking') : t('updates.checkNow')}
              accessibilityHint={t('updates.checkNowHint')}
              variant="outline"
              disabled={checking}
              onPress={checkNow}
            />
          </View>
          {outcomeText ? (
            <Text variant="label" tone="muted" accessibilityLiveRegion="polite">
              {outcomeText}
            </Text>
          ) : null}
          {notConfigured ? (
            <Text variant="caption" tone="muted" style={styles.gap}>
              {t('updates.notConfigured')}
            </Text>
          ) : null}
          {appTooOld ? (
            <Text variant="label" tone="danger" style={styles.gap}>
              {t('updates.tooOld')}
            </Text>
          ) : null}
        </View>
        <Divider />

        {/* ---------------- App update ---------------- */}
        {app ? (
          <>
            <SectionTitle label={t('updates.appTitle')} />
            <Divider />
            <View style={styles.block}>
              <Text variant="body">{t('updates.appAvailable', { version: app.latest })}</Text>
              {appNotes ? (
                <Text variant="label" tone="muted" style={styles.gap}>
                  {appNotes}
                </Text>
              ) : null}
              <Text variant="caption" tone="muted" style={styles.gap}>
                {t('updates.appHow')}
              </Text>

              <TaskArea
                task={appTask}
                what={t('updates.appAvailable', { version: app.latest })}
                doneText={t('updates.installerOpened')}
                onCancel={() => updates.cancel('apk')}
                onRetry={() => void updates.updateApp()}
                onDismiss={() => updates.dismiss('apk')}
              />

              {!appTask || !isTaskActive(appTask) ? (
                <View style={styles.actions}>
                  <Button
                    label={t('updates.appButton')}
                    variant="filled"
                    onPress={() => void updates.updateApp()}
                  />
                  <Button
                    label={t('updates.allowInstall')}
                    accessibilityHint={t('updates.allowInstallHint')}
                    onPress={allowInstall}
                  />
                </View>
              ) : null}
              {permissionFailed ? (
                <Text variant="caption" tone="muted" accessibilityLiveRegion="polite">
                  {t('updates.allowInstallFailed')}
                </Text>
              ) : null}
            </View>
            <Divider />
          </>
        ) : null}

        {/* ---------------- Bible texts ---------------- */}
        <SectionTitle label={t('updates.contentTitle')} />
        <Divider />

        {nothingForTexts && !versesTask ? (
          <View style={styles.block}>
            <Text variant="body" tone="muted">
              {t('updates.nothingToUpdate')}
            </Text>
          </View>
        ) : null}

        {available.dailyVerses || versesTask ? (
          <View style={styles.item}>
            <Text variant="body">{t('updates.dailyVerses')}</Text>
            {available.dailyVerses ? (
              <Text variant="caption" tone="muted" style={styles.gap}>
                {t('updates.dailyVersesNew')}
              </Text>
            ) : null}
            <TaskArea
              task={versesTask}
              what={t('updates.dailyVerses')}
              onCancel={() => updates.cancel('dailyVerses')}
              onRetry={() => void updates.updateDailyVerses()}
              onDismiss={() => updates.dismiss('dailyVerses')}
            />
            {available.dailyVerses && (!versesTask || !isTaskActive(versesTask)) ? (
              <View style={styles.actions}>
                <Button
                  label={t('updates.updateButton')}
                  accessibilityLabel={`${t('updates.updateButton')}. ${t('updates.dailyVerses')}`}
                  onPress={() => void updates.updateDailyVerses()}
                />
              </View>
            ) : null}
          </View>
        ) : null}

        {available.packs.map((pack: ManifestPack) => {
          const name = names[pack.id] ?? pack.id;
          const task = updates.taskForPack(pack.id);
          const size = formatBytes(pack.size);
          const busy = task !== undefined && isTaskActive(task);

          return (
            <View key={pack.id} style={styles.item}>
              <Text variant="body">{name}</Text>
              <Text variant="caption" tone="muted" style={styles.gap}>
                {t('updates.packNew', { version: pack.version, size })}
              </Text>
              {needsConfirmation(pack) ? (
                <Text variant="caption" tone="muted">
                  {t('updates.confirmNote')}
                </Text>
              ) : null}
              <TaskArea
                task={task}
                what={name}
                onCancel={() => updates.cancel(`pack:${pack.id}`)}
                onRetry={() => void updates.installPack(pack)}
                onDismiss={() => updates.dismiss(`pack:${pack.id}`)}
              />
              {!busy ? (
                <View style={styles.actions}>
                  <Button
                    label={t('updates.updateButtonSize', { size })}
                    accessibilityLabel={t('updates.updateA11y', { name, size })}
                    onPress={() => void updates.installPack(pack)}
                  />
                </View>
              ) : null}
            </View>
          );
        })}
        <Divider />

        {/* ---------------- How updates work ---------------- */}
        <SectionTitle label={t('updates.modeTitle')} />
        <Divider />
        <View style={styles.block}>
          <View style={styles.choices} accessibilityRole="radiogroup">
            {UPDATE_MODES.map((mode) => (
              <Choice
                key={mode}
                label={t(`updates.mode.${mode}`)}
                selected={updateMode === mode}
                onPress={() => chooseMode(mode)}
              />
            ))}
          </View>
          <Text variant="caption" tone="muted" style={styles.gap}>
            {t(`updates.modeHint.${updateMode}`)}
          </Text>
        </View>
        <Divider />
        <ToggleRow
          title={t('updates.wifiOnly')}
          hint={t('updates.wifiOnlyHint')}
          value={wifiOnly}
          onLabel={t('common.on')}
          offLabel={t('common.off')}
          onToggle={toggleWifiOnly}
        />
        <Divider />
      </ScrollView>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Pieces                                                              */
/* ------------------------------------------------------------------ */

function SectionTitle({ label }: { label: string }) {
  return (
    <Text variant="label" tone="muted" accessibilityRole="header" style={styles.section}>
      {label}
    </Text>
  );
}

interface TaskAreaProps {
  task: DownloadTask | undefined;
  /** What is being downloaded, for the screen reader ("Downloading World English Bible"). */
  what: string;
  /** Shown when the task is done and something is left to say (the APK installer). */
  doneText?: string;
  onCancel: () => void;
  onRetry: () => void;
  onDismiss: () => void;
}

/** Progress while a download runs, a plain sentence when it failed, nothing otherwise. */
function TaskArea({ task, what, doneText, onCancel, onRetry, onDismiss }: TaskAreaProps) {
  const { t } = useI18n();

  if (!task) return null;

  if (isTaskActive(task)) {
    const fraction = getTaskFraction(task);
    const statusText =
      task.status === 'downloading'
        ? fraction === null
          ? t('updates.status.downloadingUnknown')
          : t('updates.status.downloading', { percent: formatPercent(fraction) })
        : task.status === 'verifying'
          ? t('updates.status.verifying')
          : t('updates.status.installing');

    return (
      <View style={styles.task}>
        <Text variant="label" tone="muted" accessibilityLiveRegion="polite">
          {statusText}
        </Text>
        <ProgressBar
          fraction={task.status === 'downloading' ? fraction : 1}
          accessibilityLabel={t('updates.progressA11y', { what })}
          style={styles.bar}
        />
        {task.status === 'downloading' ? (
          <View style={styles.actions}>
            <Button label={t('common.cancel')} onPress={onCancel} />
          </View>
        ) : null}
      </View>
    );
  }

  if (task.status === 'error') {
    return (
      <View style={styles.task}>
        <Text variant="label" tone="danger" accessibilityLiveRegion="polite">
          {t(`updates.error.${task.error ?? 'unknown'}`)}
        </Text>
        <View style={styles.actions}>
          <Button label={t('common.retry')} onPress={onRetry} />
          <Button label={t('updates.dismiss')} onPress={onDismiss} />
        </View>
      </View>
    );
  }

  if (task.status === 'done' && doneText) {
    return (
      <View style={styles.task}>
        <Text variant="label" tone="muted" accessibilityLiveRegion="polite">
          {doneText}
        </Text>
        <View style={styles.actions}>
          <Button label={t('updates.dismiss')} onPress={onDismiss} />
        </View>
      </View>
    );
  }

  return null;
}

interface ToggleRowProps {
  title: string;
  hint?: string;
  value: boolean;
  onLabel: string;
  offLabel: string;
  onToggle: () => void;
}

/** A switch row: title and hint on the left, "On" or "Off" in the accent color on the right. */
function ToggleRow({ title, hint, value, onLabel, offLabel, onToggle }: ToggleRowProps) {
  const { colors } = useTheme();

  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="switch"
      accessibilityLabel={hint ? `${title}. ${hint}` : title}
      accessibilityState={{ checked: value }}
      style={({ pressed }) => [
        styles.toggle,
        pressed ? { backgroundColor: colors.selection } : null,
      ]}
    >
      <View style={styles.toggleText}>
        <Text variant="body" importantForAccessibility="no">
          {title}
        </Text>
        {hint ? (
          <Text variant="caption" tone="muted" style={styles.gapSmall} importantForAccessibility="no">
            {hint}
          </Text>
        ) : null}
      </View>
      <Text variant="label" tone="accent" style={styles.bold} importantForAccessibility="no">
        {value ? onLabel : offLabel}
      </Text>
    </Pressable>
  );
}

interface ChoiceProps {
  label: string;
  selected: boolean;
  onPress: () => void;
}

/** One option in a group where exactly one can be chosen. The chosen one has an accent border. */
function Choice({ label, selected, onPress }: ChoiceProps) {
  const { colors } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ selected, checked: selected }}
      style={({ pressed }) => [
        styles.choice,
        {
          borderColor: selected ? colors.accent : colors.divider,
          borderWidth: selected ? 2 : hairline,
        },
        pressed ? { backgroundColor: colors.selection } : null,
      ]}
    >
      <Text
        variant="label"
        tone={selected ? 'accent' : 'default'}
        style={selected ? styles.bold : undefined}
        numberOfLines={1}
        importantForAccessibility="no"
      >
        {label}
      </Text>
    </Pressable>
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
  section: {
    paddingHorizontal: space.xl,
    paddingTop: space.xl,
    paddingBottom: space.sm,
  },
  block: {
    paddingHorizontal: space.xl,
    paddingVertical: space.md,
  },
  item: {
    paddingHorizontal: space.xl,
    paddingVertical: space.md,
  },
  gap: {
    marginTop: space.xs,
  },
  gapSmall: {
    marginTop: space.xs,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    marginLeft: -space.lg,
    marginTop: space.sm,
  },
  task: {
    marginTop: space.md,
  },
  bar: {
    marginTop: space.sm,
  },
  choices: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  choice: {
    minHeight: A11Y.minTouchTarget,
    minWidth: A11Y.minTouchTarget,
    paddingHorizontal: space.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: A11Y.minTouchTarget,
    paddingHorizontal: space.xl,
    paddingVertical: space.sm,
    gap: space.md,
  },
  toggleText: {
    flex: 1,
  },
  bold: {
    fontWeight: '600',
  },
});
