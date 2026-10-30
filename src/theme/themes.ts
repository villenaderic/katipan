import type { HighlightColor, ThemeName } from '../types';

export interface ThemeColors {
  background: string;
  text: string;
  muted: string;
  accent: string;
  /** Text on a filled accent surface. */
  onAccent: string;
  divider: string;
  /** Bottom sheet and action bar surface. */
  sheet: string;
  /** Verse selection tint (drawn over the background). */
  selection: string;
  /** Words of Christ, only used when the red-letter setting is on. */
  redLetter: string;
  danger: string;
  highlight: Record<HighlightColor, string>;
}

export interface Theme {
  name: ThemeName;
  isDark: boolean;
  colors: ThemeColors;
}

export const HIGHLIGHT_COLORS: readonly HighlightColor[] = [
  'yellow',
  'green',
  'blue',
  'pink',
  'orange',
];

const light: ThemeColors = {
  background: '#FAF8F4',
  text: '#1B1A17',
  muted: '#6B675F',
  accent: '#8A5A2B',
  onAccent: '#FFFFFF',
  divider: '#E3DED4',
  sheet: '#F2EFE8',
  selection: '#8A5A2B26',
  redLetter: '#A32020',
  danger: '#A32020',
  highlight: {
    yellow: '#F6E27A',
    green: '#BFE3B0',
    blue: '#B5D5F2',
    pink: '#F2BFD3',
    orange: '#F5C99B',
  },
};

const sepia: ThemeColors = {
  background: '#F1E7D0',
  text: '#3B2F1E',
  muted: '#6A5A40',
  accent: '#7A4A1E',
  onAccent: '#FFFFFF',
  divider: '#DACDAD',
  sheet: '#E9DDC2',
  selection: '#7A4A1E2B',
  redLetter: '#8E2A1A',
  danger: '#8E2A1A',
  highlight: {
    yellow: '#EBD56B',
    green: '#B9D6A3',
    blue: '#A9C8E0',
    pink: '#E6B5C4',
    orange: '#EDBE8A',
  },
};

const dark: ThemeColors = {
  background: '#16171A',
  text: '#E6E3DC',
  muted: '#9B978E',
  accent: '#D1A671',
  onAccent: '#16171A',
  divider: '#2C2D32',
  sheet: '#202125',
  selection: '#D1A67133',
  redLetter: '#EE8F85',
  danger: '#EE8F85',
  highlight: {
    yellow: '#5E5113',
    green: '#25502C',
    blue: '#21406A',
    pink: '#5E2C45',
    orange: '#633C16',
  },
};

const black: ThemeColors = {
  background: '#000000',
  text: '#D9D6CF',
  muted: '#928F88',
  accent: '#C99A5B',
  onAccent: '#000000',
  divider: '#242424',
  sheet: '#0D0D0D',
  selection: '#C99A5B33',
  redLetter: '#EE8F85',
  danger: '#EE8F85',
  highlight: {
    yellow: '#554A10',
    green: '#204726',
    blue: '#1C3A60',
    pink: '#552840',
    orange: '#5B3713',
  },
};

export const THEMES: Readonly<Record<ThemeName, Theme>> = {
  light: { name: 'light', isDark: false, colors: light },
  sepia: { name: 'sepia', isDark: false, colors: sepia },
  dark: { name: 'dark', isDark: true, colors: dark },
  black: { name: 'black', isDark: true, colors: black },
};

export const THEME_NAMES: readonly ThemeName[] = ['light', 'sepia', 'dark', 'black'];

/**
 * High-contrast variant: pure text and muted-as-text, a stronger accent and
 * divider, so everything clears WCAG AAA (7:1) on its background.
 */
export function withHighContrast(theme: Theme): Theme {
  const c = theme.colors;
  const dk = theme.isDark;
  return {
    ...theme,
    colors: {
      ...c,
      text: dk ? '#FFFFFF' : '#000000',
      muted: dk ? '#E0DDD6' : '#2E2B26',
      accent: dk ? '#F0C48A' : '#5E3813',
      onAccent: dk ? '#000000' : '#FFFFFF',
      divider: dk ? '#6A6A6A' : '#6A6A6A',
      redLetter: dk ? '#FFB3AA' : '#7A0F0F',
      danger: dk ? '#FFB3AA' : '#7A0F0F',
    },
  };
}

export function getTheme(name: ThemeName, highContrast: boolean): Theme {
  const base = THEMES[name];
  return highContrast ? withHighContrast(base) : base;
}
