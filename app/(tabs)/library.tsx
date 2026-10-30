import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type ListRenderItemInfo,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ColorPicker, type ColorPickerLabels } from '@/components/library/ColorPicker';
import { HighlightItem } from '@/components/library/HighlightItem';
import { Button } from '@/components/ui/Button';
import { Divider } from '@/components/ui/Divider';
import { Row } from '@/components/ui/Row';
import { Sheet } from '@/components/ui/Sheet';
import { Text } from '@/components/ui/Text';
import { A11Y, READER } from '@/constants/config';
import { getUserDb } from '@/db/client';
import {
  clearHighlights,
  deleteNote,
  getNoteTagMap,
  listBookmarks,
  listHighlights,
  listNotes,
  listTags,
  removeBookmarks,
  setBookmarkLabel,
  type TagWithCount,
} from '@/db/queries/user';
import { useI18n } from '@/i18n';
import { loadVerses } from '@/services/bibleService';
import { selectSettings, useSettingsStore } from '@/store/settingsStore';
import { useTheme } from '@/theme/ThemeProvider';
import { hairline, maxUiFontScale, space, uiFontSize } from '@/theme/tokens';
import { readerTypography, uiTextStyle } from '@/theme/typography';
import type { Bookmark, Highlight, HighlightColor, LangCode, Note, VerseId } from '@/types';
import { monthName } from '@/utils/date';
import { cleanVerseText } from '@/utils/format';
import { formatVerseId, parseVerseId } from '@/utils/reference';

/**
 * Library tab: everything the person made, in three plain lists.
 *
 *  - Highlights: filter by color with one line of five squares.
 *  - Bookmarks: the label can be edited from the long-press sheet.
 *  - Notes: filter by tag. Tapping a note's sheet row opens the note editor.
 *
 * Tap an item to open the chapter at that verse. Long press to edit or remove.
 *
 * Marks follow the verse, not the translation. The verse text is read from
 * the translation the mark was made in; when that pack is not installed the
 * current translation is used, and when neither has it the item says so.
 * Nothing here stores verse text.
 *
 * The lists reload every time the tab comes into focus, so a note saved in the
 * editor or a highlight made in the reader is there when the person returns.
 * Every string comes from i18n.
 */

type LibraryTab = 'highlights' | 'bookmarks' | 'notes';

const TABS: readonly LibraryTab[] = ['highlights', 'bookmarks', 'notes'];

/** Ignore a second tap on the same control inside this time. */
const DOUBLE_TAP_MS = 800;

/** Library lines use the reader font, but never larger than this, so lists stay short. */
const MAX_LIST_FONT = 18;

interface LibraryData {
  highlights: Highlight[];
  bookmarks: Bookmark[];
  notes: Note[];
  tags: TagWithCount[];
  /** note id -> tag names */
  tagMap: Map<number, string[]>;
  /** "packId:verseId" -> verse text */
  texts: Map<string, string>;
}

const EMPTY_DATA: LibraryData = {
  highlights: [],
  bookmarks: [],
  notes: [],
  tags: [],
  tagMap: new Map(),
  texts: new Map(),
};

type ListEntry =
  | { tab: 'highlights'; key: string; item: Highlight }
  | { tab: 'bookmarks'; key: string; item: Bookmark }
  | { tab: 'notes'; key: string; item: Note };

/** The item the action sheet is open for. */
type Target =
  | { tab: 'highlights'; item: Highlight }
  | { tab: 'bookmarks'; item: Bookmark }
  | { tab: 'notes'; item: Note };

/** "Oct 31, 2026" in the interface language, without Intl. */
function shortDate(timestamp: number, lang: LangCode): string {
  const date = new Date(timestamp);
  return `${monthName(date.getMonth(), lang)} ${date.getDate()}, ${date.getFullYear()}`;
}

function removeTitleKey(tab: LibraryTab): string {
  if (tab === 'highlights') return 'library.removeHighlight';
  if (tab === 'bookmarks') return 'library.removeBookmark';
  return 'library.removeNote';
}

function textKey(packId: string, verseId: VerseId): string {
  return `${packId}:${verseId}`;
}

/**
 * Reads the verse text of every item. Each verse is asked from the pack it was
 * marked in and from the current translation, so a missing pack still shows
 * the verse when the other one has it. A pack that fails to open is skipped.
 */
async function loadTexts(
  entries: ReadonlyArray<{ verse_id: VerseId; translation: string }>,
  fallbackPack: string,
): Promise<Map<string, string>> {
  const wanted = new Map<string, Set<VerseId>>();
  const want = (packId: string, verseId: VerseId): void => {
    const set = wanted.get(packId) ?? new Set<VerseId>();
    set.add(verseId);
    wanted.set(packId, set);
  };
  for (const entry of entries) {
    want(entry.translation, entry.verse_id);
    want(fallbackPack, entry.verse_id);
  }

  const texts = new Map<string, string>();
  for (const [packId, ids] of wanted) {
    try {
      const rows = await loadVerses(packId, Array.from(ids));
      for (const row of rows) texts.set(textKey(packId, row.id), row.text);
    } catch {
      // Pack not installed or unreadable: the items say the verse is not available.
    }
  }
  return texts;
}

export default function LibraryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useI18n();
  const { uiLanguage, translation, fontSize, lineHeight, fontFamily } =
    useSettingsStore(selectSettings);

  const [tab, setTab] = useState<LibraryTab>('highlights');
  const [data, setData] = useState<LibraryData>(EMPTY_DATA);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [colorFilter, setColorFilter] = useState<HighlightColor | null>(null);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const [labelDraft, setLabelDraft] = useState('');
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  const lastTap = useRef(0);
  const acceptTap = useCallback((): boolean => {
    const now = Date.now();
    if (now - lastTap.current < DOUBLE_TAP_MS) return false;
    lastTap.current = now;
    return true;
  }, []);

  const typography = useMemo(
    () => readerTypography(Math.min(fontSize, MAX_LIST_FONT), lineHeight, fontFamily),
    [fontSize, lineHeight, fontFamily],
  );

  /* ---------------- Loading ---------------- */

  const load = useCallback(async (): Promise<void> => {
    try {
      const db = await getUserDb();
      const [highlights, bookmarks, notes, tags, tagMap] = await Promise.all([
        listHighlights(db),
        listBookmarks(db),
        listNotes(db),
        listTags(db),
        getNoteTagMap(db),
      ]);
      const texts = await loadTexts([...highlights, ...bookmarks, ...notes], translation);
      setData({ highlights, bookmarks, notes, tags, tagMap, texts });
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoaded(true);
    }
  }, [translation]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // A tag that no note uses any more cannot stay as the filter.
  const activeTag = useMemo(
    () => (tagFilter !== null && data.tags.some((tag) => tag.name === tagFilter) ? tagFilter : null),
    [tagFilter, data.tags],
  );

  /* ---------------- Rows ---------------- */

  const entries = useMemo<ListEntry[]>(() => {
    if (tab === 'highlights') {
      return data.highlights
        .filter((item) => colorFilter === null || item.color === colorFilter)
        .map((item) => ({ tab: 'highlights', key: `h-${item.id}`, item }));
    }
    if (tab === 'bookmarks') {
      return data.bookmarks.map((item) => ({ tab: 'bookmarks', key: `b-${item.id}`, item }));
    }
    return data.notes
      .filter((item) => activeTag === null || (data.tagMap.get(item.id) ?? []).includes(activeTag))
      .map((item) => ({ tab: 'notes', key: `n-${item.id}`, item }));
  }, [tab, data, colorFilter, activeTag]);

  const hasAnyInTab =
    tab === 'highlights'
      ? data.highlights.length > 0
      : tab === 'bookmarks'
        ? data.bookmarks.length > 0
        : data.notes.length > 0;

  const textFor = useCallback(
    (packId: string, verseId: VerseId): string | null => {
      const own = data.texts.get(textKey(packId, verseId));
      if (own !== undefined) return own;
      return data.texts.get(textKey(translation, verseId)) ?? null;
    },
    [data.texts, translation],
  );

  const colorLabels = useMemo<ColorPickerLabels>(
    () => ({
      group: t('library.filterColor'),
      all: t('library.all'),
      colorName: (color: HighlightColor) => t(`library.color.${color}`),
    }),
    [t],
  );

  /* ---------------- Navigation and actions ---------------- */

  const openVerse = useCallback(
    (verseId: VerseId): void => {
      if (!acceptTap()) return;
      const ref = parseVerseId(verseId);
      router.push({
        pathname: '/reader/[book]/[chapter]',
        params: {
          book: String(ref.book),
          chapter: String(ref.chapter),
          verse: String(ref.verse),
        },
      });
    },
    [acceptTap, router],
  );

  const openSheet = useCallback((next: Target): void => {
    setConfirmingRemove(false);
    setLabelDraft(next.tab === 'bookmarks' ? (next.item.label ?? '') : '');
    setTarget(next);
  }, []);

  const closeSheet = useCallback((): void => {
    setTarget(null);
    setConfirmingRemove(false);
  }, []);

  const editNote = useCallback((): void => {
    if (!target || target.tab !== 'notes') return;
    const { item } = target;
    closeSheet();
    router.push({
      pathname: '/note-editor',
      params: {
        verseId: String(item.verse_id),
        translation: item.translation,
        noteId: String(item.id),
      },
    });
  }, [target, closeSheet, router]);

  const openFromSheet = useCallback((): void => {
    if (!target) return;
    const verseId = target.item.verse_id;
    closeSheet();
    openVerse(verseId);
  }, [target, closeSheet, openVerse]);

  const saveLabel = useCallback((): void => {
    if (!target || target.tab !== 'bookmarks') return;
    const id = target.item.id;
    const label = labelDraft;
    closeSheet();
    void (async () => {
      try {
        const db = await getUserDb();
        await setBookmarkLabel(db, id, label);
      } catch {
        setFailed(true);
      }
      await load();
    })();
  }, [target, labelDraft, closeSheet, load]);

  const removeTarget = useCallback((): void => {
    if (!target) return;
    const current = target;
    closeSheet();
    void (async () => {
      try {
        const db = await getUserDb();
        if (current.tab === 'highlights') await clearHighlights(db, [current.item.verse_id]);
        else if (current.tab === 'bookmarks') await removeBookmarks(db, [current.item.verse_id]);
        else await deleteNote(db, current.item.id);
      } catch {
        setFailed(true);
      }
      await load();
    })();
  }, [target, closeSheet, load]);

  const handleRemovePress = useCallback((): void => {
    // A note holds words the person wrote, so it asks once. A highlight or a
    // bookmark is quick to make again and goes at once.
    if (target?.tab === 'notes' && !confirmingRemove) {
      setConfirmingRemove(true);
      return;
    }
    removeTarget();
  }, [target, confirmingRemove, removeTarget]);

  /* ---------------- List ---------------- */

  const renderItem = useCallback(
    ({ item: entry }: ListRenderItemInfo<ListEntry>) => {
      const verse = entry.item.verse_id;
      const packId = entry.item.translation;
      const reference = formatVerseId(verse, uiLanguage);
      const translationLabel = packId.toUpperCase();
      const text = textFor(packId, verse);
      const missingText = t('library.verseMissing');
      const plain = text === null ? '' : cleanVerseText(text);

      if (entry.tab === 'highlights') {
        const { item } = entry;
        const date = shortDate(item.created_at, uiLanguage);
        const colorName = t(`library.color.${item.color}`);
        return (
          <HighlightItem
            reference={reference}
            translationLabel={translationLabel}
            text={text}
            missingText={missingText}
            typography={typography}
            color={item.color}
            dateLabel={date}
            onPress={() => openVerse(verse)}
            onLongPress={() => openSheet({ tab: 'highlights', item })}
            accessibilityLabel={t('library.a11yHighlight', {
              reference,
              translation: translationLabel,
              color: colorName,
              date,
              text: plain,
            })}
            accessibilityHint={t('library.itemHint')}
          />
        );
      }

      if (entry.tab === 'bookmarks') {
        const { item } = entry;
        const date = shortDate(item.created_at, uiLanguage);
        return (
          <HighlightItem
            reference={reference}
            translationLabel={translationLabel}
            text={text}
            missingText={missingText}
            typography={typography}
            label={item.label ?? undefined}
            dateLabel={date}
            onPress={() => openVerse(verse)}
            onLongPress={() => openSheet({ tab: 'bookmarks', item })}
            accessibilityLabel={t('library.a11yBookmark', {
              reference,
              translation: translationLabel,
              label: item.label ?? '',
              date,
              text: plain,
            })}
            accessibilityHint={t('library.itemHint')}
          />
        );
      }

      const { item } = entry;
      const date = shortDate(item.updated_at, uiLanguage);
      const tagsText = (data.tagMap.get(item.id) ?? []).join(', ');
      return (
        <HighlightItem
          reference={reference}
          translationLabel={translationLabel}
          text={text}
          missingText={missingText}
          typography={typography}
          note={item.body}
          tagsText={tagsText.length > 0 ? tagsText : undefined}
          dateLabel={date}
          onPress={() => openVerse(verse)}
          onLongPress={() => openSheet({ tab: 'notes', item })}
          accessibilityLabel={t('library.a11yNote', {
            reference,
            translation: translationLabel,
            note: item.body,
            tags: tagsText,
            date,
            text: plain,
          })}
          accessibilityHint={t('library.itemHint')}
        />
      );
    },
    [uiLanguage, textFor, t, typography, openVerse, openSheet, data.tagMap],
  );

  const keyExtractor = useCallback((entry: ListEntry) => entry.key, []);

  const emptyMessage = useMemo((): string => {
    if (failed) return t('library.loadError');
    if (!loaded) return '';
    if (hasAnyInTab) return t('library.noMatches');
    if (tab === 'highlights') return t('library.emptyHighlights');
    if (tab === 'bookmarks') return t('library.emptyBookmarks');
    return t('library.emptyNotes');
  }, [failed, loaded, hasAnyInTab, tab, t]);

  const sheetTitle = target
    ? `${formatVerseId(target.item.verse_id, uiLanguage)} · ${target.item.translation.toUpperCase()}`
    : undefined;

  /* ---------------- Screen ---------------- */

  const labelInputStyle = [
    uiTextStyle('body'),
    styles.labelInput,
    { color: colors.text, borderBottomColor: colors.divider },
  ];

  return (
    <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={styles.column}>
        <Text variant="title" style={styles.heading}>
          {t('tabs.library')}
        </Text>

        <View style={styles.tabs} accessibilityRole="tablist">
          {TABS.map((name) => {
            const selected = tab === name;
            const label = t(`library.tab.${name}`);
            return (
              <Pressable
                key={name}
                onPress={() => setTab(name)}
                accessibilityRole="tab"
                accessibilityLabel={label}
                accessibilityState={{ selected }}
                style={({ pressed }) => [
                  styles.tab,
                  selected && { borderBottomColor: colors.accent },
                  pressed && { backgroundColor: colors.selection },
                ]}
              >
                <Text
                  variant="label"
                  tone={selected ? 'accent' : 'muted'}
                  importantForAccessibility="no"
                  style={selected ? styles.tabSelected : undefined}
                >
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {tab === 'highlights' && data.highlights.length > 0 ? (
          <ColorPicker value={colorFilter} labels={colorLabels} onChange={setColorFilter} />
        ) : null}

        {tab === 'notes' && data.tags.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            accessibilityRole="radiogroup"
            accessibilityLabel={t('library.filterTag')}
            contentContainerStyle={styles.tagLine}
          >
            <Pressable
              onPress={() => setTagFilter(null)}
              accessibilityRole="radio"
              accessibilityLabel={t('library.all')}
              accessibilityState={{ checked: activeTag === null }}
              style={styles.tagChip}
            >
              <Text
                variant="label"
                tone={activeTag === null ? 'accent' : 'muted'}
                importantForAccessibility="no"
                style={activeTag === null ? styles.tabSelected : undefined}
              >
                {t('library.all')}
              </Text>
            </Pressable>
            {data.tags.map((tag) => {
              const chosen = activeTag === tag.name;
              return (
                <Pressable
                  key={tag.id}
                  onPress={() => setTagFilter(chosen ? null : tag.name)}
                  accessibilityRole="radio"
                  accessibilityLabel={t('library.tagLabel', { tag: tag.name, count: tag.count })}
                  accessibilityState={{ checked: chosen }}
                  style={styles.tagChip}
                >
                  <Text
                    variant="label"
                    tone={chosen ? 'accent' : 'muted'}
                    importantForAccessibility="no"
                    style={chosen ? styles.tabSelected : undefined}
                  >
                    {`${tag.name} (${tag.count})`}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}
      </View>

      <Divider />

      <FlatList
        data={entries}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        extraData={typography}
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={7}
        removeClippedSubviews
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.list, { paddingBottom: space.xxxl }]}
        ListEmptyComponent={
          emptyMessage.length > 0 ? (
            <View style={styles.emptyBox}>
              <Text variant="body" tone="muted">
                {emptyMessage}
              </Text>
              {failed ? (
                <Button
                  label={t('common.retry')}
                  onPress={() => {
                    setFailed(false);
                    void load();
                  }}
                  style={styles.retry}
                />
              ) : null}
            </View>
          ) : null
        }
      />

      <Sheet visible={target !== null} onClose={closeSheet} title={sheetTitle} closeLabel={t('common.close')}>
        {target ? (
          <View>
            <Row
              title={t('library.openInContext')}
              chevron
              onPress={openFromSheet}
              accessibilityHint={t('library.openInContextHint')}
            />

            {target.tab === 'notes' ? (
              <Row title={t('library.editNote')} chevron onPress={editNote} />
            ) : null}

            {target.tab === 'bookmarks' ? (
              <View style={styles.labelBox}>
                <Text variant="label" tone="muted">
                  {t('library.bookmarkLabel')}
                </Text>
                <TextInput
                  value={labelDraft}
                  onChangeText={setLabelDraft}
                  onSubmitEditing={saveLabel}
                  placeholder={t('library.bookmarkLabelPlaceholder')}
                  placeholderTextColor={colors.muted}
                  accessibilityLabel={t('library.bookmarkLabel')}
                  maxLength={80}
                  returnKeyType="done"
                  maxFontSizeMultiplier={maxUiFontScale}
                  selectionColor={colors.accent}
                  style={labelInputStyle}
                />
                <Button
                  label={t('library.saveLabel')}
                  onPress={saveLabel}
                  style={styles.saveLabel}
                />
              </View>
            ) : null}

            {confirmingRemove ? (
              <View style={styles.confirmBox}>
                <Text variant="body">{t('library.confirmRemoveNote')}</Text>
                <View style={styles.confirmButtons}>
                  <Button label={t('library.removeConfirm')} variant="filled" onPress={removeTarget} />
                  <Button
                    label={t('library.keep')}
                    variant="outline"
                    onPress={() => setConfirmingRemove(false)}
                  />
                </View>
              </View>
            ) : (
              <Row
                title={t(removeTitleKey(target.tab))}
                onPress={handleRemovePress}
                divider={false}
              />
            )}
          </View>
        ) : null}
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  column: {
    width: '100%',
    maxWidth: READER.maxColumnWidth,
    alignSelf: 'center',
    paddingHorizontal: space.xl,
  },
  heading: {
    marginTop: space.xl,
    marginBottom: space.md,
  },
  tabs: {
    flexDirection: 'row',
  },
  tab: {
    flex: 1,
    minHeight: A11Y.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabSelected: {
    fontWeight: '700',
  },
  tagLine: {
    alignItems: 'center',
    paddingVertical: space.xs,
  },
  tagChip: {
    minHeight: A11Y.minTouchTarget,
    minWidth: A11Y.minTouchTarget,
    paddingHorizontal: space.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: {
    width: '100%',
    maxWidth: READER.maxColumnWidth,
    alignSelf: 'center',
    paddingHorizontal: space.xl,
  },
  emptyBox: {
    paddingTop: space.xl,
  },
  retry: {
    alignSelf: 'flex-start',
    marginLeft: -space.lg,
    marginTop: space.sm,
  },
  labelBox: {
    paddingHorizontal: space.xl,
    paddingVertical: space.md,
  },
  labelInput: {
    minHeight: A11Y.minTouchTarget,
    fontSize: uiFontSize.body,
    paddingVertical: space.sm,
    borderBottomWidth: hairline,
  },
  saveLabel: {
    alignSelf: 'flex-start',
    marginLeft: -space.lg,
  },
  confirmBox: {
    paddingHorizontal: space.xl,
    paddingVertical: space.md,
  },
  confirmButtons: {
    flexDirection: 'row',
    marginTop: space.sm,
    marginLeft: -space.lg,
  },
});
