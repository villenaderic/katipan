import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text as RNText, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Divider } from '@/components/ui/Divider';
import { Text } from '@/components/ui/Text';
import { A11Y, READER } from '@/constants/config';
import { UI_LANGUAGES } from '@/constants/languages';
import { useI18n } from '@/i18n';
import { selectSettings, useSettingsStore } from '@/store/settingsStore';
import { useTheme } from '@/theme/ThemeProvider';
import { THEME_NAMES } from '@/theme/themes';
import { hairline, maxUiFontScale, space } from '@/theme/tokens';
import { clampFontSize, clampLineHeight, readerTypography } from '@/theme/typography';
import type { FontFamilyChoice, ThemeName } from '@/types';
import { formatLineHeight } from '@/utils/format';

/**
 * Appearance: route /appearance, opened from the More tab. The navigator
 * draws the header (see app/_layout.tsx).
 *
 * Everything that changes how the app looks, in one scroll:
 *  - Language of the interface (English or Filipino).
 *  - Theme: light, sepia, dark, true black, and a high-contrast switch.
 *  - Reading: a preview line in the current style, text size 14 to 30 in
 *    steps of 2, line spacing 1.3 to 1.9, serif or sans, verse numbers.
 *  - Display: Lite mode (no animations, no shadows) and reading focus mode
 *    (the reader hides its bars after 2 seconds without a touch).
 *
 * It reads and writes settingsStore directly. The root layout watches the
 * theme, high-contrast and Lite settings, so a change shows at once on this
 * screen and everywhere else. The reader's "Aa" sheet covers the reading
 * part of this screen, so both stay in step through the same store.
 *
 * Plain text controls only: no sliders, no icons, every control at least
 * 48dp. Every string comes from i18n.
 */

const FONT_CHOICES: readonly FontFamilyChoice[] = ['serif', 'sans'];

export default function AppearanceScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useI18n();
  const settings = useSettingsStore(selectSettings);
  const setSetting = useSettingsStore((state) => state.setSetting);

  const {
    uiLanguage,
    theme,
    highContrast,
    fontSize,
    lineHeight,
    fontFamily,
    showVerseNumbers,
    liteMode,
    focusMode,
  } = settings;

  const previewStyle = useMemo(
    () => readerTypography(fontSize, lineHeight, fontFamily).verse,
    [fontSize, lineHeight, fontFamily],
  );

  const themeLabel = (name: ThemeName): string => t(`appearance.theme.${name}`);

  const sizeAtMin = fontSize <= READER.minFont;
  const sizeAtMax = fontSize >= READER.maxFont;
  const spacingAtMin = lineHeight <= READER.minLineHeight;
  const spacingAtMax = lineHeight >= READER.maxLineHeight;
  const spacingText = formatLineHeight(lineHeight);

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space.xxxl }]}
      >
        {/* ---------------- Language ---------------- */}
        <SectionTitle label={t('appearance.language')} />
        <Divider />
        <View style={styles.group}>
          <View style={styles.choices} accessibilityRole="radiogroup">
            {UI_LANGUAGES.map((language) => (
              <Choice
                key={language.code}
                label={language.nativeName}
                selected={uiLanguage === language.code}
                onPress={() => setSetting('uiLanguage', language.code)}
              />
            ))}
          </View>
        </View>

        {/* ---------------- Theme ---------------- */}
        <SectionTitle label={t('appearance.themeTitle')} />
        <Divider />
        <View style={styles.group}>
          <View style={[styles.choices, styles.wrap]} accessibilityRole="radiogroup">
            {THEME_NAMES.map((name) => (
              <Choice
                key={name}
                label={themeLabel(name)}
                selected={theme === name}
                onPress={() => setSetting('theme', name)}
              />
            ))}
          </View>
        </View>
        <Divider />
        <ToggleRow
          title={t('appearance.highContrast')}
          hint={t('appearance.highContrastHint')}
          value={highContrast}
          onLabel={t('common.on')}
          offLabel={t('common.off')}
          onToggle={() => setSetting('highContrast', !highContrast)}
        />

        {/* ---------------- Reading ---------------- */}
        <SectionTitle label={t('appearance.reading')} />
        <Divider />
        <View style={styles.preview} importantForAccessibility="no-hide-descendants">
          <RNText
            style={[previewStyle, { color: colors.text }]}
            maxFontSizeMultiplier={maxUiFontScale}
          >
            {t('appearance.preview')}
          </RNText>
        </View>
        <Divider />

        <Stepper
          title={t('appearance.textSize')}
          value={String(fontSize)}
          decreaseLabel={t('appearance.smaller')}
          increaseLabel={t('appearance.larger')}
          decreaseDisabled={sizeAtMin}
          increaseDisabled={sizeAtMax}
          onDecrease={() => setSetting('fontSize', clampFontSize(fontSize - READER.fontStep))}
          onIncrease={() => setSetting('fontSize', clampFontSize(fontSize + READER.fontStep))}
        />
        <Divider />
        <Stepper
          title={t('appearance.lineSpacing')}
          value={spacingText}
          decreaseLabel={t('appearance.tighter')}
          increaseLabel={t('appearance.looser')}
          decreaseDisabled={spacingAtMin}
          increaseDisabled={spacingAtMax}
          onDecrease={() => setSetting('lineHeight', clampLineHeight(lineHeight - 0.1))}
          onIncrease={() => setSetting('lineHeight', clampLineHeight(lineHeight + 0.1))}
        />
        <Divider />

        <View style={styles.group}>
          <Text variant="label" tone="muted" style={styles.groupTitle}>
            {t('appearance.typeface')}
          </Text>
          <View style={styles.choices} accessibilityRole="radiogroup">
            {FONT_CHOICES.map((choice) => (
              <Choice
                key={choice}
                label={choice === 'serif' ? t('appearance.serif') : t('appearance.sans')}
                selected={fontFamily === choice}
                onPress={() => setSetting('fontFamily', choice)}
              />
            ))}
          </View>
        </View>
        <Divider />
        <ToggleRow
          title={t('appearance.verseNumbers')}
          value={showVerseNumbers}
          onLabel={t('common.on')}
          offLabel={t('common.off')}
          onToggle={() => setSetting('showVerseNumbers', !showVerseNumbers)}
        />

        {/* ---------------- Display ---------------- */}
        <SectionTitle label={t('appearance.display')} />
        <Divider />
        <ToggleRow
          title={t('appearance.liteMode')}
          hint={t('appearance.liteModeHint')}
          value={liteMode}
          onLabel={t('common.on')}
          offLabel={t('common.off')}
          onToggle={() => setSetting('liteMode', !liteMode)}
        />
        <Divider />
        <ToggleRow
          title={t('appearance.focusMode')}
          hint={t('appearance.focusModeHint')}
          value={focusMode}
          onLabel={t('common.on')}
          offLabel={t('common.off')}
          onToggle={() => setSetting('focusMode', !focusMode)}
        />
      </ScrollView>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Pieces used only here                                               */
/* ------------------------------------------------------------------ */

function SectionTitle({ label }: { label: string }) {
  return (
    <Text variant="label" tone="muted" accessibilityRole="header" style={styles.section}>
      {label}
    </Text>
  );
}

interface ToggleRowProps {
  title: string;
  /** Optional muted line under the title that says what the switch does. */
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
          <Text variant="caption" tone="muted" style={styles.toggleHint} importantForAccessibility="no">
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
  return (
    <View style={styles.stepper}>
      <View style={styles.stepperText}>
        <Text variant="body">{title}</Text>
        <Text variant="label" tone="muted" accessibilityLiveRegion="polite">
          {value}
        </Text>
      </View>
      <StepButton
        symbol={'\u2212'}
        label={`${decreaseLabel}. ${title} ${value}`}
        disabled={decreaseDisabled}
        onPress={onDecrease}
      />
      <StepButton
        symbol="+"
        label={`${increaseLabel}. ${title} ${value}`}
        disabled={increaseDisabled}
        onPress={onIncrease}
      />
    </View>
  );
}

interface StepButtonProps {
  symbol: string;
  label: string;
  disabled: boolean;
  onPress: () => void;
}

function StepButton({ symbol, label, disabled, onPress }: StepButtonProps) {
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
        pressed && !disabled ? { backgroundColor: colors.selection } : null,
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
  group: {
    paddingHorizontal: space.xl,
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
  preview: {
    paddingHorizontal: space.xl,
    paddingVertical: space.md,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.xl,
    paddingVertical: space.sm,
    gap: space.sm,
  },
  stepperText: {
    flex: 1,
  },
  stepButton: {
    width: A11Y.minTouchTarget,
    height: A11Y.minTouchTarget,
    borderWidth: hairline,
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
  toggleHint: {
    marginTop: space.xs,
  },
  bold: {
    fontWeight: '600',
  },
  disabled: {
    opacity: 0.35,
  },
});
