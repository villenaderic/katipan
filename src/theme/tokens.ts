import { SPACING } from '../constants/config';

/** Spacing scale: 4, 8, 12, 16, 24, 32, 48 (design system, Section 6). */
export const space = {
  xs: SPACING[0],
  sm: SPACING[1],
  md: SPACING[2],
  lg: SPACING[3],
  xl: SPACING[4],
  xxl: SPACING[5],
  xxxl: SPACING[6],
} as const;

/** Almost everything is square. Radius exists only for focus rings and the sheet. */
export const radius = {
  none: 0,
  sm: 4,
  sheet: 12,
} as const;

/** Simple fades only, under 150 ms. Disabled in Lite mode or with system reduce motion. */
export const motion = {
  fadeMs: 120,
} as const;

/** Hairline divider thickness. */
export const hairline = 1;

/** UI (non-reader) text sizes. The reader size comes from user settings. */
export const uiFontSize = {
  caption: 13,
  label: 15,
  body: 17,
  title: 22,
  display: 28,
} as const;

/** UI text stops growing with the system font scale beyond this multiple. */
export const maxUiFontScale = 1.6;
