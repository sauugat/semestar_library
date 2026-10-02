import React, { createContext, useContext, useState, useEffect } from 'react';
import { useColorScheme as useDeviceColorScheme, Appearance } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Colors, Spacing, Typography, Radii, Shadows, TouchTarget, IconSizes } from '@/constants/theme';

export type ThemeMode = 'system' | 'light' | 'dark';

interface ThemeContextType {
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => Promise<void>;
  isDark: boolean;
  colors: typeof Colors.dark;
  spacing: typeof Spacing;
  typography: typeof Typography;
  radii: typeof Radii;
  shadows: typeof Shadows;
  touchTarget: typeof TouchTarget;
  iconSizes: typeof IconSizes;
}

const THEME_STORAGE_KEY = '@semester_library_theme_mode';

const ThemeContext = createContext<ThemeContextType>({
  themeMode: 'system',
  setThemeMode: async () => {},
  isDark: true,
  colors: Colors.dark,
  spacing: Spacing,
  typography: Typography,
  radii: Radii,
  shadows: Shadows,
  touchTarget: TouchTarget,
  iconSizes: IconSizes,
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const deviceScheme = useDeviceColorScheme() ?? 'dark';
  const [themeMode, setThemeModeState] = useState<ThemeMode>('system');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const saved = await AsyncStorage.getItem(THEME_STORAGE_KEY);
        if (saved === 'system' || saved === 'light' || saved === 'dark') {
          setThemeModeState(saved);
        }
      } catch (err) {
        console.warn('Failed to load theme preference:', err);
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  const setThemeMode = async (mode: ThemeMode) => {
    setThemeModeState(mode);
    try {
      await AsyncStorage.setItem(THEME_STORAGE_KEY, mode);
    } catch (err) {
      console.warn('Failed to save theme preference:', err);
    }
  };

  const activeScheme = themeMode === 'system' ? (deviceScheme === 'light' ? 'light' : 'dark') : themeMode;
  const isDark = activeScheme === 'dark';
  const colors = isDark ? Colors.dark : Colors.light;

  return (
    <ThemeContext.Provider
      value={{
        themeMode,
        setThemeMode,
        isDark,
        colors,
        spacing: Spacing,
        typography: Typography,
        radii: Radii,
        shadows: Shadows,
        touchTarget: TouchTarget,
        iconSizes: IconSizes,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  return ctx;
}
