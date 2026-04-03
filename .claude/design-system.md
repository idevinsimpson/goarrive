# GoArrive Design System

## Brand Colors
The GoArrive design system uses a dark-themed palette that conveys professionalism and premium quality.

| Token | Hex Code | Usage |
|---|---|---|
| **Primary CTA** | `#7BA05B` (sage green) | Primary action buttons, positive states, the "GO" in the wordmark. |
| **Link/Active** | `#7BA7D4` (steel blue) | Links, active tab indicators, the "ARRIVE" in the wordmark. |
| **Accent/Highlight** | `#F5A623` (gold) | Highlights, active tab bar icons, important callouts, the underline sweep. |
| **Dark Background** | `#0F1117` | Main app background, root layout background. |
| **Surface/Card** | `#1A1D27` | Card backgrounds, elevated surfaces, modals. |
| **Primary Text** | `#E8EAF0` | Main body text, headings. |
| **Muted Text** | `#7A7F94` | Secondary text, placeholders, disabled states. |
| **Tab Bar Background** | `#0E1117` | Bottom tab bar background. |
| **Tab Bar Border** | `#1E2A3A` | Top border of the tab bar. |
| **Inactive Tab** | `#4A5568` | Inactive tab bar icon color. |

## Typography
The app uses Google Fonts for web and system fonts for native platforms. The primary fonts are Space Grotesk and DM Sans, loaded via the PWA injection script for web.

## Layout Conventions
The app uses a fixed bottom tab bar with safe-area handling for PWA, iOS, and Android. On web, the tab bar uses CSS `env(safe-area-inset-bottom)` for notch-aware bottom padding. The tab bar height is 84px on iOS (with 24px bottom padding for the home indicator), 68px on Android and web.

The root layout wraps the entire app in `GestureHandlerRootView` (required for `react-native-draggable-flatlist`) and `AuthProvider`. The status bar style is set to "light" to match the dark theme.

## Component Patterns
The app uses a custom `Icon` component (`components/Icon.tsx`) for consistent iconography across the platform. Icons support filled and outlined variants for active and inactive states (e.g., `dashboard` vs `dashboard-filled`).

Confirmation dialogs use the `ConfirmDialog` component for consistent styling and behavior. Error boundaries are implemented via the `ErrorBoundary` component to catch and display errors gracefully.

## UX Principles
The coach-facing UX follows a Command Center philosophy, surfacing what needs action today, who needs attention, what is coming next, and what is at risk. It uses progressive disclosure, presenting high-signal information first and allowing drill-down second.

The member-facing UX prioritizes clarity and support. Members should always know what to do next, when to do it, and how to start quickly. The interface avoids invasive or high-maintenance patterns, minimizes data entry, and never exposes backend jargon.

Reminders should help, not harass. Accountability features must be clear, transparent, and never feel manipulative. Post-workout reflection uses the Glow/Grow journaling pattern, which keeps reflection short, personal, and actionable.
