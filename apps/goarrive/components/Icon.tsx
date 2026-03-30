/**
 * Icon.tsx — Universal inline SVG icon system for GoArrive
 *
 * Replaces @expo/vector-icons (Ionicons) which fails to load its icon font
 * on iOS PWA / Safari. All icons are inline SVG paths — zero font loading,
 * works on every platform including iOS Safari PWA.
 *
 * Usage:
 *   <Icon name="dashboard" size={22} color="#F5A623" />
 */
import React from 'react';
import { Platform } from 'react-native';

// On web/PWA we render native SVG. On native we use react-native-svg if available,
// otherwise fall back to a Text placeholder (shouldn't happen in our web-only build).
let SvgComponent: any;
let PathComponent: any;

if (Platform.OS === 'web') {
  // Use HTML SVG elements directly via react-native-web's View/Text bridge
  SvgComponent = (props: any) => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={props.size ?? 24}
      height={props.size ?? 24}
      fill="none"
      stroke={props.stroke ?? props.color ?? 'currentColor'}
      strokeWidth={props.strokeWidth ?? 2}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: 'block', flexShrink: 0 }}
    >
      {props.children}
    </svg>
  );
  PathComponent = (props: any) => <path {...props} />;
} else {
  // Native — try react-native-svg, else render nothing
  try {
    const RNSVG = require('react-native-svg');
    SvgComponent = RNSVG.Svg;
    PathComponent = RNSVG.Path;
  } catch {
    SvgComponent = () => null;
    PathComponent = () => null;
  }
}

// ─── Icon definitions ──────────────────────────────────────────────────────────
// Each icon is a tuple: [strokePaths[], fillPaths[], strokeWidth]
// strokePaths: drawn with stroke (outline style)
// fillPaths: drawn with fill (solid style)

type IconDef = {
  paths?: string[];
  fill?: string[];
  sw?: number; // strokeWidth override
};

const ICONS: Record<string, IconDef> = {
  // Navigation
  dashboard: {
    paths: [
      'M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z',
      'M9 22V12h6v10',
    ],
  },
  'dashboard-filled': {
    paths: [],
    fill: ['M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2zM9 22V12h6v10'],
  },
  members: {
    paths: [
      'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2',
      'M23 21v-2a4 4 0 00-3-3.87',
      'M16 3.13a4 4 0 010 7.75',
    ],
    fill: ['M9 11a4 4 0 100-8 4 4 0 000 8z'],
  },
  workouts: {
    paths: [
      'M6.5 6.5h11',
      'M17.5 6.5v11',
      'M6.5 17.5h11',
      'M6.5 6.5v11',
    ],
    fill: [
      'M4 6.5a2.5 2.5 0 105 0 2.5 2.5 0 00-5 0z',
      'M15 6.5a2.5 2.5 0 105 0 2.5 2.5 0 00-5 0z',
      'M4 17.5a2.5 2.5 0 105 0 2.5 2.5 0 00-5 0z',
      'M15 17.5a2.5 2.5 0 105 0 2.5 2.5 0 00-5 0z',
    ],
  },
  movements: {
    paths: [
      'M13 2L3 14h9l-1 8 10-12h-9l1-8z',
    ],
  },
  build: {
    paths: [
      'M12 2L2 7l10 5 10-5-10-5z',
      'M2 17l10 5 10-5',
      'M2 12l10 5 10-5',
    ],
  },
  'build-filled': {
    paths: [
      'M12 2L2 7l10 5 10-5-10-5z',
      'M2 17l10 5 10-5',
      'M2 12l10 5 10-5',
    ],
    fill: [
      'M12 2L2 7l10 5 10-5-10-5z',
    ],
  },
  plan: {
    paths: [
      'M9 11l3 3L22 4',
      'M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11',
    ],
  },
  playbook: {
    paths: [
      'M4 19.5A2.5 2.5 0 016.5 17H20',
      'M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z',
    ],
  },
  // Actions
  add: {
    paths: ['M12 5v14', 'M5 12h14'],
    sw: 2.5,
  },
  close: {
    paths: ['M18 6L6 18', 'M6 6l12 12'],
  },
  x: {
    paths: ['M18 6L6 18', 'M6 6l12 12'],
    sw: 2.5,
  },
  search: {
    paths: ['M21 21l-4.35-4.35'],
    fill: ['M11 19a8 8 0 100-16 8 8 0 000 16z'],
  },
  trash: {
    paths: [
      'M3 6h18',
      'M8 6V4h8v2',
      'M19 6l-1 14H6L5 6',
      'M10 11v6',
      'M14 11v6',
    ],
  },
  edit: {
    paths: [
      'M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7',
      'M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z',
    ],
  },
  check: {
    paths: ['M20 6L9 17l-5-5'],
    sw: 2.5,
  },
  'check-circle': {
    paths: ['M22 11.08V12a10 10 0 11-5.93-9.14', 'M22 4L12 14.01l-3-3'],
  },
  'arrow-left': {
    paths: ['M19 12H5', 'M12 19l-7-7 7-7'],
  },
  'arrow-right': {
    paths: ['M5 12h14', 'M12 5l7 7-7 7'],
  },
  'chevron-left': {
    paths: ['M15 18l-6-6 6-6'],
  },
  'chevron-right': {
    paths: ['M9 18l6-6-6-6'],
  },
  'chevron-down': {
    paths: ['M6 9l6 6 6-6'],
  },
  // Content
  calendar: {
    paths: [
      'M8 2v4',
      'M16 2v4',
      'M3 10h18',
      'M3 6a2 2 0 012-2h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6z',
    ],
  },
  fitness: {
    paths: [
      'M18 8h1a4 4 0 010 8h-1',
      'M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8z',
      'M6 1v3',
      'M10 1v3',
      'M14 1v3',
    ],
  },
  person: {
    paths: ['M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2'],
    fill: ['M12 11a4 4 0 100-8 4 4 0 000 8z'],
  },
  mail: {
    paths: [
      'M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z',
      'M22 6l-10 7L2 6',
    ],
  },
  phone: {
    paths: [
      'M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81a19.79 19.79 0 01-3.07-8.67A2 2 0 012 .18h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 7.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z',
    ],
  },
  lock: {
    paths: [
      'M19 11H5a2 2 0 00-2 2v7a2 2 0 002 2h14a2 2 0 002-2v-7a2 2 0 00-2-2z',
      'M7 11V7a5 5 0 0110 0v4',
    ],
  },
  eye: {
    paths: ['M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z'],
    fill: ['M12 12a3 3 0 100-6 3 3 0 000 6z'],
  },
  'eye-off': {
    paths: [
      'M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94',
      'M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19',
      'M1 1l22 22',
    ],
  },
  warning: {
    paths: ['M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z', 'M12 9v4', 'M12 17h.01'],
  },
  info: {
    paths: ['M12 22a10 10 0 100-20 10 10 0 000 20z', 'M12 8h.01', 'M12 12v4'],
  },
  star: {
    paths: ['M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z'],
  },
  'star-filled': {
    paths: [],
    fill: ['M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z'],
  },
  logout: {
    paths: [
      'M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4',
      'M16 17l5-5-5-5',
      'M21 12H9',
    ],
  },
  settings: {
    paths: [
      'M12 15a3 3 0 100-6 3 3 0 000 6z',
      'M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z',
    ],
  },
  'play-circle': {
    paths: ['M22 12a10 10 0 11-20 0 10 10 0 0120 0z'],
    fill: ['M10 8l6 4-6 4V8z'],
  },
  'play': {
    paths: [],
    fill: ['M5 3l14 9-14 9V3z'],
  },
  'pause': {
    paths: [],
    fill: ['M6 19h4V5H6v14zm8-14v14h4V5h-4z'],
  },
  'skip-forward': {
    paths: [],
    fill: ['M6 18l8.5-6L6 6v12zm2-8.14L11.03 12 8 14.14V9.86zM16 6h2v12h-2z'],
  },
  'circle': {
    paths: ['M12 22a10 10 0 100-20 10 10 0 000 20z'],
  },
  'circle-filled': {
    paths: [],
    fill: ['M12 22a10 10 0 100-20 10 10 0 000 20z'],
  },
  'sort': {
    paths: ['M3 6h18', 'M6 12h12', 'M9 18h6'],
  },
  'filter': {
    paths: ['M22 3H2l8 9.46V19l4 2v-8.54L22 3z'],
  },
  'more-vertical': {
    fill: [
      'M12 13a1 1 0 100-2 1 1 0 000 2z',
      'M12 6a1 1 0 100-2 1 1 0 000 2z',
      'M12 20a1 1 0 100-2 1 1 0 000 2z',
    ],
  },
  'clock': {
    paths: ['M12 22a10 10 0 100-20 10 10 0 000 20z', 'M12 6v6l4 2'],
  },
  'activity': {
    paths: ['M22 12h-4l-3 9L9 3l-3 9H2'],
  },
  'trending-up': {
    paths: ['M23 6l-9.5 9.5-5-5L1 18', 'M17 6h6v6'],
  },
  'x-circle': {
    paths: ['M22 12a10 10 0 11-20 0 10 10 0 0120 0z', 'M15 9l-6 6', 'M9 9l6 6'],
  },
  'archive': {
    paths: [
      'M21 8v13H3V8',
      'M1 3h22v5H1z',
      'M10 12h4',
    ],
  },
  'document': {
    paths: [
      'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z',
      'M14 2v6h6',
      'M16 13H8',
      'M16 17H8',
      'M10 9H8',
    ],
  },
  'refresh': {
    paths: [
      'M23 4v6h-6',
      'M1 20v-6h6',
      'M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15',
    ],
  },
  'help-circle': {
    paths: [
      'M22 12a10 10 0 11-20 0 10 10 0 0120 0z',
      'M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3',
      'M12 17h.01',
    ],
  },
  'share': {
    paths: [
      'M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8',
      'M16 6l-4-4-4 4',
      'M12 2v13',
    ],
  },
  'arrow-back': {
    paths: ['M19 12H5', 'M12 19l-7-7 7-7'],
  },
  'link': {
    paths: [
      'M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71',
      'M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71',
    ],
  },
  'copy': {
    paths: [
      'M20 9h-9a2 2 0 00-2 2v9a2 2 0 002 2h9a2 2 0 002-2v-9a2 2 0 00-2-2z',
      'M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1',
    ],
  },
  'calendar': {
    paths: [
      'M19 4H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V6a2 2 0 00-2-2z',
      'M16 2v4', 'M8 2v4', 'M3 10h18',
    ],
  },
  'video': {
    paths: [
      'M23 7l-7 5 7 5V7z',
      'M14 5H3a2 2 0 00-2 2v10a2 2 0 002 2h11a2 2 0 002-2V7a2 2 0 00-2-2z',
    ],
  },
  'person': {
    paths: [
      'M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2',
    ],
    fill: [
      'M12 3a4 4 0 110 8 4 4 0 010-8z',
    ],
  },
  'settings': {
    paths: [
      'M12 15a3 3 0 100-6 3 3 0 000 6z',
      'M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z',
    ],
  },
  'edit': {
    paths: [
      'M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7',
      'M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z',
    ],
  },
  'search': {
    paths: [
      'M11 19a8 8 0 100-16 8 8 0 000 16z',
      'M21 21l-4.35-4.35',
    ],
  },
  'close': {
    paths: ['M18 6L6 18', 'M6 6l12 12'],
  },
  'check': {
    paths: ['M20 6L9 17l-5-5'],
  },
  'alert-circle': {
    paths: [
      'M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z',
      'M12 8v4', 'M12 16h.01',
    ],
  },
  'block': {
    paths: [
      'M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z',
      'M4.93 4.93l14.14 14.14',
    ],
  },
  'logout': {
    paths: [
      'M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4',
      'M16 17l5-5-5-5', 'M21 12H9',
    ],
  },
  'mail': {
    paths: [
      'M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z',
      'M22 6l-10 7L2 6',
    ],
  },
  'shield': {
    paths: [
      'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
    ],
  },
  'zap': {
    fill: [
      'M13 2L3 14h9l-1 8 10-12h-9l1-8z',
    ],
  },
  'repeat': {
    paths: [
      'M17 1l4 4-4 4',
      'M3 11V9a4 4 0 014-4h14',
      'M7 23l-4-4 4-4',
      'M21 13v2a4 4 0 01-4 4H3',
    ],
  },
  'maximize': {
    paths: [
      'M8 3H5a2 2 0 00-2 2v3',
      'M21 8V5a2 2 0 00-2-2h-3',
      'M16 21h3a2 2 0 002-2v-3',
      'M3 16v3a2 2 0 002 2h3',
    ],
  },
  'minimize': {
    paths: [
      'M4 14h6v6',
      'M20 10h-6V4',
      'M14 10l7-7',
      'M3 21l7-7',
    ],
  },
  'crop': {
    paths: [
      'M6.13 1L6 16a2 2 0 002 2h15',
      'M1 6.13L16 6a2 2 0 012 2v15',
    ],
  },
  'checkmark': {
    paths: ['M20 6L9 17l-5-5'],
    sw: 2.5,
  },
  'image': {
    paths: [
      'M19 3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V5a2 2 0 00-2-2z',
      'M21 15l-5-5L5 21',
    ],
    fill: ['M8.5 10a1.5 1.5 0 100-3 1.5 1.5 0 000 3z'],
  },
  'camera': {
    paths: [
      'M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z',
    ],
    fill: ['M12 17a4 4 0 100-8 4 4 0 000 8z'],
  },
  'grid': {
    paths: [
      'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
    ],
  },
  'list': {
    paths: [
      'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
    ],
  },
  'download': {
    paths: [
      'M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3',
    ],
  },
  'info': {
    paths: [
      'M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z',
      'M12 16v-4M12 8h.01',
    ],
  },
  'plus': {
    paths: [
      'M12 5v14M5 12h14',
    ],
  },
  'swap': {
    paths: [
      'M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4',
    ],
  },
  'wifi-off': {
    paths: [
      'M1 1l22 22',
      'M16.72 11.06A10.94 10.94 0 0119 12.55',
      'M5 12.55a10.94 10.94 0 015.17-2.39',
      'M10.71 5.05A16 16 0 0122.56 9',
      'M1.42 9a15.91 15.91 0 014.7-2.88',
      'M8.53 16.11a6 6 0 016.95 0',
      'M12 20h.01',
    ],
  },
};

// ─── Icon Component ────────────────────────────────────────────────────────────

interface IconProps {
  name: keyof typeof ICONS;
  size?: number;
  color?: string;
  style?: any;
}

export function Icon({ name, size = 24, color = '#F0F4F8', style }: IconProps) {
  const def = ICONS[name];
  if (!def) {
    // Unknown icon — render a small square as fallback
    return (
      <SvgComponent size={size} color={color} stroke={color}>
        <PathComponent d="M3 3h18v18H3z" />
      </SvgComponent>
    );
  }

  const sw = def.sw ?? 2;

  return (
    <SvgComponent
      size={size}
      color={color}
      stroke={color}
      strokeWidth={sw}
      style={style}
    >
      {def.paths?.map((d, i) => (
        <PathComponent key={`s${i}`} d={d} />
      ))}
      {def.fill?.map((d, i) => (
        <PathComponent
          key={`f${i}`}
          d={d}
          fill={color}
          stroke="none"
        />
      ))}
    </SvgComponent>
  );
}

export default Icon;
