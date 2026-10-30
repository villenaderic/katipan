import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type ListRenderItemInfo,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { Divider } from '@/components/ui/Divider';
import { Text } from '@/components/ui/Text';
import { A11Y, READER } from '@/constants/config';
import {
  countSearchMatches,
  parseSearchQuery,
  searchVerses,
  type SearchHit,
} from '@/db/queries/search';
import { useI18n } from '@/i18n';
import { getPackDatabase, getPackInfo, listInstalledPacks } from '@/services/bibleService';
import { selectSettings, useSettingsStore } from '@/store/settingsStore';
import { useTheme } from '@/theme/ThemeProvider';
import { hairline, maxUiFontScale, space, uiFontSize } from '@/theme/tokens';
import { uiTextStyle } from '@/theme/typography';
import { formatCount, makeSnippet, splitByTerms } from '@/utils/format';
import { formatReference, formatVerseId, parseReference, parseVerseId } from '@/utils/reference';

/**
 * Search tab: one input that understands words and references.
 *
 *  - "John 3:16" or "Juan 3" shows a "Go to" line on top. A lone word that is
 *    also a book name ("mark", "job") is searched as a word, as the parser
 *    advises, so it never hides real results.
 *  - Words search every installed translation, the current one first, and the
 *    results are grouped by translation. Each group shows how many verses
 *    match and loads more on request.
 *  - Each result is the reference plus a short piece of the verse with the
 *    matched words in the accent color and bold (not color alone).
 *  - Tapping a result opens that chapter at that verse in the reader, which
 *    shows it in the person's current translation.
 *  - Runs only against local packs, so it works in airplane mode.
 */

/** Wait this long after the last keystroke before searching. */
const DEBOUNCE_MS = 250;

/** Verses fetched for a group the first time, and for each "Show more". */
const PAGE_SIZE = 30;

/** Ignore a second tap on the same control inside this time. */
const DOUBLE_TAP_MS = 800;

interface Group {
  packId: string;
  label: string;
  total: number;
  hits: SearchHit[];
  loadingMore: boolean;
}

type ListItem =
  | { kind: 'header'; key: string; group: Group }
  | { kind: 'hit'; key: string; hit: SearchHit; packId: string }
  | { kind: 'more'; key: string; group: Group };

type Status = 'idle' | 'searching' | 'done';

/** Installed pack ids with the person's current translation first. */
function orderPacks(ids: readonly string[], current: string): string[] {
  return [...ids].sort((a, b) => {
    if (a === current) return -1;
    if (b === current) return 1;
    return 0;
  });
}

export default function SearchScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useI18n();
  const { uiLanguage, translation } = useSettingsStore(selectSettings);

  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [packIds, setPackIds] = useState<string[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [status, setStatus] = useState<Status>('idle');
  const [failed, setFailed] = useState(false);

  const runId = useRef(0);
  const lastTap = useRef(0);

  const acceptTap = useCallback((): boolean => {
    const now = Date.now();
    if (now - lastTap.current < DOUBLE_TAP_MS) return false;
    lastTap.current = now;
    return true;
  }, []);

  // Which translations are installed can change in the Translation Manager.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void listInstalledPacks()
        .then((packs) => {
          if (!cancelled) setPackIds(orderPacks(packs.map((pack) => pack.id), translation));
        })
        .catch(() => {
          if (!cancelled) setPackIds([translation]);
        });
      return () => {
        cancelled = true;
      };
    }, [translation]),
  );

  // Debounce what the person types.
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const parsedQuery = useMemo(() => parseSearchQuery(debounced), [debounced]);
  const terms = parsedQuery.terms;

  // Run the search over every installed pack.
  useEffect(() => {
    const id = (runId.current += 1);

    if (parsedQuery.match === null || packIds.length === 0) {
      setGroups([]);
      setStatus('idle');
      setFailed(false);
      return undefined;
    }

    setStatus('searching');
    setFailed(false);

    void (async () => {
      const found: Group[] = [];
      let anyFailure = false;

      for (const packId of packIds) {
        try {
          const db = await getPackDatabase(packId);
          const [hits, total, info] = await Promise.all([
            searchVerses(db, debounced, { limit: PAGE_SIZE }),
            countSearchMatches(db, debounced),
            getPackInfo(packId),
          ]);
          if (id !== runId.current) return;
          if (total > 0) {
            found.push({
              packId,
              label: info?.name ?? packId.toUpperCase(),
              total,
              hits,
              loadingMore: false,
            });
          }
        } catch {
          anyFailure = true;
        }
      }

      if (id !== runId.current) return;
      setGroups(found);
      setFailed(anyFailure && found.length === 0);
      setStatus('done');
    })();

    return () => {
      // A newer search (or leaving the screen) makes this one's results stale.
      runId.current += 1;
    };
  }, [debounced, packIds, parsedQuery.match]);

  const loadMore = useCallback(
    async (packId: string): Promise<void> => {
      const current = groups.find((group) => group.packId === packId);
      if (!current || current.loadingMore) return;
      const id = runId.current;

      setGroups((list) =>
        list.map((group) => (group.packId === packId ? { ...group, loadingMore: true } : group)),
      );

      try {
        const db = await getPackDatabase(packId);
        const more = await searchVerses(db, debounced, {
          limit: PAGE_SIZE,
          offset: current.hits.length,
        });
        if (id !== runId.current) return;
        setGroups((list) =>
          list.map((group) =>
            group.packId === packId
              ? { ...group, hits: [...group.hits, ...more], loadingMore: false }
              : group,
          ),
        );
      } catch {
        if (id !== runId.current) return;
        setGroups((list) =>
          list.map((group) => (group.packId === packId ? { ...group, loadingMore: false } : group)),
        );
      }
    },
    [groups, debounced],
  );

  /* ---------------- Reference jump ---------------- */

  const reference = useMemo(() => {
    const parsed = parseReference(query);
    return parsed && parsed.chapter !== null ? parsed : null;
  }, [query]);

  const referenceLabel = reference
    ? formatReference(
        {
          book: reference.book,
          chapter: reference.chapter,
          verse: reference.verse,
          verseEnd: reference.verseEnd,
        },
        uiLanguage,
      )
    : '';

  const openVerse = useCallback(
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

  const goToReference = useCallback((): void => {
    if (!reference || reference.chapter === null) return;
    openVerse(reference.book, reference.chapter, reference.verse);
  }, [reference, openVerse]);

  /* ---------------- List ---------------- */

  const items = useMemo<ListItem[]>(() => {
    const out: ListItem[] = [];
    for (const group of groups) {
      out.push({ kind: 'header', key: `h-${group.packId}`, group });
      for (const hit of group.hits) {
        out.push({ kind: 'hit', key: `${group.packId}-${hit.id}`, hit, packId: group.packId });
      }
      if (group.hits.length < group.total) {
        out.push({ kind: 'more', key: `m-${group.packId}`, group });
      }
    }
    return out;
  }, [groups]);

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<ListItem>) => {
      if (item.kind === 'header') {
        const summary = t('search.resultCount', { count: formatCount(item.group.total) });
        return (
          <View
            style={styles.groupHeader}
            accessible
            accessibilityRole="header"
            accessibilityLabel={`${item.group.label}. ${summary}`}
          >
            <Text variant="label" importantForAccessibility="no">
              {item.group.label}
            </Text>
            <Text variant="caption" tone="muted" importantForAccessibility="no">
              {summary}
            </Text>
          </View>
        );
      }

      if (item.kind === 'more') {
        return (
          <View style={styles.more}>
            <Button
              label={item.group.loadingMore ? t('search.loading') : t('search.showMore')}
              accessibilityLabel={t('search.showMoreA11y', { pack: item.group.label })}
              disabled={item.group.loadingMore}
              onPress={() => void loadMore(item.group.packId)}
            />
          </View>
        );
      }

      const { hit } = item;
      const label = formatVerseId(hit.id, uiLanguage);
      const snippet = makeSnippet(hit.text, terms);
      const segments = splitByTerms(snippet, terms);
      const ref = parseVerseId(hit.id);

      return (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${label}. ${snippet}`}
          accessibilityHint={t('search.hitHint')}
          onPress={() => openVerse(ref.book, ref.chapter, ref.verse)}
          style={({ pressed }) => [styles.hit, pressed && { backgroundColor: colors.selection }]}
        >
          <Text variant="caption" tone="muted" importantForAccessibility="no">
            {label}
          </Text>
          <Text variant="body" style={styles.snippet} importantForAccessibility="no">
            {segments.map((segment, index) => (
              <Text
                key={index}
                variant="body"
                tone={segment.match ? 'accent' : 'default'}
                style={segment.match ? styles.match : undefined}
              >
                {segment.text}
              </Text>
            ))}
          </Text>
        </Pressable>
      );
    },
    [t, uiLanguage, terms, openVerse, loadMore, colors.selection],
  );

  const keyExtractor = useCallback((item: ListItem) => item.key, []);

  /* ---------------- Empty states ---------------- */

  let emptyMessage: string | null = null;
  if (query.trim().length === 0) emptyMessage = t('search.hint');
  else if (status === 'searching') emptyMessage = t('search.searching');
  else if (status === 'done' && failed) emptyMessage = t('search.error');
  else if (status === 'done' && groups.length === 0) emptyMessage = t('search.noResults');
  else if (status === 'idle' && parsedQuery.match === null) emptyMessage = t('search.noWords');

  const inputStyle = [
    uiTextStyle('body'),
    styles.input,
    { color: colors.text, borderBottomColor: colors.divider },
  ];

  return (
    <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={styles.column}>
        <Text variant="title" style={styles.heading}>
          {t('tabs.search')}
        </Text>

        <View style={styles.inputRow}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={t('search.placeholder')}
            placeholderTextColor={colors.muted}
            accessibilityLabel={t('search.label')}
            accessibilityHint={t('search.inputHint')}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            maxFontSizeMultiplier={maxUiFontScale}
            selectionColor={colors.accent}
            style={[inputStyle, styles.inputFlex]}
          />
          {query.length > 0 ? (
            <Button
              label={t('search.clear')}
              accessibilityLabel={t('search.clearA11y')}
              onPress={() => setQuery('')}
            />
          ) : null}
        </View>

        {reference ? (
          <Button
            label={t('search.goTo', { reference: referenceLabel })}
            accessibilityLabel={t('search.goToA11y', { reference: referenceLabel })}
            onPress={goToReference}
            style={styles.goTo}
          />
        ) : null}
      </View>

      <Divider />

      <FlatList
        data={items}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        initialNumToRender={12}
        windowSize={7}
        removeClippedSubviews
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.list, { paddingBottom: space.xxxl }]}
        ListEmptyComponent={
          emptyMessage ? (
            <Text
              variant="body"
              tone="muted"
              style={styles.empty}
              accessibilityLiveRegion="polite"
            >
              {emptyMessage}
            </Text>
          ) : null
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
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  inputFlex: {
    flex: 1,
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
    flexGrow: 1,
  },
  empty: {
    paddingHorizontal: space.xl,
    marginTop: space.xl,
  },
  groupHeader: {
    paddingHorizontal: space.xl,
    paddingTop: space.xl,
    paddingBottom: space.sm,
  },
  hit: {
    minHeight: A11Y.minTouchTarget,
    paddingHorizontal: space.xl,
    paddingVertical: space.md,
  },
  snippet: {
    marginTop: 2,
  },
  match: {
    fontWeight: '700',
  },
  more: {
    paddingHorizontal: space.md,
    alignItems: 'flex-start',
  },
});
