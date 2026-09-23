import { StyleSheet, Text, View } from 'react-native';

import {
  CREAM,
  HAIRLINE,
  INK_QUIET,
  NAVY,
  ON_NAVY,
  ON_NAVY_MUTED,
  ON_NAVY_RULE,
  PROGRESS_GREEN,
  SURFACE,
  TEXT_MUTED,
} from './kit';

/**
 * THE SHARED SOCIAL PIECES — presence initials and the momentum list.
 *
 * Shared because Community and Members must not disagree about how a person is
 * drawn: two copies of "initials in a circle" drift, and the day one of them
 * starts rendering something for a member the callable did not name is the day
 * the privacy guarantee stops being visible in the code.
 *
 * NOT AN AVATAR PIPELINE. There is no WSF photo or avatar field anywhere in the
 * product and this lane invents none. Initials are a typographic treatment of a
 * name a member already chose to show; a member who is not visible never
 * reaches these components, because the callable does not return their name.
 *
 * THE ANONYMOUS MARK IS A SHAPE, NEVER A GENERATED IDENTITY. No initials, no
 * silhouette and deliberately no identicon: an identicon is derived from a uid,
 * which would make it a stable per-person handle — exactly the join key the
 * payload refuses to carry.
 */

/**
 * Initials from a display name.
 *
 * Falls back to a neutral mark rather than throwing or rendering an empty
 * circle: the callable already refuses to list a member with a blank name, so
 * this is defence for a name made only of punctuation or spacing.
 */
export function initialsOf(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '·';
  if (parts.length === 1) return parts[0]!.slice(0, 1).toUpperCase();
  return (parts[0]!.slice(0, 1) + parts[parts.length - 1]!.slice(0, 1)).toUpperCase();
}

export type PresencePerson = { displayName: string; role?: string };

export function isChampionRole(role: string | undefined): boolean {
  return role === 'foundingChampion';
}

/** One initials disc. `onNavy` switches it for use inside a navy panel. */
export function InitialsAvatar({
  displayName,
  role,
  size = 34,
  onNavy = false,
  overlap = false,
}: {
  displayName: string;
  role?: string;
  size?: number;
  onNavy?: boolean;
  overlap?: boolean;
}) {
  const champion = isChampionRole(role);
  return (
    <View
      style={[
        styles.avatar,
        { width: size, height: size, borderRadius: size / 2 },
        onNavy ? styles.avatarOnNavy : null,
        champion ? styles.avatarChampion : null,
        overlap ? styles.avatarOverlap : null,
      ]}
    >
      <Text
        style={[
          styles.avatarText,
          { fontSize: Math.round(size * 0.34) },
          onNavy && !champion ? styles.avatarTextOnNavy : null,
          champion ? styles.avatarTextChampion : null,
        ]}
      >
        {initialsOf(displayName)}
      </Text>
    </View>
  );
}

/**
 * The presence row: who is here, as people rather than as a number.
 *
 * RENDERS NOTHING WHEN NOBODY IS VISIBLE. A row of empty grey circles would be
 * a drawing of absence, and the count line beside it already carries the truth.
 *
 * `overflow` counts VISIBLE members not drawn — never hidden ones.
 */
export function PresenceRow({ people, max = 5 }: { people: PresencePerson[]; max?: number }) {
  const shown = people.slice(0, max);
  const overflow = Math.max(0, people.length - shown.length);
  if (shown.length === 0) return null;
  return (
    <View style={styles.presenceRow} testID="wsf-presence-row">
      {shown.map((p, i) => (
        <InitialsAvatar
          key={`${p.displayName}-${i}`}
          displayName={p.displayName}
          role={p.role}
          overlap={i > 0}
        />
      ))}
      {overflow > 0 ? (
        <View style={[styles.avatar, styles.avatarMore, styles.avatarOverlap]}>
          <Text style={[styles.avatarText, styles.avatarMoreText]}>+{overflow}</Text>
        </View>
      ) : null}
    </View>
  );
}

export type ActivityRow = {
  /** null for a member showing activity but not their name. */
  displayName: string | null;
  amount: number;
  unit: string;
  at: string;
};

/**
 * Minute-level ISO to something a person reads.
 *
 * The server publishes minute granularity deliberately, so this never renders
 * seconds even if a future payload carried them.
 */
export function relativeWhen(at: string, nowMs: number = Date.now()): string {
  const t = Date.parse(at);
  if (!Number.isFinite(t)) return '';
  const mins = Math.max(0, Math.round((nowMs - t) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? '1 day ago' : `${days} days ago`;
}

/** One momentum row: who moved, how much, when. */
export function MomentumRow({ row, first }: { row: ActivityRow; first: boolean }) {
  const named = row.displayName !== null && row.displayName.trim() !== '';
  return (
    <View
      style={[styles.momentumRow, first ? null : styles.momentumRule]}
      testID="wsf-momentum-row"
    >
      {named ? (
        <InitialsAvatar displayName={row.displayName!} size={28} />
      ) : (
        <View style={[styles.avatar, styles.anonAvatar]}>
          <View style={styles.anonDot} />
        </View>
      )}
      <View style={styles.momentumText}>
        <Text style={styles.momentumWho} numberOfLines={1}>
          {named ? row.displayName : 'Anonymous member'}
        </Text>
        <Text style={styles.momentumWhat}>
          added {row.amount.toLocaleString()}
          {row.unit ? ` ${row.unit}` : ''}
          {row.at ? ` · ${relativeWhen(row.at)}` : ''}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  presenceRow: { flexDirection: 'row', alignItems: 'center' },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: NAVY,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: CREAM,
  },
  avatarOnNavy: { backgroundColor: 'rgba(255,255,255,0.14)', borderColor: 'transparent' },
  avatarChampion: { backgroundColor: PROGRESS_GREEN },
  avatarOverlap: { marginLeft: -5 },
  avatarMore: { backgroundColor: SURFACE, borderColor: CREAM },
  avatarText: { color: ON_NAVY, fontWeight: '800' },
  avatarTextOnNavy: { color: ON_NAVY },
  avatarTextChampion: { color: NAVY },
  avatarMoreText: { color: TEXT_MUTED, fontSize: 12 },

  anonAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#E4E0D7',
    borderColor: 'transparent',
  },
  anonDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#B3AEA2' },

  momentumRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  momentumRule: { borderTopWidth: 1, borderTopColor: HAIRLINE },
  momentumText: { flex: 1, gap: 1 },
  momentumWho: { color: NAVY, fontSize: 14, lineHeight: 20, fontWeight: '700' },
  momentumWhat: { color: TEXT_MUTED, fontSize: 12.5, lineHeight: 17 },
});

/** Re-exported so consumers need not import from two places. */
export const presenceTokens = { NAVY, ON_NAVY, ON_NAVY_MUTED, ON_NAVY_RULE, INK_QUIET };
