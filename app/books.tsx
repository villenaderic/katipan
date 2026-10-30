import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  BackHandler,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type ListRenderItemInfo,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { Divider } from '@/components/ui/Divider';
import { Row } from '@/components/ui/Row';
import { Text } from '@/components/ui/Text';
import { BOOKS, bookName } from '@/constants/books';
import { A11Y, READER } from '@/constants/config';
import { useI18n } from '@/i18n';
import { useReaderStore } from '@/store/readerStore';
import { selectSettings, useSettingsStore } from '@/store/settingsStore';
import { useTheme } from '@/theme/ThemeProvider';
import { hairline, space } from '@/theme/tokens';

/**
 * Book and chapter picker: route /books, opened by tapping the title in the
 * reader header. The navigator draws the header (see app/_layout.tsx).
 *
 *  - Step one lists the 66 books under Old and New Testament, with the names
 *    in the interface language. The book being read is marked.
 *  - Step two shows the chapters of the chosen book as a grid. Android Back
 *    returns to the book list first, then leaves the picker.
 *  - Choosing a chapter returns to the reader: dismissTo() pops back to the
 *    reader that opened this picker and gives it the new chapter, so Back
 *    from the reader does not walk through the picker or older chapters.
 *    If the picker was opened some other way and no reader is below it,
 *    dismissTo() opens one instead.
 *
 * The Read tab has its own list with quick jump; this screen is the short
 * way to change chapter while reading. Every string comes from i18n.
 */

/** Width and height of one chapter cell. Meets the 48dp touch rule. */
const CELL_SIZE = A11Y.minTouchTarget;

/** Ignore a second tap on the same control inside this time. */
const DOUBLE_TAP_MS = 800;

type ListItem =
  | { kind: 'header'; key: string; label: string }
  | { kind: 'book'; key: string; id: number };

export default function BooksScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useI18n();
  const { uiLanguage } = useSettingsStore(selectSettings);
  const position = useReaderStore((state) => state.position);

  const [selectedBook, setSelectedBook] = useState<number | null>(null);
  const lastTap = useRef(0);

  const acceptTap = useCallback((): boolean => {
    const now = Date.now();
    if (now - lastTap.current < DOUBLE_TAP_MS) return false;
    lastTap.current = now;
    return true;
  }, []);

  // Back from the chapter grid goes to the book list, not out of the picker.
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

  const openChapter = useCallback(
    (book: number, chapter: number): void => {
      if (!acceptTap()) return;
      router.dismissTo({
        pathname: '/reader/[book]/[chapter]',
        params: { book: String(book), chapter: String(chapter) },
      });
    },
    [acceptTap, router],
  );

  /* ---------------- Book list ---------------- */

  const items = useMemo<ListItem[]>(() => {
    const out: ListItem[] = [];
    out.push({ kind: 'header', key: 'h-ot', label: t('books.oldTestament') });
    for (const book of BOOKS) {
      if (book.testament === 'OT') out.push({ kind: 'book', key: `b-${book.id}`, id: book.id });
    }
    out.push({ kind: 'header', key: 'h-nt', label: t('books.newTestament') });
    for (const book of BOOKS) {
      if (book.testament === 'NT') out.push({ kind: 'book', key: `b-${book.id}`, id: book.id });
    }
    return out;
  }, [t]);

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
      const count = t('books.chapterCount', { count: chapters });
      return (
        <Row
          title={name}
          value={count}
          chevron
          selected={position?.book === item.id}
          accessibilityLabel={`${name}. ${count}`}
          accessibilityHint={t('books.bookHint')}
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
      <View style={[styles.screen, { backgroundColor: colors.background }]}>
        <View style={styles.column}>
          <Button
            label={t('books.allBooks')}
            accessibilityLabel={t('books.backToBooks')}
            onPress={() => setSelectedBook(null)}
            style={styles.back}
          />
          <Text variant="title" style={styles.bookTitle}>
            {name}
          </Text>
          <Text variant="label" tone="muted" style={styles.pickHint}>
            {t('books.pickChapter')}
          </Text>
        </View>
        <Divider />
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            styles.grid,
            styles.column,
            { paddingBottom: insets.bottom + space.xxxl },
          ]}
        >
          {cells.map((chapter) => {
            const current = position?.book === selectedBook && position.chapter === chapter;
            return (
              <Pressable
                key={chapter}
                accessibilityRole="button"
                accessibilityLabel={t('books.chapterLabel', { book: name, chapter })}
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

  /* ---------------- Screen ---------------- */

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <FlatList
        data={items}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        initialNumToRender={20}
        windowSize={7}
        removeClippedSubviews
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + space.xxxl }]}
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
