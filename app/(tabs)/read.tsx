import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  BackHandler,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type ListRenderItemInfo,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { Divider } from '@/components/ui/Divider';
import { Row } from '@/components/ui/Row';
import { Text } from '@/components/ui/Text';
import { BOOKS, bookName, bookShort } from '@/constants/books';
import { A11Y, READER } from '@/constants/config';
import { useI18n } from '@/i18n';
import { useReaderStore } from '@/store/readerStore';
import { selectSettings, useSettingsStore } from '@/store/settingsStore';
import { useTheme } from '@/theme/ThemeProvider';
import { hairline, maxUiFontScale, space, uiFontSize } from '@/theme/tokens';
import { uiTextStyle } from '@/theme/typography';
import type { LangCode } from '@/types';
import { formatReference, normalizeBookKey, parseReference } from '@/utils/reference';

/**
 * Read tab: find something to read.
 *
 *  - Quick jump: one input that understands "John 3:16" and "Juan 3:16".
 *    While the text names a book and a chapter, a "Go to John 3:16" line
 *    appears on top; otherwise the text filters the book list by name in
 *    either language.
 *  - Books: Old and New Testament, with the book names in the interface
 *    language.
 *  - Chapters: tapping a book shows its chapters as a grid. Android Back
 *    returns to the book list before it leaves the tab.
 *  - Opening a chapter goes straight to the reader, which saves the place.
 *
 * Every string comes from i18n.
 */

/** Width and height of one chapter cell. Meets the 48dp touch rule. */
const CELL_SIZE = A11Y.minTouchTarget;

/** Ignore a second tap on the same control inside this time. */
const DOUBLE_TAP_MS = 800;

type ListItem =
  | { kind: 'header'; key: string; label: string }
  | { kind: 'book'; key: string; id: number };

/** True when the typed text is part of the book's name or short name in either language. */
function matchesBook(id: number, needle: string): boolean {
  if (needle.length === 0) return true;
  const langs: LangCode[] = ['en', 'fil'];
  return langs.some(
    (lang) =>
      normalizeBookKey(bookName(id, lang)).includes(needle) ||
      normalizeBookKey(bookShort(id, lang)).startsWith(needle),
  );
}

export default function ReadScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useI18n();
  const { uiLanguage } = useSettingsStore(selectSettings);
  const position = useReaderStore((state) => state.position);

  const [query, setQuery] = useState('');
  const [selectedBook, setSelectedBook] = useState<number | null>(null);
  const lastTap = useRef(0);

  const acceptTap = useCallback((): boolean => {
    const now = Date.now();
    if (now - lastTap.current < DOUBLE_TAP_MS) return false;
    lastTap.current = now;
    return true;
  }, []);

  // Back from the chapter grid goes to the book list, not out of the tab.
  useFocusEffect(
    useCallback(() => {
      if (selectedBook === null) return undefined;
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        setSelectedBook(null);
        return true;
      });
      return () => subscription.remove();
    }, [selectedBook]),
  );

  /* ---------------- Navigation ---------------- */

  const openChapter = useCallback(
    (book: number, chapter: number, verse?: number | null): void => {
      if (!acceptTap()) return;
      router.push({
        pathname: '/reader/[book]/[chapter]',
        params: {
          book: String(book),
          chapter: String(chapter),
          ...(verse ? { verse: String(verse) } : {}),
        },
      });
    },
    [acceptTap, router],
  );

  /* ---------------- Quick jump ---------------- */

  const parsed = useMemo(() => parseReference(query), [query]);
  const jump = parsed && parsed.chapter !== null ? parsed : null;
  const jumpLabel = jump
    ? formatReference(
        { book: jump.book, chapter: jump.chapter, verse: jump.verse, verseEnd: jump.verseEnd },
        uiLanguage,
      )
    : '';

  const handleSubmit = useCallback((): void => {
    if (!parsed) return;
    if (parsed.chapter !== null) {
      openChapter(parsed.book, parsed.chapter, parsed.verse);
    } else {
      setSelectedBook(parsed.book);
    }
  }, [parsed, openChapter]);

  /* ---------------- Book list ---------------- */

  const items = useMemo<ListItem[]>(() => {
    // A full reference ("John 3") is handled by the Go to line, so the list stays complete.
    const needle = jump ? '' : normalizeBookKey(query);
    const visible = BOOKS.filter((book) => matchesBook(book.id, needle));
    const ot = visible.filter((book) => book.testament === 'OT');
    const nt = visible.filter((book) => book.testament === 'NT');

    const out: ListItem[] = [];
    if (ot.length > 0) {
      out.push({ kind: 'header', key: 'h-ot', label: t('read.oldTestament') });
      for (const book of ot) out.push({ kind: 'book', key: `b-${book.id}`, id: book.id });
    }
    if (nt.length > 0) {
      out.push({ kind: 'header', key: 'h-nt', label: t('read.newTestament') });
      for (const book of nt) out.push({ kind: 'book', key: `b-${book.id}`, id: book.id });
    }
    return out;
  }, [query, jump, t]);

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<ListItem>) => {
      if (item.kind === 'header') {
        return (
          <View style={styles.sectionHeader}>
            <Text variant="label" tone="muted" accessibilityRole="header">
              {item.label}
            </Text>
          </View>
        );
      }
      const chapters = BOOKS.find((book) => book.id === item.id)?.chapters ?? 0;
      const name = bookName(item.id, uiLanguage);
      const count = t('read.chapterCount', { count: chapters });
      return (
        <Row
          title={name}
          value={count}
          chevron
          selected={position?.book === item.id}
          accessibilityLabel={`${name}. ${count}`}
          accessibilityHint={t('read.bookHint')}
          onPress={() => setSelectedBook(item.id)}
        />
      );
    },
    [uiLanguage, t, position?.book],
  );

  const keyExtractor = useCallback((item: ListItem) => item.key, []);

  /* ---------------- Chapter grid ---------------- */

  if (selectedBook !== null) {
    const book = BOOKS.find((entry) => entry.id === selectedBook);
    const name = bookName(selectedBook, uiLanguage);
    const cells = Array.from({ length: book?.chapters ?? 0 }, (_, index) => index + 1);

    return (
      <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: insets.top }]}>
        <View style={styles.column}>
          <Button
            label={t('read.allBooks')}
            accessibilityLabel={t('read.backToBooks')}
            onPress={() => setSelectedBook(null)}
            style={styles.back}
          />
          <Text variant="title" style={styles.bookTitle}>
            {name}
          </Text>
          <Text variant="label" tone="muted" style={styles.pickHint}>
            {t('read.pickChapter')}
          </Text>
        </View>
        <Divider />
        <ScrollView
          contentContainerStyle={[styles.grid, styles.column, { paddingBottom: space.xxxl }]}
        >
          {cells.map((chapter) => {
            const current = position?.book === selectedBook && position.chapter === chapter;
            return (
              <Pressable
                key={chapter}
                accessibilityRole="button"
                accessibilityLabel={t('read.chapterLabel', { book: name, chapter })}
                accessibilityState={{ selected: current }}
                onPress={() => openChapter(selectedBook, chapter)}
                style={({ pressed }) => [
                  styles.cell,
                  current && { borderColor: colors.accent },
                  pressed && { backgroundColor: colors.selection },
                ]}
              >
                <Text
                  variant="body"
                  tone={current ? 'accent' : 'default'}
                  importantForAccessibility="no"
                  style={current ? styles.cellCurrent : undefined}
                >
                  {String(chapter)}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    );
  }

  /* ---------------- Book list ---------------- */

  const inputStyle = [
    uiTextStyle('body'),
    styles.input,
    { color: colors.text, borderBottomColor: colors.divider },
  ];

  return (
    <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={styles.column}>
        <Text variant="title" style={styles.heading}>
          {t('tabs.read')}
        </Text>
        <TextInput
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={handleSubmit}
          placeholder={t('read.jumpPlaceholder')}
          placeholderTextColor={colors.muted}
          accessibilityLabel={t('read.jumpLabel')}
          accessibilityHint={t('read.jumpHint')}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="go"
          maxFontSizeMultiplier={maxUiFontScale}
          selectionColor={colors.accent}
          style={inputStyle}
        />
        {jump ? (
          <Button
            label={t('read.goTo', { reference: jumpLabel })}
            accessibilityLabel={t('read.goToA11y', { reference: jumpLabel })}
            onPress={handleSubmit}
            style={styles.goTo}
          />
        ) : null}
      </View>

      <FlatList
        data={items}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={20}
        windowSize={7}
        removeClippedSubviews
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.list, { paddingBottom: space.xxxl }]}
        ListEmptyComponent={
          <View style={styles.column}>
            <Text variant="body" tone="muted" style={styles.empty}>
              {t('read.noBooks')}
            </Text>
          </View>
        }
      />
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
    marginBottom: space.lg,
  },
  input: {
    minHeight: A11Y.minTouchTarget,
    fontSize: uiFontSize.body,
    paddingVertical: space.sm,
    borderBottomWidth: hairline,
  },
  goTo: {
    alignSelf: 'flex-start',
    marginLeft: -space.lg,
  },
  list: {
    width: '100%',
    maxWidth: READER.maxColumnWidth,
    alignSelf: 'center',
  },
  sectionHeader: {
    paddingHorizontal: space.xl,
    paddingTop: space.xl,
    paddingBottom: space.sm,
  },
  empty: {
    marginTop: space.xl,
  },
  back: {
    alignSelf: 'flex-start',
    marginLeft: -space.lg,
    marginTop: space.sm,
  },
  bookTitle: {
    marginTop: space.sm,
  },
  pickHint: {
    marginTop: space.xs,
    marginBottom: space.lg,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingTop: space.lg,
    gap: space.sm,
  },
  cell: {
    width: CELL_SIZE,
    height: CELL_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: hairline,
    borderColor: 'transparent',
  },
  cellCurrent: {
    fontWeight: '700',
  },
});
