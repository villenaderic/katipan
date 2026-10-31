import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ProgressBar } from '@/components/updates/ProgressBar';
import { Button } from '@/components/ui/Button';
import { Divider } from '@/components/ui/Divider';
import { Row } from '@/components/ui/Row';
import { Text } from '@/components/ui/Text';
import { A11Y, DEFAULT_TRANSLATION, READER } from '@/constants/config';
import { PACK_LANGUAGES } from '@/constants/languages';
import { useStorage } from '@/hooks/useStorage';
import { useUpdates } from '@/hooks/useUpdates';
import { useI18n } from '@/i18n';
import { getPackInfo } from '@/services/bibleService';
import { appMeetsMinVersion } from '@/services/updateService';
import { getTaskFraction, isTaskActive, type DownloadTask } from '@/store/downloadsStore';
import { selectSettings, useSettingsStore } from '@/store/settingsStore';
import { useTheme } from '@/theme/ThemeProvider';
import { space } from '@/theme/tokens';
import type { InstalledPack, ManifestPack } from '@/types';
import { formatBytes, formatPercent } from '@/utils/format';

/**
 * Translations: route /translations, opened from the More tab. The navigator
 * draws the header (see app/_layout.tsx).
 *
 * The Translation Manager (Section 4, v1.0):
 *  - On this phone: every installed Bible text with its size. Tap one to read
 *    in it (the check mark). Downloaded texts have a Delete button with a
 *    one-step confirmation. The two texts that ship inside the app cannot be
 *    deleted, because the app must always have something to read.
 *  - To download: texts offered by the last verified manifest that are not
 *    installed yet, each with its size and its own progress. Nothing starts by
 *    itself. With Low-storage mode on, large texts (over 10 MB) are hidden.
 *  - Storage: how much room the texts use, free space, clearing temporary
 *    files, and the Low-storage switch.
 *
 * Deleting a text never touches highlights, bookmarks or notes. They store
 * the verse number and the translation id, so they come back when the text
 * is downloaded again.
 *
 * Every string comes from i18n. Every control is at least 48dp.
 */

export default function TranslationsScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t, lang } = useI18n();
  const updates = useUpdates();
  const storage = useStorage();
  const { translation } = useSettingsStore(selectSettings);
  const setSetting = useSettingsStore((state) => state.setSetting);

  const { installed, manifest, available, checkStatus, needsConfirmation, taskForPack } = updates;
  const { lowStorageMode } = storage;

  const [names, setNames] = useState<Readonly<Record<string, string>>>({});
  const [languages, setLanguages] = useState<Readonly<Record<string, string>>>({});
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [failedId, setFailedId] = useState<string | null>(null);
  const [freedText, setFreedText] = useState<string | null>(null);

  /* ---------------- Names of installed texts ---------------- */

  // The readable name and language live inside each installed pack.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const nextNames: Record<string, string> = {};
      const nextLanguages: Record<string, string> = {};
      for (const pack of installed) {
        try {
          const info = await getPackInfo(pack.id);
          if (info) {
            nextNames[pack.id] = info.name;
            nextLanguages[pack.id] = info.language;
          }
        } catch {
          // The id is shown instead.
        }
      }
      if (!cancelled) {
        setNames(nextNames);
        setLanguages(nextLanguages);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [installed]);

  const languageName = useCallback((code: string | undefined): string => {
    if (!code) return '';
    return PACK_LANGUAGES.find((item) => item.code === code)?.nativeName ?? code;
  }, []);

  /* ---------------- Actions ---------------- */

  const select = useCallback(
    (id: string): void => {
      setSetting('translation', id);
    },
    [setSetting],
  );

  const askDelete = useCallback((id: string): void => {
    setFailedId(null);
    setConfirmingId(id);
  }, []);

  const cancelDelete = useCallback((): void => {
    setConfirmingId(null);
  }, []);

  const confirmDelete = useCallback(
    (id: string): void => {
      setConfirmingId(null);
      void (async () => {
        const deleted = await storage.removePack(id);
        if (!deleted) {
          setFailedId(id);
          return;
        }
        // If the deleted text was the chosen one, go back to the default for this language.
        if (useSettingsStore.getState().settings.translation === id) {
          setSetting('translation', DEFAULT_TRANSLATION[lang]);
        }
      })();
    },
    [lang, setSetting, storage],
  );

  const download = useCallback(
    (pack: ManifestPack): void => {
      void updates.installPack(pack).then(() => storage.refresh());
    },
    [updates, storage],
  );

  const checkNow = useCallback((): void => {
    void updates.checkNow();
  }, [updates]);

  const clearCache = useCallback((): void => {
    setFreedText(null);
    void storage.clearCache().then((freed) => {
      setFreedText(t('translations.cacheCleared', { size: formatBytes(freed) }));
    });
  }, [storage, t]);

  const toggleLowStorage = useCallback((): void => {
    storage.setLowStorageMode(!lowStorageMode);
  }, [storage, lowStorageMode]);

  /* ---------------- What can be downloaded ---------------- */

  const { offered, hiddenCount } = useMemo(() => {
    if (!manifest || !appMeetsMinVersion(manifest)) {
      return { offered: [] as ManifestPack[], hiddenCount: 0 };
    }
    const have = new Set(installed.map((pack) => pack.id));
    const notInstalled = manifest.packs.filter((pack) => !have.has(pack.id));
    if (!lowStorageMode) return { offered: notInstalled, hiddenCount: 0 };

    const small = notInstalled.filter((pack) => !needsConfirmation(pack));
    return { offered: small, hiddenCount: notInstalled.length - small.length };
  }, [manifest, installed, lowStorageMode, needsConfirmation]);

  const appTooOld = manifest !== null && !appMeetsMinVersion(manifest);
  const checking = checkStatus === 'checking';
  const hasUpdateFor = useCallback(
    (id: string): boolean => available.packs.some((pack) => pack.id === id),
    [available.packs],
  );

  /* ---------------- Screen ---------------- */

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space.xxxl }]}
      >
        {/* ---------------- On this phone ---------------- */}
        <SectionTitle label={t('translations.installed')} />
        <Divider />
        {installed.map((pack: InstalledPack) => {
          const name = names[pack.id] ?? pack.id;
          const size = formatBytes(pack.bytes);
          const selected = translation === pack.id;
          const subtitleParts = [
            languageName(languages[pack.id]),
            size,
            pack.bundled ? t('translations.included') : '',
            hasUpdateFor(pack.id) ? t('more.updateAvailable') : '',
          ].filter((part) => part !== '');
          const confirming = confirmingId === pack.id;

          return (
            <View key={pack.id}>
              <Row
                title={name}
                subtitle={subtitleParts.join(' · ')}
                selected={selected}
                divider={false}
                accessibilityLabel={`${name}. ${subtitleParts.join('. ')}${
                  selected ? `. ${t('translations.readingNow')}` : ''
                }`}
                accessibilityHint={selected ? undefined : t('translations.selectHint')}
                onPress={() => select(pack.id)}
              />

              {storage.canDelete(pack) ? (
                <View style={styles.rowActions}>
                  {confirming ? (
                    <>
                      <Text variant="caption" tone="muted" style={styles.confirmText}>
                        {t('translations.deleteConfirm', { name })}
                      </Text>
                      <View style={styles.actions}>
                        <Button
                          label={t('translations.deleteYes')}
                          accessibilityLabel={t('translations.deleteYesA11y', { name })}
                          onPress={() => confirmDelete(pack.id)}
                        />
                        <Button label={t('common.cancel')} onPress={cancelDelete} />
                      </View>
                    </>
                  ) : (
                    <View style={styles.actions}>
                      <Button
                        label={t('translations.delete')}
                        accessibilityLabel={t('translations.deleteA11y', { name, size })}
                        onPress={() => askDelete(pack.id)}
                      />
                    </View>
                  )}
                  {failedId === pack.id ? (
                    <Text variant="caption" tone="danger" accessibilityLiveRegion="polite">
                      {t('translations.deleteFailed')}
                    </Text>
                  ) : null}
                </View>
              ) : null}
              <Divider />
            </View>
          );
        })}

        {/* ---------------- To download ---------------- */}
        <SectionTitle label={t('translations.available')} />
        <Divider />

        {manifest === null ? (
          <View style={styles.block}>
            <Text variant="body" tone="muted">
              {t('translations.noManifest')}
            </Text>
            <View style={styles.actionsFlush}>
              <Button
                label={checking ? t('updates.checking') : t('updates.checkNow')}
                variant="outline"
                disabled={checking}
                onPress={checkNow}
              />
            </View>
          </View>
        ) : appTooOld ? (
          <View style={styles.block}>
            <Text variant="label" tone="danger">
              {t('updates.tooOld')}
            </Text>
          </View>
        ) : offered.length === 0 ? (
          <View style={styles.block}>
            <Text variant="body" tone="muted">
              {t('translations.nothingMore')}
            </Text>
          </View>
        ) : null}

        {offered.map((pack) => {
          const size = formatBytes(pack.size);
          const language = languageName(pack.lang) || pack.id;
          const task = taskForPack(pack.id);
          const busy = task !== undefined && isTaskActive(task);

          return (
            <View key={pack.id}>
              <View style={styles.item}>
                <Text variant="body">{language}</Text>
                <Text variant="caption" tone="muted" style={styles.gap}>
                  {t('translations.packSubtitle', { id: pack.id, size })}
                </Text>
                {needsConfirmation(pack) ? (
                  <Text variant="caption" tone="muted">
                    {t('updates.confirmNote')}
                  </Text>
                ) : null}

                <TaskArea
                  task={task}
                  what={language}
                  onCancel={() => updates.cancel(`pack:${pack.id}`)}
                  onRetry={() => download(pack)}
                  onDismiss={() => updates.dismiss(`pack:${pack.id}`)}
                />

                {!busy ? (
                  <View style={styles.actions}>
                    <Button
                      label={t('translations.download', { size })}
                      accessibilityLabel={t('translations.downloadA11y', { name: language, size })}
                      onPress={() => download(pack)}
                    />
                  </View>
                ) : null}
              </View>
              <Divider />
            </View>
          );
        })}

        {hiddenCount > 0 ? (
          <View style={styles.block}>
            <Text variant="caption" tone="muted">
              {t('translations.largeHidden', { count: hiddenCount })}
            </Text>
          </View>
        ) : null}

        {/* ---------------- Storage ---------------- */}
        <SectionTitle label={t('translations.storageTitle')} />
        <Divider />
        <View style={styles.block}>
          <Text variant="body">{t('translations.storageUsed', { size: formatBytes(storage.packBytes) })}</Text>
          {storage.freeBytes > 0 ? (
            <Text variant="caption" tone="muted" style={styles.gap}>
              {t('translations.storageFree', { size: formatBytes(storage.freeBytes) })}
            </Text>
          ) : null}
          {storage.isLow ? (
            <Text variant="label" tone="muted" style={styles.gap} accessibilityLiveRegion="polite">
              {t('translations.storageLow')}
            </Text>
          ) : null}

          {storage.cacheBytes > 0 ? (
            <View style={styles.actionsFlush}>
              <Button
                label={t('translations.clearCache', { size: formatBytes(storage.cacheBytes) })}
                variant="outline"
                onPress={clearCache}
              />
            </View>
          ) : null}
          {freedText ? (
            <Text variant="caption" tone="muted" accessibilityLiveRegion="polite">
              {freedText}
            </Text>
          ) : null}
        </View>
        <Divider />
        <ToggleRow
          title={t('translations.lowStorage')}
          hint={t('translations.lowStorageHint')}
          value={lowStorageMode}
          onLabel={t('common.on')}
          offLabel={t('common.off')}
          onToggle={toggleLowStorage}
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
  /** What is being downloaded, for the screen reader. */
  what: string;
  onCancel: () => void;
  onRetry: () => void;
  onDismiss: () => void;
}

/** Progress while a download runs, a plain sentence when it failed, nothing otherwise. */
function TaskArea({ task, what, onCancel, onRetry, onDismiss }: TaskAreaProps) {
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
          <Text variant="caption" tone="muted" style={styles.gap} importantForAccessibility="no">
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
  rowActions: {
    paddingHorizontal: space.xl,
    paddingBottom: space.sm,
  },
  confirmText: {
    marginBottom: space.xs,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    marginLeft: -space.lg,
    marginTop: space.xs,
  },
  actionsFlush: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    marginTop: space.sm,
  },
  task: {
    marginTop: space.md,
  },
  bar: {
    marginTop: space.sm,
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
