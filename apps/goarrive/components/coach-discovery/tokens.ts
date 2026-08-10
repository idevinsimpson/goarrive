import { BLUE, BORDER, CARD, CARD2, FB, FG, FH, GOLD, GREEN, MUTED } from '../../lib/theme';
import type { DiscoveryAccent } from '../../data/coachDiscoveryScenes';

export const discoveryColors = {
  background: '#080B12',
  backgroundAlt: '#0E1422',
  surface: CARD,
  surfaceElevated: CARD2,
  border: BORDER,
  borderSoft: 'rgba(255,255,255,0.08)',
  text: FG,
  textSoft: '#A8B2C3',
  muted: MUTED,
  blue: BLUE,
  blueSoft: 'rgba(91,155,213,0.18)',
  blueGlow: 'rgba(91,155,213,0.28)',
  green: GREEN,
  greenSoft: 'rgba(110,187,122,0.16)',
  greenGlow: 'rgba(110,187,122,0.26)',
  gold: GOLD,
  goldSoft: 'rgba(245,166,35,0.14)',
  goldGlow: 'rgba(245,166,35,0.24)',
  white: '#FFFFFF',
  black: '#000000',
};

export const discoveryFonts = {
  heading: FH,
  body: FB,
};

export function accentColor(accent: DiscoveryAccent) {
  if (accent === 'blue') return discoveryColors.blue;
  if (accent === 'green') return discoveryColors.green;
  if (accent === 'gold') return discoveryColors.gold;
  return discoveryColors.textSoft;
}
export function accentSoft(accent: DiscoveryAccent) {
  if (accent === 'blue') return discoveryColors.blueSoft;
  if (accent === 'green') return discoveryColors.greenSoft;
  if (accent === 'gold') return discoveryColors.goldSoft;
  return 'rgba(255,255,255,0.06)';
}
