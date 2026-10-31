import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  ScrollView,
  StyleSheet,
  TextInput,
  ToastAndroid,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { Divider } from '@/components/ui/Divider';
import { Row } from '@/components/ui/Row';
import { Text } from '@/components/ui/Text';
import { A11Y, READER } from '@/constants/config';
import { getUserDb } from '@/db/client';
import {
  createNote,
  deleteNote,
  getNote,
  getNoteTagMap,
  getNotesInRange,
  listTags,
  normalizeTagNames,
  updateNote,
} from '@/db/queries/user';
import { useI18n } from '@/i18n';
import { loadVerse } from '@/services/bibleService';
import { selectSettings, useSettingsStore } from '@/store/settingsStore';
import { useTheme } from '@/theme/ThemeProvider';
import { hairline, maxUiFontScale, space, uiFontSize } from '@/theme/tokens';
import { uiTextStyle } from '@/theme/typography';
import type { Note, VerseId } from '@/types';
import { cleanVerseText, truncate } from '@/utils/format';
import { formatVerseId } from '@/utils/reference';

/**
 * Note editor: route /note-editor.
 *
 * Params:
 *   verseId      required for a new note (the reader sends the first selected verse)
 *   translation  the pack the verse was read in
 *   noteId       present when editing a note that already exists (Library)
 *
 * What it does:
 *  - Shows the verse reference and text, so the note is written with the
 *    verse in view. A note is saved as verse id plus translation, never with
 *    the text, so a pack update cannot break it.
 *  - A note has a body and optional tags (typed with commas, or tapped from
 *    the tags already in use).
 *  - A new note on a verse that already has notes lists them below, so the
 *    person can open one instead of writing a second copy.
 *  - Saving writes to user.db and goes back. Leaving with unsaved text asks
 *    first, whether through the header arrow or Android Back.
 *  - Deleting asks for a second tap on the same screen, with no pop-up.
 *
 * Every string comes from i18n.
 */

/** Longest note body. Long enough for a page, short enough to keep the database small. */
const MAX_BODY_LENGTH = 5000;

/** How many tags already in use are offered as suggestions. */
const MAX_SUGGESTIONS = 8;

/** Characters of another note shown in the "other notes" list. */
const OTHER_NOTE_PREVIEW = 80;

/** Ignore a second tap on the same control inside this time. */
const DOUBLE_TAP_MS = 800;

/** Minimum height of the note box: about five lines. */
const BODY_MIN_HEIGHT = 140;

type LoadState = 'loading' | 'ready' | 'missing';

/** Expo Router gives a string, or an array when a param repeats. */
function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function toPositiveInteger(value: string | undefined): number {
  if (value === undefined || !/^\d+$/.test(value)) return 0;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : 0;
}

/** "a, b,c" -> ["a", "b", "c"], trimmed, no empties, no repeats. */
function parseTags(text: string): string[] {
  return normalizeTagNames(text.split(/[,\n]/));
}

export default function NoteEditorScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useI18n();
  const { uiLanguage, translation: settingsTranslation } = useSettingsStore(selectSettings);
  const params = useLocalSearchParams<{ verseId?: string; translation?: string; noteId?: string }>();

  const noteId = toPositiveInteger(firstParam(params.noteId));
  const paramVerseId = toPositiveInteger(firstParam(params.verseId));
  const paramTranslation = firstParam(params.translation);

  const [state, setState] = useState<LoadState>('loading');
  const [verseId, setVerseId] = useState<VerseId>(paramVerseId);
  const [packId, setPackId] = useState<string>(paramTranslation ?? settingsTranslation);
  const [verseText, setVerseText] = useState('');
  const [body, setBody] = useState('');
  const [tagsText, setTagsText] = useState('');
  const [savedBody, setSavedBody] = useState('');
  const [savedTags, setSavedTags] = useState('');
  const [knownTags, setKnownTags] = useState<string[]>([]);
  const [otherNotes, setOtherNotes] = useState<Note[]>([]);
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const lastTap = useRef(0);
  const leaving = useRef(false);

  const acceptTap = useCallback((): boolean => {
    const now = Date.now();
    if (now - lastTap.current < DOUBLE_TAP_MS) return false;
    lastTap.current = now;
    return true;
  }, []);

  /* ---------------- Load ---------------- */

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const db = await getUserDb();

        let nextVerseId = paramVerseId;
        let nextPack = paramTranslation ?? settingsTranslation;
        let nextBody = '';
        let nextTags = '';

        if (noteId > 0) {
          const note = await getNote(db, noteId);
          if (!note) {
            if (!cancelled) setState('missing');
            return;
          }
          nextVerseId = note.verse_id;
          nextPack = note.translation;
          nextBody = note.body;
          const tagMap = await getNoteTagMap(db);
          nextTags = (tagMap.get(note.id) ?? []).join(', ');
        } else if (nextVerseId <= 0) {
          if (!cancelled) setState('missing');
          return;
        }

        const [tags, onVerse] = await Promise.all([
          listTags(db),
          getNotesInRange(db, nextVerseId, nextVerseId),
        ]);

        // The text is only for display. A pack that is not installed must not
        // stop the person from writing the note.
        let text = '';
        try {
          const verse = await loadVerse(nextPack, nextVerseId);
          text = verse ? cleanVerseText(verse.text) : '';
        } catch {
          text = '';
        }

        if (cancelled) return;
        setVerseId(nextVerseId);
        setPackId(nextPack);
        setVerseText(text);
        setBody(nextBody);
        setSavedBody(nextBody);
        setTagsText(nextTags);
        setSavedTags(nextTags);
        setKnownTags(tags.map((tag) => tag.name));
        setOtherNotes(onVerse.filter((note) => note.id !== noteId));
        setState('ready');
      } catch {
        if (!cancelled) setState('missing');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [noteId, paramVerseId, paramTranslation, settingsTranslation]);

  /* ---------------- Unsaved changes ---------------- */

  const dirty = state === 'ready' && (body !== savedBody || tagsText !== savedTags);

  useEffect(() => {
    return (navigation as any).addListener('beforeRemove', (event: any) => {
      if (!dirty || leaving.current) return;
      event.preventDefault();
      Alert.alert(t('noteEditor.discardTitle'), t('noteEditor.discardBody'), [
        { text: t('noteEditor.keepEditing'), style: 'cancel' },
        {
          text: t('noteEditor.discard'),
          style: 'destructive',
          onPress: () => {
            leaving.current = true;
            if (event.data?.action) {
              navigation.dispatch(event.data.action);
            }
          },
        },
      ]);
    });
  }, [navigation, dirty, t]);

  const leave = useCallback((): void => {
    leaving.current = true;
    router.back();
  }, [router]);

  /* ---------------- Save and delete ---------------- */

  const trimmedBody = body.trim();
  const canSave = state === 'ready' && trimmedBody.length > 0 && !saving;

  const fail = useCallback((): void => {
    ToastAndroid.show(t('common.error'), ToastAndroid.SHORT);
  }, [t]);

  const save = useCallback((): void => {
    if (!canSave || !acceptTap()) return;
    setSaving(true);
    void (async () => {
      try {
        const db = await getUserDb();
        const tags = parseTags(tagsText);
        if (noteId > 0) await updateNote(db, noteId, trimmedBody, tags);
        else await createNote(db, verseId, packId, trimmedBody, tags);
        ToastAndroid.show(t('noteEditor.saved'), ToastAndroid.SHORT);
        leave();
      } catch {
        setSaving(false);
        fail();
      }
    })();
  }, [canSave, acceptTap, tagsText, noteId, trimmedBody, verseId, packId, t, leave, fail]);

  const confirmDelete = useCallback((): void => {
    if (noteId <= 0 || saving) return;
    setSaving(true);
    void (async () => {
      try {
        const db = await getUserDb();
        await deleteNote(db, noteId);
        ToastAndroid.show(t('noteEditor.deleted'), ToastAndroid.SHORT);
        leave();
      } catch {
        setSaving(false);
        fail();
      }
    })();
  }, [noteId, saving, t, leave, fail]);

  /* ---------------- Tags ---------------- */

  const suggestions = useMemo<string[]>(() => {
    const used = new Set(parseTags(tagsText).map((name) => name.toLowerCase()));
    return knownTags.filter((name) => !used.has(name.toLowerCase())).slice(0, MAX_SUGGESTIONS);
  }, [knownTags, tagsText]);

  const addTag = useCallback((name: string): void => {
    setTagsText((current) => {
      const existing = parseTags(current);
      return [...existing, name].join(', ');
    });
  }, []);

  /* ---------------- Other notes on the same verse ---------------- */

  const openOther = useCallback(
    (note: Note): void => {
      if (!acceptTap()) return;
      leaving.current = true;
      router.replace({
        pathname: '/note-editor',
        params: {
          verseId: String(note.verse_id),
          translation: note.translation,
          noteId: String(note.id),
        },
      });
    },
    [acceptTap, router],
  );

  /* ---------------- Screen ---------------- */

  const referenceLabel = verseId > 0 ? formatVerseId(verseId, uiLanguage) : '';

  if (state === 'loading') {
    return <View style={[styles.screen, { backgroundColor: colors.background }]} />;
  }

  if (state === 'missing') {
    return (
      <View style={[styles.screen, styles.centerBox, { backgroundColor: colors.background }]}>
        <Text variant="body" tone="muted" style={styles.centerText}>
          {t('noteEditor.notFound')}
        </Text>
        <Button label={t('common.back')} onPress={() => router.back()} />
      </View>
    );
  }

  const inputBase = [
    uiTextStyle('body'),
    styles.inputBase,
    { color: colors.text, borderColor: colors.divider },
  ];

  return (
    <KeyboardAvoidingView
      behavior="height"
      style={[styles.screen, { backgroundColor: colors.background }]}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space.xxxl }]}
      >
        <View style={styles.column}>
          <Text variant="label" tone="accent" style={styles.reference}>
            {`${referenceLabel} \u00B7 ${packId.toUpperCase()}`}
          </Text>
          {verseText.length > 0 ? (
            <Text variant="body" tone="muted" style={styles.verse}>
              {verseText}
            </Text>
          ) : null}
        </View>

        <Divider />

        <View style={styles.column}>
          <Text variant="label" tone="muted" style={styles.fieldLabel}>
            {t('noteEditor.noteLabel')}
          </Text>
          <TextInput
            value={body}
            onChangeText={setBody}
            placeholder={t('noteEditor.notePlaceholder')}
            placeholderTextColor={colors.muted}
            accessibilityLabel={t('noteEditor.noteLabel')}
            multiline
            textAlignVertical="top"
            maxLength={MAX_BODY_LENGTH}
            autoFocus={noteId <= 0}
            maxFontSizeMultiplier={maxUiFontScale}
            selectionColor={colors.accent}
            style={[inputBase, styles.bodyInput]}
          />

          <Text variant="label" tone="muted" style={styles.fieldLabel}>
            {t('noteEditor.tagsLabel')}
          </Text>
          <TextInput
            value={tagsText}
            onChangeText={setTagsText}
            placeholder={t('noteEditor.tagsPlaceholder')}
            placeholderTextColor={colors.muted}
            accessibilityLabel={t('noteEditor.tagsLabel')}
            accessibilityHint={t('noteEditor.tagsHint')}
            autoCapitalize="none"
            autoCorrect={false}
            maxFontSizeMultiplier={maxUiFontScale}
            selectionColor={colors.accent}
            style={[inputBase, styles.tagsInput]}
          />

          {suggestions.length > 0 ? (
            <View style={styles.suggestions}>
              {suggestions.map((name) => (
                <Button
                  key={name}
                  label={name}
                  accessibilityLabel={t('noteEditor.addTag', { tag: name })}
                  onPress={() => addTag(name)}
                />
              ))}
            </View>
          ) : null}

          <View style={styles.actions}>
            <Button
              label={t('common.save')}
              variant="filled"
              disabled={!canSave}
              onPress={save}
            />
            <Button label={t('common.cancel')} onPress={() => router.back()} />
          </View>

          {noteId > 0 ? (
            confirmingDelete ? (
              <View style={styles.deleteBox}>
                <Text variant="label" tone="muted">
                  {t('noteEditor.deleteAsk')}
                </Text>
                <View style={styles.actions}>
                  <Button
                    label={t('noteEditor.deleteConfirm')}
                    disabled={saving}
                    onPress={confirmDelete}
                  />
                  <Button label={t('common.cancel')} onPress={() => setConfirmingDelete(false)} />
                </View>
              </View>
            ) : (
              <Button
                label={t('noteEditor.delete')}
                onPress={() => setConfirmingDelete(true)}
                style={styles.deleteButton}
              />
            )
          ) : null}
        </View>

        {noteId <= 0 && otherNotes.length > 0 ? (
          <View>
            <Text
              variant="label"
              tone="muted"
              accessibilityRole="header"
              style={[styles.column, styles.otherHeading]}
            >
              {t('noteEditor.otherNotes')}
            </Text>
            <Divider />
            {otherNotes.map((note) => (
              <Row
                key={note.id}
                title={truncate(note.body.replace(/\s+/g, ' '), OTHER_NOTE_PREVIEW)}
                chevron
                onPress={() => openOther(note)}
                accessibilityHint={t('noteEditor.otherNoteHint')}
              />
            ))}
          </View>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  centerBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xl,
  },
  centerText: {
    textAlign: 'center',
    marginBottom: space.lg,
  },
  content: {
    width: '100%',
    maxWidth: READER.maxColumnWidth,
    alignSelf: 'center',
  },
  column: {
    paddingHorizontal: space.xl,
  },
  reference: {
    marginTop: space.lg,
  },
  verse: {
    marginTop: space.sm,
    marginBottom: space.lg,
  },
  fieldLabel: {
    marginTop: space.lg,
    marginBottom: space.sm,
  },
  inputBase: {
    fontSize: uiFontSize.body,
    borderWidth: hairline,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  bodyInput: {
    minHeight: BODY_MIN_HEIGHT,
  },
  tagsInput: {
    minHeight: A11Y.minTouchTarget,
  },
  suggestions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: space.sm,
    marginLeft: -space.lg,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginTop: space.lg,
  },
  deleteBox: {
    marginTop: space.xl,
  },
  deleteButton: {
    alignSelf: 'flex-start',
    marginLeft: -space.lg,
    marginTop: space.lg,
  },
  otherHeading: {
    paddingTop: space.xl,
    paddingBottom: space.sm,
  },
});
