/**
 * Shared theme constants — colors, fonts, and layout tokens.
 *
 * Import from here instead of redeclaring in each component file.
 * Values match the established component palette used across the app.
 */
import { Platform } from 'react-native';

// ── Colors ──────────────────────────────────────────────────────────────────
export const BG = '#0E1117';
export const CARD = '#111827';
export const CARD2 = '#151B28';
export const BORDER = '#1E2A3A';
export const MUTED = '#8A95A3';
export const GOLD = '#F5A623';
export const GREEN = '#6EBB7A';
export const BLUE = '#5B9BD5';
export const RED = '#E05252';
export const FG = '#F0F4F8';

// ── Fonts ───────────────────────────────────────────────────────────────────
export const FH = Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'SpaceGrotesk-Bold';
export const FB = Platform.OS === 'web' ? "'DM Sans', sans-serif" : 'DMSans-Regular';
