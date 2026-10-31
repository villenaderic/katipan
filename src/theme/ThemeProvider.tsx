import * as SystemUI from 'expo-system-ui';
import { StatusBar } from 'expo-status-bar';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { AccessibilityInfo } from 'react-native';

import type { ThemeName } from '../types';
import { getTheme, type Theme, type ThemeColors } from './themes';
import { motion } from './tokens';

export interface ThemeContextValue {
  theme: Theme;
  colors: ThemeColors;
  /** Lite mode: no animations, no shadows. */
  liteMode: boolean;
  /** False in Lite mode or when the system "reduce motion" is on. */
  animationsEnabled: boolean;
  /** Fade duration in ms; 0 when animations are disabled. */
  fadeMs: number;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

interface ThemeProviderProps {
  themeName: ThemeName;
  highContrast: boolean;
  liteMode: boolean;
  children: ReactNode;
}

export function ThemeProvider({
  themeName,
  highContrast,
  liteMode,
  children,
}: ThemeProviderProps) {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (active) setReduceMotion(enabled);
      })
      .catch(() => {
        // Keep the default (motion allowed) if the query fails.
      });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      active = false;
      sub.remove();
    };
  }, []);

  const theme = useMemo(() => getTheme(themeName, highContrast), [themeName, highContrast]);

  useEffect(() => {
    SystemUI.setBackgroundColorAsync(theme.colors.background).catch(() => {
      // Cosmetic only; ignore failures.
    });
  }, [theme.colors.background]);

  const value = useMemo<ThemeContextValue>(() => {
    const animationsEnabled = !liteMode && !reduceMotion;
    return {
      theme,
      colors: theme.colors,
      liteMode,
      animationsEnabled,
      fadeMs: animationsEnabled ? motion.fadeMs : 0,
    };
  }, [theme, liteMode, reduceMotion]);

  return (
    <ThemeContext.Provider value={value}>
      <StatusBar style={theme.isDark ? 'light' : 'dark'} />
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used inside <ThemeProvider>');
  }
  return ctx;
}
