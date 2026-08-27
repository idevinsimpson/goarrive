export const wsfTheme = {
  colors: {
    background: '#F7F5F0',
    surface: '#FFFFFF',
    primary: '#0B1F3A',
    accent: '#E8B547',
    text: '#0B1F3A',
    textMuted: '#5A6B85',
    border: '#E5E1D8',
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
    xxl: 48,
  },
  radius: {
    sm: 6,
    md: 12,
    lg: 24,
    pill: 999,
  },
  typography: {
    heading: {
      fontSize: 28,
      fontWeight: '700' as const,
      lineHeight: 34,
    },
    subheading: {
      fontSize: 18,
      fontWeight: '600' as const,
      lineHeight: 24,
    },
    body: {
      fontSize: 16,
      fontWeight: '400' as const,
      lineHeight: 22,
    },
    caption: {
      fontSize: 13,
      fontWeight: '400' as const,
      lineHeight: 18,
    },
  },
} as const;

export type WsfTheme = typeof wsfTheme;
