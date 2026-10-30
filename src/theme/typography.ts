import { Platform, type TextStyle } from 'react-native';

import { READER } from '../constants/config';
import type { FontFamilyChoice } from '../types';
import { uiFontSize } from './tokens';

/**
 * Bundled reading font (3 files max, SIL OFL). The names are the file names
 * without extension, as registered by the expo-font config plugin in app.json.
 */
export const READING_FONT = {
  regular: 'Literata-Regular',
  italic: 'Literata-Italic',
  bold: 'Literata-Bold',
} as const;

/** UI font is the system font: zero extra bytes. */
export const UI_FONT: string | undefined = Platform.select({
  android: 'sans-serif',
  default: undefined,
});

export type UiVariant = 'display' | 'title' | 'body' | 'label' | 'caption';

const UI_LINE_HEIGHT = 1.35;

export function uiTextStyle(variant: UiVariant): TextStyle {
  const fontSize = uiFontSize[variant];
  const bold = variant === 'display' || variant === 'title';
  return {
    fontFamily: UI_FONT,
    fontSize,
    lineHeight: Math.round(fontSize * UI_LINE_HEIGHT),
    fontWeight: bold ? '600' : '400',
  };
}

/** Clamp and snap a stored font size to the allowed 14..30 step-2 scale. */
export function clampFontSize(size: number): number {
  const clamped = Math.min(READER.maxFont, Math.max(READER.minFont, size));
  const steps = Math.round((clamped - READER.minFont) / READER.fontStep);
  return READER.minFont + steps * READER.fontStep;
}

/** Clamp line height to 1.3..1.9 in steps of 0.1. */
export function clampLineHeight(value: number): number {
  const clamped = Math.min(READER.maxLineHeight, Math.max(READER.minLineHeight, value));
  return Math.round(clamped * 10) / 10;
}

export interface ReaderTypography {
  /** Verse body text. */
  verse: TextStyle;
  verseItalic: TextStyle;
  verseBold: TextStyle;
  /** Small muted verse number shown before the verse text. */
  verseNumber: TextStyle;
  /** Chapter / section heading inside the reader. */
  heading: TextStyle;
}

function familyFor(choice: FontFamilyChoice, style: 'regular' | 'italic' | 'bold'): TextStyle {
  if (choice === 'serif') {
    return { fontFamily: READING_FONT[style] };
  }
  return {
    fontFamily: UI_FONT,
    fontStyle: style === 'italic' ? 'italic' : 'normal',
    fontWeight: style === 'bold' ? '700' : '400',
  };
}

/**
 * Reader text styles from the user's settings. React Native cannot raise a
 * nested Text above the baseline on Android, so the "superscript" verse number
 * is a smaller, muted numeral set inline (color is applied by the component).
 */
export function readerTypography(
  fontSize: number,
  lineHeight: number,
  family: FontFamilyChoice,
): ReaderTypography {
  const size = clampFontSize(fontSize);
  const lh = clampLineHeight(lineHeight);
  const base: TextStyle = { fontSize: size, lineHeight: Math.round(size * lh) };
  const numberSize = Math.max(10, Math.round(size * 0.6));

  return {
    verse: { ...base, ...familyFor(family, 'regular') },
    verseItalic: { ...base, ...familyFor(family, 'italic') },
    verseBold: { ...base, ...familyFor(family, 'bold') },
    verseNumber: {
      fontFamily: UI_FONT,
      fontSize: numberSize,
      lineHeight: Math.round(size * lh),
      fontWeight: '400',
    },
    heading: {
      ...familyFor(family, 'bold'),
      fontSize: Math.round(size * 1.25),
      lineHeight: Math.round(size * 1.25 * 1.3),
    },
  };
}
