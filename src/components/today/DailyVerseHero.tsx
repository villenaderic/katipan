import { useEffect, useMemo, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

import { READER } from '../../constants/config';
import type { DailyVerseStatus } from '../../hooks/useDailyVerse';
import type { DailyVerse } from '../../services/dailyVerseService';
import { selectSettings, useSettingsStore } from '../../store/settingsStore';
import { useTheme } from '../../theme/ThemeProvider';
import { maxUiFontScale, space } from '../../theme/tokens';
import { readerTypography } from '../../theme/typography';
import { Button } from '../ui/Button';
import { Text } from '../ui/Text';

/** Translated text for the hero. The Today screen fills this from i18n. */
export interface DailyVerseHeroLabels {
  share: string;
  /** Spoken label of Share, for example "Share today's verse". */
  shareA11y: string;
  openInContext: string;
  /** Spoken label of Open in context, for example "Open John 3:16 in John chapter 3". */
  openInContextA11y: (reference: string) => string;
  /** Spoken as one piece: reference first, then the verse. */
  verseA11y: (reference: string, text: string) => string;
  loadError: string;
  retry: string;
}

export interface DailyVerseHeroProps {
  status: DailyVerseStatus;
  /** Null until status is "ready". */
  verse: DailyVerse | null;
  /** The long date, already formatted and translated: "Friday, October 30". */
  dateLabel: string;
  labels: DailyVerseHeroLabels;
  onShare: () => void;
  onOpenInContext: () => void;
  onRetry: () => void;
}

/** The verse is set this much larger than the reading size, so it leads the screen. */
const HERO_SIZE_BOOST = 6;

/** Keeps the layout from jumping while the first read is still running. */
const LOADING_MIN_HEIGHT = 160;

/**
 * The top of the Today screen: the date, the verse of the day in large type,
 * its reference, and two quiet text buttons (Share, Open in context).
 *
 *  - The verse follows the person's reading settings (serif or sans, line
 *    spacing) at a larger size, never above the 30 size cap.
 *  - No box, no card, no background: the text is the interface.
 *  - A new verse (new day, new translation) fades in over under 150 ms,
 *    or appears at once in Lite mode or with system "reduce motion".
 *  - Same column width as the reader, centered on tablets.
 */
export function DailyVerseHero({
  status,
  verse,
  dateLabel,
  labels,
  onShare,
  onOpenInContext,
  onRetry,
}: DailyVerseHeroProps) {
  const { colors, fadeMs } = useTheme();
  const { fontSize, lineHeight, fontFamily } = useSettingsStore(selectSettings);

  const typography = useMemo(
    () => readerTypography(Math.min(READER.maxFont, fontSize + HERO_SIZE_BOOST), lineHeight, fontFamily),
    [fontSize, lineHeight, fontFamily],
  );

  const opacity = useRef(new Animated.Value(1)).current;
  const verseId = verse?.verseId;
  const verseTranslation = verse?.translation;

  useEffect(() => {
    if (fadeMs === 0 || verseId === undefined) {
      opacity.setValue(1);
      return undefined;
    }
    opacity.setValue(0);
    const animation = Animated.timing(opacity, {
      toValue: 1,
      duration: fadeMs,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [verseId, verseTranslation, fadeMs, opacity]);

  return (
    <View style={styles.column}>
      <Text variant="label" tone="muted" style={styles.date}>
        {dateLabel}
      </Text>

      {status === 'loading' ? <View style={styles.loading} /> : null}

      {status === 'error' ? (
        <View style={styles.errorBox}>
          <Text variant="body" tone="muted">
            {labels.loadError}
          </Text>
          <Button label={labels.retry} onPress={onRetry} style={styles.retry} />
        </View>
      ) : null}

      {status === 'ready' && verse ? (
        <>
          <Animated.View
            style={{ opacity }}
            accessible
            accessibilityLabel={labels.verseA11y(verse.reference, verse.text)}
          >
            <Text
              maxFontSizeMultiplier={maxUiFontScale}
              style={[typography.verse, styles.verse]}
              importantForAccessibility="no"
            >
              {verse.text}
            </Text>
            <Text
              variant="label"
              tone="muted"
              style={styles.reference}
              importantForAccessibility="no"
            >
              {`${verse.reference} \u00B7 ${verse.translation.toUpperCase()}`}
            </Text>
          </Animated.View>

          <View style={styles.actions}>
            <Button
              label={labels.share}
              accessibilityLabel={labels.shareA11y}
              onPress={onShare}
            />
            <Button
              label={labels.openInContext}
              accessibilityLabel={labels.openInContextA11y(verse.reference)}
              onPress={onOpenInContext}
            />
          </View>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  column: {
    width: '100%',
    maxWidth: READER.maxColumnWidth,
    alignSelf: 'center',
    paddingHorizontal: space.xl,
  },
  date: {
    marginBottom: space.xl,
  },
  loading: {
    minHeight: LOADING_MIN_HEIGHT,
  },
  verse: {
    // Scripture is left aligned: centered text makes uneven lines hard to read.
    textAlign: 'left',
  },
  reference: {
    marginTop: space.md,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: space.lg,
    // Pull the first button back so its label lines up with the text above;
    // the button's own padding still gives it a full 48dp touch target.
    marginLeft: -space.lg,
  },
  errorBox: {
    minHeight: LOADING_MIN_HEIGHT,
    alignItems: 'flex-start',
  },
  retry: {
    marginLeft: -space.lg,
    marginTop: space.sm,
  },
});
