import { useMemo } from 'react';
import { Pressable, StyleSheet, Text as RNText, View } from 'react-native';

import { A11Y, READER } from '../../constants/config';
import { selectSettings, useSettingsStore } from '../../store/settingsStore';
import { useTheme } from '../../theme/ThemeProvider';
import { THEME_NAMES } from '../../theme/themes';
import { maxUiFontScale, space } from '../../theme/tokens';
import { clampFontSize, clampLineHeight, readerTypography } from '../../theme/typography';
import type { FontFamilyChoice, ThemeName } from '../../types';
import { Divider } from '../ui/Divider';
import { Sheet } from '../ui/Sheet';
import { Text } from '../ui/Text';

/** Translated text for the sheet. The reader screen fills this from i18n. */
export interface ReaderSettingsLabels {
  /** Sheet heading, for example "Reading settings". */
  title: string;
  close: string;

  /** "Text size" */
  textSize: string;
  smaller: string;
  larger: string;

  /** "Line spacing" */
  lineSpacing: string;
  tighter: string;
  looser: string;

  /** "Typeface" and its two choices. */
  typeface: string;
  serif: string;
  sans: string;

  /** "Verse numbers" and the spoken/visible state. */
  verseNumbers: string;
  on: string;
  off: string;

  /** "Theme" and the name of each theme: "Light", "Sepia", "Dark", "True black". */
  theme: string;
  themeName: (name: ThemeName) => string;

  /** A short sample line shown in the current style, for example the first words of Psalm 23. */
  preview: string;
}

export interface ReaderSettingsSheetProps {
  visible: boolean;
  onClose: () => void;
  labels: ReaderSettingsLabels;
}

const FONT_CHOICES: readonly FontFamilyChoice[] = ['serif', 'sans'];

/**
 * The sheet behind the "Aa" button: everything about how the page looks, in
 * one place, with no navigation.
 *
 *  - A preview line in the current style, so a change is seen at once.
 *  - Text size 14 to 30 in steps of 2, and line spacing 1.3 to 1.9 in steps
 *    of 0.1, each with a smaller and a larger button.
 *  - Serif or sans, verse numbers on or off, and the four themes.
 *
 * It reads and writes settingsStore directly, so the verse list behind it
 * changes as the person taps (settings are saved to user.db by the store).
 * Plain text controls only: no icons, no sliders that are hard to hit on a
 * small screen, no animation of its own. Every control is at least 48dp.
 */
export function ReaderSettingsSheet({ visible, onClose, labels }: ReaderSettingsSheetProps) {
  const { colors } = useTheme();
  const settings = useSettingsStore(selectSettings);
  const setSetting = useSettingsStore((state) => state.setSetting);

  const { fontSize, lineHeight, fontFamily, showVerseNumbers, theme } = settings;

  const previewStyle = useMemo(
    () => readerTypography(fontSize, lineHeight, fontFamily).verse,
    [fontSize, lineHeight, fontFamily],
  );

  const sizeAtMin = fontSize <= READER.minFont;
  const sizeAtMax = fontSize >= READER.maxFont;
  const spacingAtMin = lineHeight <= READER.minLineHeight;
  const spacingAtMax = lineHeight >= READER.maxLineHeight;

  return (
    <Sheet visible={visible} onClose={onClose} title={labels.title} closeLabel={labels.close}>
      <View style={styles.preview} importantForAccessibility="no-hide-descendants">
        <RNText
          style={[previewStyle, { color: colors.text }]}
          maxFontSizeMultiplier={maxUiFontScale}
        >
          {labels.preview}
        </RNText>
      </View>
      <Divider />

      <Stepper
        title={labels.textSize}
        value={String(fontSize)}
        decreaseLabel={labels.smaller}
        increaseLabel={labels.larger}
        decreaseDisabled={sizeAtMin}
        increaseDisabled={sizeAtMax}
        onDecrease={() => setSetting('fontSize', clampFontSize(fontSize - READER.fontStep))}
        onIncrease={() => setSetting('fontSize', clampFontSize(fontSize + READER.fontStep))}
      />
      <Divider />

      <Stepper
        title={labels.lineSpacing}
        value={lineHeight.toFixed(1)}
        decreaseLabel={labels.tighter}
        increaseLabel={labels.looser}
        decreaseDisabled={spacingAtMin}
        increaseDisabled={spacingAtMax}
        onDecrease={() => setSetting('lineHeight', clampLineHeight(lineHeight - 0.1))}
        onIncrease={() => setSetting('lineHeight', clampLineHeight(lineHeight + 0.1))}
      />
      <Divider />

      <View style={styles.group}>
        <Text variant="label" tone="muted" style={styles.groupTitle}>
          {labels.typeface}
        </Text>
        <View style={styles.choices} accessibilityRole="radiogroup">
          {FONT_CHOICES.map((choice) => (
            <Choice
              key={choice}
              label={choice === 'serif' ? labels.serif : labels.sans}
              selected={fontFamily === choice}
              onPress={() => setSetting('fontFamily', choice)}
            />
          ))}
        </View>
      </View>
      <Divider />

      <Pressable
        onPress={() => setSetting('showVerseNumbers', !showVerseNumbers)}
        accessibilityRole="switch"
        accessibilityLabel={labels.verseNumbers}
        accessibilityState={{ checked: showVerseNumbers }}
        style={({ pressed }) => [
          styles.toggle,
          pressed ? { backgroundColor: colors.selection } : null,
        ]}
      >
        <Text variant="body" style={styles.toggleTitle} importantForAccessibility="no">
          {labels.verseNumbers}
        </Text>
        <Text variant="label" tone="accent" style={styles.bold} importantForAccessibility="no">
          {showVerseNumbers ? labels.on : labels.off}
        </Text>
      </Pressable>
      <Divider />

      <View style={styles.group}>
        <Text variant="label" tone="muted" style={styles.groupTitle}>
          {labels.theme}
        </Text>
        <View style={[styles.choices, styles.wrap]} accessibilityRole="radiogroup">
          {THEME_NAMES.map((name) => (
            <Choice
              key={name}
              label={labels.themeName(name)}
              selected={theme === name}
              onPress={() => setSetting('theme', name)}
            />
          ))}
        </View>
      </View>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ */
/* Pieces used only here                                               */
/* ------------------------------------------------------------------ */

interface StepperProps {
  title: string;
  /** The current value as shown, for example "18" or "1.5". */
  value: string;
  decreaseLabel: string;
  increaseLabel: string;
  decreaseDisabled: boolean;
  increaseDisabled: boolean;
  onDecrease: () => void;
  onIncrease: () => void;
}

/** A title with the current value, and minus and plus buttons. */
function Stepper({
  title,
  value,
  decreaseLabel,
  increaseLabel,
  decreaseDisabled,
  increaseDisabled,
  onDecrease,
  onIncrease,
}: StepperProps) {
  const { colors } = useTheme();

  return (
    <View style={styles.stepper}>
      <View style={styles.stepperText}>
        <Text variant="body">{title}</Text>
        <Text variant="label" tone="muted" accessibilityLiveRegion="polite">
          {value}
        </Text>
      </View>

      <StepButton
        symbol={'−'}
        label={`${decreaseLabel}. ${title} ${value}`}
        disabled={decreaseDisabled}
        onPress={onDecrease}
        pressedColor={colors.selection}
      />
      <StepButton
        symbol="+"
        label={`${increaseLabel}. ${title} ${value}`}
        disabled={increaseDisabled}
        onPress={onIncrease}
        pressedColor={colors.selection}
      />
    </View>
  );
}

interface StepButtonProps {
  symbol: string;
  label: string;
  disabled: boolean;
  onPress: () => void;
  pressedColor: string;
}

function StepButton({ symbol, label, disabled, onPress, pressedColor }: StepButtonProps) {
  const { colors } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.stepButton,
        { borderColor: colors.divider },
        pressed && !disabled ? { backgroundColor: pressedColor } : null,
        disabled ? styles.disabled : null,
      ]}
    >
      <Text variant="title" tone="accent" importantForAccessibility="no">
        {symbol}
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
          borderWidth: selected ? 2 : 1,
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
  preview: {
    paddingBottom: space.md,
  },
  group: {
    paddingVertical: space.md,
  },
  groupTitle: {
    marginBottom: space.sm,
  },
  choices: {
    flexDirection: 'row',
    gap: space.sm,
  },
  wrap: {
    flexWrap: 'wrap',
  },
  choice: {
    minHeight: A11Y.minTouchTarget,
    minWidth: A11Y.minTouchTarget,
    paddingHorizontal: space.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: space.sm,
    gap: space.sm,
  },
  stepperText: {
    flex: 1,
  },
  stepButton: {
    width: A11Y.minTouchTarget,
    height: A11Y.minTouchTarget,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: A11Y.minTouchTarget,
    paddingVertical: space.sm,
  },
  toggleTitle: {
    flex: 1,
  },
  bold: {
    fontWeight: '600',
  },
  disabled: {
    opacity: 0.35,
  },
});
