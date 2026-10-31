import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { Divider } from '@/components/ui/Divider';
import { Row } from '@/components/ui/Row';
import { Text } from '@/components/ui/Text';
import { READER } from '@/constants/config';
import { useI18n } from '@/i18n';
import {
  BackupError,
  applyBackup,
  clearExports,
  countParsed,
  createJsonExport,
  createMarkdownExport,
  getLibraryCounts,
  readBackupFile,
  shareExport,
  type BackupCounts,
  type ExportResult,
  type ImportResult,
  type ParsedBackup,
} from '@/services/backupService';
import { selectSettings, useSettingsStore } from '@/store/settingsStore';
import { useTheme } from '@/theme/ThemeProvider';
import { space } from '@/theme/tokens';
import { toDateKey } from '@/utils/date';

/**
 * Backup: route /backup, opened from the More tab. The navigator draws the
 * header (see app/_layout.tsx).
 *
 * Three jobs, in one quiet scroll:
 *  1. Save a copy. A backup file (JSON, restorable) or a readable copy
 *     (Markdown, with the verse text). Both go out through the phone's own
 *     share menu, so the person decides where they land. Katipan sends
 *     nothing anywhere.
 *  2. Restore. Pick a backup file, see what is in it, then choose to add it.
 *     Restoring only ADDS: nothing already on the phone is changed or removed,
 *     so importing the same file twice, or an old file over newer work, is safe.
 *  3. Tell the truth about both, in plain words.
 *
 * Export files hold the person's notes, so they are deleted from the cache
 * when this screen closes (and before every new export). They are not deleted
 * right after the share menu closes: on Android the app that receives the file
 * may still be reading it at that moment.
 *
 * Every string comes from i18n. Failures arrive as BackupError codes and each
 * code has its own message (backup.error.<code>).
 */

type Busy = 'none' | 'exportJson' | 'exportMarkdown' | 'reading' | 'importing';

interface Status {
  /** One or more lines shown under the actions. */
  lines: readonly string[];
  tone: 'default' | 'danger';
}

export default function BackupScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t, lang } = useI18n();
  const { translation } = useSettingsStore(selectSettings);

  const [counts, setCounts] = useState<BackupCounts | null>(null);
  const [busy, setBusy] = useState<Busy>('none');
  const [status, setStatus] = useState<Status | null>(null);
  const [pending, setPending] = useState<ParsedBackup | null>(null);

  // Guards against a second tap before React has re-rendered the disabled state.
  const working = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // The export files hold the person's notes. Remove them when leaving.
      clearExports();
    };
  }, []);

  const refreshCounts = useCallback(async (): Promise<void> => {
    try {
      const next = await getLibraryCounts();
      if (mounted.current) setCounts(next);
    } catch {
      // The counts are only a convenience line. The actions still work without them.
    }
  }, []);

  useEffect(() => {
    void refreshCounts();
  }, [refreshCounts]);

  const messageFor = useCallback(
    (error: unknown): string => {
      if (error instanceof BackupError) return t(`backup.error.${error.code}`);
      return t('common.error');
    },
    [t],
  );

  /** Run one action at a time, with a busy state and an error line if it fails. */
  const run = useCallback(
    async (kind: Exclude<Busy, 'none'>, action: () => Promise<void>): Promise<void> => {
      if (working.current) return;
      working.current = true;
      setBusy(kind);
      setStatus(null);
      try {
        await action();
      } catch (error: unknown) {
        if (mounted.current) setStatus({ lines: [messageFor(error)], tone: 'danger' });
      } finally {
        working.current = false;
        if (mounted.current) setBusy('none');
      }
    },
    [messageFor],
  );

  /* ---------------- Save a copy ---------------- */

  const exportFile = useCallback(
    (kind: 'exportJson' | 'exportMarkdown'): void => {
      setPending(null);
      void run(kind, async () => {
        let result: ExportResult;
        let title: string;
        if (kind === 'exportJson') {
          result = await createJsonExport();
          title = t('backup.shareTitleBackup');
        } else {
          result = await createMarkdownExport(lang, translation, t);
          title = t('backup.shareTitleNotes');
        }
        await shareExport(result, title);
      });
    },
    [lang, run, t, translation],
  );

  /* ---------------- Restore ---------------- */

  const chooseFile = useCallback((): void => {
    setPending(null);
    void run('reading', async () => {
      // "*/*": Android often calls a .json file "application/octet-stream", so a narrower
      // filter would hide real backups. The file is checked after it is read.
      const picked = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
        multiple: false,
      });
      const asset = picked.canceled ? undefined : picked.assets[0];
      if (!asset) return;

      try {
        const backup = await readBackupFile(asset.uri);
        if (mounted.current) setPending(backup);
      } finally {
        // The picker's copy holds the person's notes; do not leave it in the cache.
        try {
          const copy = new File(asset.uri);
          if (copy.exists) copy.delete();
        } catch {
          // Android empties the cache folder when space runs low.
        }
      }
    });
  }, [run]);

  const confirmImport = useCallback((): void => {
    const backup = pending;
    if (!backup) return;
    void run('importing', async () => {
      const result: ImportResult = await applyBackup(backup);
      if (!mounted.current) return;

      const skipped = result.highlights.skipped + result.bookmarks.skipped + result.notes.skipped;
      const lines: string[] = [
        t('backup.resultAdded', {
          highlights: result.highlights.added,
          bookmarks: result.bookmarks.added,
          notes: result.notes.added,
        }),
      ];
      if (skipped > 0) lines.push(t('backup.resultSkipped', { count: skipped }));
      if (result.invalid > 0) lines.push(t('backup.resultInvalid', { count: result.invalid }));

      setPending(null);
      setStatus({ lines, tone: 'default' });
      await refreshCounts();
    });
  }, [pending, refreshCounts, run, t]);

  const cancelImport = useCallback((): void => {
    setPending(null);
  }, []);

  /* ---------------- Pieces of text ---------------- */

  const idle = busy === 'none';
  const pendingCounts = pending ? countParsed(pending) : null;
  const pendingTotal = pendingCounts
    ? pendingCounts.highlights + pendingCounts.bookmarks + pendingCounts.notes
    : 0;

  let madeOn: string | null = null;
  if (pending?.exportedAt) {
    const when = new Date(pending.exportedAt);
    if (!Number.isNaN(when.getTime())) madeOn = toDateKey(when);
  }

  const busyText =
    busy === 'none'
      ? null
      : busy === 'reading'
        ? t('backup.working')
        : busy === 'importing'
          ? t('backup.adding')
          : t('backup.preparing');

  /* ---------------- Screen ---------------- */

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space.xxxl }]}
      >
        <View style={styles.intro}>
          <Text variant="body" tone="muted">
            {t('backup.intro')}
          </Text>
          {counts ? (
            <Text variant="label" style={styles.counts}>
              {t('backup.counts', {
                highlights: counts.highlights,
                bookmarks: counts.bookmarks,
                notes: counts.notes,
              })}
            </Text>
          ) : null}
        </View>

        {/* ---------------- Save a copy ---------------- */}
        <SectionTitle label={t('backup.saveTitle')} />
        <Divider />
        <Row
          title={t('backup.exportJson')}
          subtitle={t('backup.exportJsonHint')}
          chevron
          disabled={!idle}
          onPress={() => exportFile('exportJson')}
        />
        <Row
          title={t('backup.exportMarkdown')}
          subtitle={t('backup.exportMarkdownHint')}
          chevron
          disabled={!idle}
          onPress={() => exportFile('exportMarkdown')}
        />
        <Text variant="caption" tone="muted" style={styles.note}>
          {t('backup.sharePrivacy')}
        </Text>

        {/* ---------------- Restore ---------------- */}
        <SectionTitle label={t('backup.restoreTitle')} />
        <Divider />
        <Row
          title={t('backup.restoreRow')}
          subtitle={t('backup.restoreHint')}
          chevron
          disabled={!idle}
          onPress={chooseFile}
        />
        <Text variant="caption" tone="muted" style={styles.note}>
          {t('backup.restoreRule')}
        </Text>

        {/* ---------------- What is in the chosen file ---------------- */}
        {pending && pendingCounts ? (
          <View style={styles.confirm} accessibilityLiveRegion="polite">
            <Text variant="title" style={styles.confirmTitle}>
              {pendingTotal > 0 ? t('backup.confirmTitle') : t('backup.confirmEmptyTitle')}
            </Text>
            {pendingTotal > 0 ? (
              <Text variant="body">
                {t('backup.confirmBody', {
                  highlights: pendingCounts.highlights,
                  bookmarks: pendingCounts.bookmarks,
                  notes: pendingCounts.notes,
                })}
              </Text>
            ) : (
              <Text variant="body" tone="muted">
                {t('backup.confirmEmptyBody')}
              </Text>
            )}
            {madeOn ? (
              <Text variant="label" tone="muted" style={styles.confirmLine}>
                {t('backup.confirmDate', { date: madeOn })}
              </Text>
            ) : null}
            {pending.invalid > 0 ? (
              <Text variant="label" tone="muted" style={styles.confirmLine}>
                {t('backup.resultInvalid', { count: pending.invalid })}
              </Text>
            ) : null}
            <View style={styles.confirmButtons}>
              {pendingTotal > 0 ? (
                <Button
                  label={t('backup.add')}
                  variant="filled"
                  disabled={!idle}
                  onPress={confirmImport}
                />
              ) : null}
              <Button
                label={pendingTotal > 0 ? t('common.cancel') : t('common.close')}
                variant="outline"
                disabled={!idle}
                onPress={cancelImport}
              />
            </View>
          </View>
        ) : null}

        {/* ---------------- Progress and results ---------------- */}
        {busyText ? (
          <Text
            variant="label"
            tone="muted"
            style={styles.status}
            accessibilityLiveRegion="polite"
          >
            {busyText}
          </Text>
        ) : null}
        {status ? (
          <View style={styles.status} accessibilityLiveRegion="polite">
            {status.lines.map((line) => (
              <Text
                key={line}
                variant="label"
                tone={status.tone === 'danger' ? 'danger' : 'default'}
                style={styles.statusLine}
              >
                {line}
              </Text>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

function SectionTitle({ label }: { label: string }) {
  return (
    <Text variant="label" tone="muted" accessibilityRole="header" style={styles.section}>
      {label}
    </Text>
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
  intro: {
    paddingHorizontal: space.xl,
    paddingTop: space.lg,
  },
  counts: {
    marginTop: space.md,
  },
  section: {
    paddingHorizontal: space.xl,
    paddingTop: space.xl,
    paddingBottom: space.sm,
  },
  note: {
    paddingHorizontal: space.xl,
    paddingTop: space.md,
  },
  confirm: {
    paddingHorizontal: space.xl,
    paddingTop: space.xl,
  },
  confirmTitle: {
    marginBottom: space.sm,
  },
  confirmLine: {
    marginTop: space.sm,
  },
  confirmButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
    marginTop: space.lg,
  },
  status: {
    paddingHorizontal: space.xl,
    paddingTop: space.xl,
  },
  statusLine: {
    marginBottom: space.xs,
  },
});
