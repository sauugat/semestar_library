import { useColorScheme } from '@/components/useColorScheme';
import { Colors, Spacing, Typography, Radii, Shadows } from './theme';

export function useTheme() {
  // Dark mode is primary/default (matching the website's dark-mode-first aesthetic)
  const scheme = useColorScheme() ?? 'dark';
  const colors = scheme === 'light' ? Colors.light : Colors.dark;
  const isDark = scheme !== 'light';

  return {
    colors,
    isDark,
    spacing: Spacing,
    typography: Typography,
    radii: Radii,
    shadows: Shadows,
  };
}
