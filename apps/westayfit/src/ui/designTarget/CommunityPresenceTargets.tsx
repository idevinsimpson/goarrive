import { StyleSheet, Text, View } from 'react-native';

import { LivingWeProgress } from '../LivingWeProgress';
import { percentLabel, statusLine } from '../progressFormat';
import { WsfWordmark } from '../WsfWordmark';
import {
  ACTION_GREEN,
  ACTION_GREEN_DEEP,
  CREAM,
  HAIRLINE,
  INK,
  INK_MUTED,
  INK_QUIET,
  NAVY,
  ON_NAVY,
  ON_NAVY_MUTED,
  ON_NAVY_RULE,
  PROGRESS_GREEN,
  SURFACE,
  targetRadius,
  targetShadow,
  targetType,
} from './targetTokens';

/**
 * PROPOSED TARGETS — NOT ACCEPTED. The social/community presence surfaces.
 *
 * Drawings of where these screens are going, built in real React Native
 * against the real kit so they cannot promise something the product could not
 * render, and captured through a preview route that is gated off in any
 * deployed build. NONE of these is an AFTER and none is implemented.
 *
 * THE PROBLEM THESE ARE DRAWN AGAINST. The accepted Home carries exactly one
 * social signal — `1 member · moving together this week` — and it is a count.
 * Nothing on the screen shows that another person exists, which is the
 * "too private and solitary" the owner named. The fix is not a new screen; it
 * is presence placed where the eye already goes, so the community is inhabited
 * before it is administrative.
 *
 * WHAT IS DRAWN ONLY BECAUSE THE DATA CAN PROVE IT. Every element below maps
 * to a field the backend already stores or can bound-read (see the package
 * README's truth inventory). Specifically:
 *
 *   · the member count is `wsfMyCommunities.memberCount`, already shipped;
 *   · names and initials come from `wsfMemberProfiles.displayName`, reachable
 *     only through a member-gated callable, never a client read;
 *   · momentum rows are real `wsfContributions` documents — they carry
 *     `userId`, `communityGroupId`, `count`, `unit` and a server `createdAt`;
 *   · `contributorsToday` is rendered ONLY when the bounded read provably
 *     covered the whole window. `null` renders nothing rather than a guess.
 *
 * WHAT IS DELIBERATELY NOT DRAWN, each because it would be a lie or a harm:
 * no faces or photographs (no such field exists and none is being invented);
 * no rank, leaderboard, score or streak; no follower or friend mechanic; no
 * comparison between members; no health claim; no invented person, name,
 * quote, reaction or count; and no identity on any public, kiosk, station or
 * display surface — those payloads are untouched by this lane.
 *
 * THE HIDDEN-COUNT DISCIPLINE, kept from #390. The screens state the FACT that
 * some members are not listed; they never publish the NUMBER that are. A
 * residual is derivable by subtracting the listed rows from the member count
 * and that is unavoidable in any directory — but the product does not perform
 * that subtraction for the reader and does not label its result.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Shared pieces
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Initials from a display name, for the presence treatment.
 *
 * NOT AN AVATAR PIPELINE. There is no WSF photo field, and this lane does not
 * invent one; initials are a typographic treatment of a name the member
 * already chose to show. A member who is not visible never reaches this
 * function — the callable does not return their name at all — so there is no
 * "initials of a private member" case to get wrong.
 */
function initialsOf(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '·';
  if (parts.length === 1) return parts[0]!.slice(0, 1).toUpperCase();
  return (parts[0]!.slice(0, 1) + parts[parts.length - 1]!.slice(0, 1)).toUpperCase();
}

type PresenceMember = { displayName: string; isChampion?: boolean };

/**
 * The presence row: who is here, as people rather than as a number.
 *
 * Placed inside the identity block, ABOVE the goal hero, because the owner's
 * complaint is about the first impression of the screen — presence that only
 * appears after a scroll does not change how the app feels on open.
 *
 * Renders nothing at all when no member is visible. An empty row of grey
 * circles would be a drawing of absence, and the honest sentence below it
 * already carries the truth.
 */
function PresenceRow({
  members,
  overflow,
}: {
  members: PresenceMember[];
  /** Visible members beyond the ones drawn. A count of NAMES, never of hidden people. */
  overflow: number;
}) {
  if (members.length === 0) return null;
  return (
    <View style={s.presenceRow} testID="wsf-presence-row">
      {members.map((m, i) => (
        <View
          key={m.displayName}
          style={[
            s.avatar,
            m.isChampion ? s.avatarChampion : null,
            i > 0 ? s.avatarOverlap : null,
          ]}
        >
          <Text style={[s.avatarText, m.isChampion ? s.avatarTextChampion : null]}>
            {initialsOf(m.displayName)}
          </Text>
        </View>
      ))}
      {overflow > 0 ? (
        <View style={[s.avatar, s.avatarMore, s.avatarOverlap]}>
          <Text style={[s.avatarText, s.avatarMoreText]}>+{overflow}</Text>
        </View>
      ) : null}
    </View>
  );
}

export type MomentumEntry = {
  /**
   * The contributor's name, or `null` for a member whose activity is visible
   * while their name is not.
   *
   * NULL IS A STATE THE UI MUST RENDER, not an error to filter out. A member
   * who turned off their name but left their contributions on still moved the
   * shared total, and dropping their row would quietly under-report the
   * community's activity to make the feed tidier.
   */
  displayName: string | null;
  amount: number;
  unit: string;
  /** Minute-level at the finest. Second-level time is never published. */
  when: string;
};

/**
 * Recent momentum — the evidence that other real people are moving.
 *
 * THE ONE LINE THAT DOES THE EMOTIONAL WORK is the contributor sentence, and
 * it is the one most likely to be a lie, so it is the most guarded: it renders
 * only from a proven count and is absent otherwise.
 */
function MomentumSection({
  entries,
  contributorsToday,
}: {
  entries: MomentumEntry[];
  /**
   * Distinct members who contributed in the current local day, or `null` when
   * the bounded read could not prove the whole window. Null renders NOTHING —
   * never "some", never an estimate, never the row count standing in for a
   * person count.
   */
  contributorsToday: number | null;
}) {
  return (
    <View style={s.card} testID="wsf-momentum-section">
      <Text style={[targetType.eyebrow, s.cardEyebrow]}>Recent momentum</Text>

      {contributorsToday !== null ? (
        <Text style={[targetType.h3, s.momentumHeadline]} testID="wsf-contributors-today">
          {contributorsToday === 1
            ? '1 person moved today'
            : `${contributorsToday} people moved today`}
        </Text>
      ) : null}

      {entries.length === 0 ? (
        <Text style={[targetType.body, s.momentumEmpty]}>
          Nothing added yet today. Yours would be the first.
        </Text>
      ) : (
        <View style={s.momentumList}>
          {entries.slice(0, 2).map((e, i) => (
            <View
              key={`${e.displayName ?? 'anon'}-${e.amount}-${e.when}`}
              style={[s.momentumRow, i > 0 ? s.momentumRowRule : null]}
            >
              {e.displayName !== null ? (
                <View style={s.momentumAvatar}>
                  <Text style={s.momentumAvatarText}>{initialsOf(e.displayName)}</Text>
                </View>
              ) : (
                /*
                  The anonymous mark is a SHAPE, not a placeholder person: no
                  initials, no silhouette, no generated identicon. An identicon
                  is derived from a uid and would be a stable per-person handle
                  — exactly the join key the payload refuses to carry.
                */
                <View style={[s.momentumAvatar, s.momentumAvatarAnon]}>
                  <View style={s.anonDot} />
                </View>
              )}
              <View style={s.momentumText}>
                <Text style={[targetType.body, s.momentumWho]} numberOfLines={1}>
                  {e.displayName ?? 'A member'}
                </Text>
                <Text style={[targetType.meta, s.momentumWhat]}>
                  added {e.amount.toLocaleString()} {e.unit} · {e.when}
                </Text>
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 1 · COMMUNITY — the member's community home, made inhabited
// ─────────────────────────────────────────────────────────────────────────────

export type CommunityPresenceState =
  /** The ordinary case: a populated community, people visible, activity today. */
  | 'inhabited'
  /** Members exist and are visible, but nobody has moved today yet. */
  | 'quietToday'
  /** Every member has chosen privacy. The proof that the screen degrades honestly. */
  | 'allPrivate'
  /** A three-person community. Presence must not look broken at small numbers. */
  | 'small';

const INHABITED: PresenceMember[] = [
  { displayName: 'Dana Whitfield', isChampion: true },
  { displayName: 'Marcus Reed' },
  { displayName: 'Priya Nair' },
  { displayName: 'Tom Okafor' },
  { displayName: 'Leah Brooks' },
];

export function CommunityPresenceTarget({
  state = 'inhabited',
  compact = false,
}: {
  state?: CommunityPresenceState;
  compact?: boolean;
}) {
  const allPrivate = state === 'allPrivate';
  const small = state === 'small';

  const memberCount = allPrivate ? 18 : small ? 3 : 24;
  const visible: PresenceMember[] = allPrivate
    ? []
    : small
      ? [{ displayName: 'Dana Whitfield', isChampion: true }, { displayName: 'Marcus Reed' }]
      : INHABITED;
  // Visible members not drawn in the row. Never the hidden count.
  const overflow = allPrivate ? 0 : small ? 0 : 11;
  // Somebody is unlisted in every state except the small one drawn here.
  const someUnlisted = !small;

  const entries: MomentumEntry[] =
    state === 'quietToday'
      ? []
      : allPrivate
        ? [
            { displayName: null, amount: 40, unit: 'squats', when: '1h ago' },
            { displayName: null, amount: 25, unit: 'squats', when: '3h ago' },
            { displayName: null, amount: 60, unit: 'squats', when: '5h ago' },
          ]
        : [
            { displayName: 'Marcus Reed', amount: 40, unit: 'squats', when: '1h ago' },
            { displayName: null, amount: 25, unit: 'squats', when: '3h ago' },
            { displayName: 'Priya Nair', amount: 60, unit: 'squats', when: '5h ago' },
          ];

  // Proven for the populated states; unprovable is drawn too, because that is
  // the state the product must not paper over.
  const contributorsToday = state === 'quietToday' ? null : allPrivate ? 5 : 7;

  const sharedTotal = 1847;
  const target = 5000;
  const unit = 'squats';
  const ratio = Math.min(1, Math.max(0, sharedTotal / target));

  return (
    <View style={s.screen} testID="wsf-target-community-presence">
      <View style={[s.body, compact ? s.bodyCompact : null]}>
        <View style={s.chrome}>
          <WsfWordmark variant="navy" height={20} />
        </View>

        {/*
          IDENTITY, THEN PEOPLE, THEN THE GOAL. The accepted page goes straight
          from the community name to the navy hero, so the first thing the eye
          lands on is a number in a box. Presence sits between them: the same
          identity block, now carrying who is here.
        */}
        <View style={s.identity}>
          <Text style={[targetType.eyebrow, s.identityEyebrow]}>Your community</Text>
          <Text style={[targetType.h1, s.identityName]} numberOfLines={2}>
            Alpharetta Morning Movers
          </Text>

          <PresenceRow members={visible} overflow={overflow} />

          {/*
            THE HONEST SENTENCE. The member count is the whole community —
            private members are counted here exactly as they always were. The
            second clause states THAT some are unlisted and never HOW MANY.
          */}
          <Text style={[targetType.meta, s.identitySub]} testID="wsf-presence-count">
            {memberCount} members
            {someUnlisted ? ' · some choose not to be listed' : ''}
          </Text>
        </View>

        <View style={s.hero}>
          <View pointerEvents="none" style={s.heroTopLight} />
          <Text style={[targetType.h2, s.heroTitle]}>October Squat Challenge</Text>
          <Text style={[targetType.meta, s.heroWindow]}>Open · Ends Sun, Sep 27</Text>

          <View style={s.weWrap}>
            <View pointerEvents="none" style={s.glowLayer}>
              <View style={s.glow2}>
                <View style={s.glow1} />
              </View>
            </View>
            <LivingWeProgress
              completed={sharedTotal}
              target={target}
              unit={unit}
              width={compact ? 124 : 150}
              surface="dark"
            />
          </View>

          <View style={s.progressPanel}>
            <View style={s.totalRow}>
              <Text style={[targetType.display, s.total, compact ? s.totalCompact : null]}>
                {sharedTotal.toLocaleString()}
              </Text>
              <Text style={[targetType.h3, s.totalOf]}>
                / {target.toLocaleString()} {unit}
              </Text>
            </View>
            <View style={s.track}>
              <View style={[s.trackFill, { width: `${ratio * 100}%` }]} />
            </View>
            <Text style={[targetType.meta, s.story]}>
              {percentLabel(sharedTotal, target)} of the way there ·{' '}
              {statusLine(sharedTotal, target, 'active')}
            </Text>
          </View>
        </View>

        <View style={s.action}>
          <Text style={s.actionText}>Start moving</Text>
        </View>

        <MomentumSection entries={entries} contributorsToday={contributorsToday} />

        {/*
          The way to the people. A quiet row, not a card: Members is a place to
          go, not a thing competing with the goal for weight.
        */}
        <View style={s.quietLink} testID="wsf-members-link">
          <Text style={[targetType.body, s.quietLinkText]}>See everyone in this community</Text>
          <Text style={s.quietLinkChevron}>›</Text>
        </View>
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 2 · MEMBERS — people, not an admin directory
// ─────────────────────────────────────────────────────────────────────────────

export type MembersState = 'people' | 'allPrivate';

export function MembersTarget({
  state = 'people',
  compact = false,
}: {
  state?: MembersState;
  compact?: boolean;
}) {
  const allPrivate = state === 'allPrivate';
  const rows: PresenceMember[] = allPrivate
    ? []
    : [
        { displayName: 'Dana Whitfield', isChampion: true },
        { displayName: 'Marcus Reed' },
        { displayName: 'Priya Nair' },
        { displayName: 'Tom Okafor' },
        { displayName: 'Leah Brooks' },
        { displayName: 'Sam Iverson' },
      ];

  return (
    <View style={s.screen} testID="wsf-target-members">
      <View style={[s.body, compact ? s.bodyCompact : null]}>
        <View style={s.chrome}>
          <Text style={s.back}>‹</Text>
          <Text style={[targetType.meta, s.chromeTitle]}>Alpharetta Morning Movers</Text>
        </View>

        <View style={s.identity}>
          <Text style={[targetType.eyebrow, s.identityEyebrow]}>Members</Text>
          <Text style={[targetType.h1, s.identityName]}>Who moves here</Text>
          <Text style={[targetType.meta, s.identitySub]}>
            24 members · some choose not to be listed
          </Text>
        </View>

        {/*
          THE NAVY PANEL IS THE PEOPLE. The board uses navy for the important
          object on a screen; on this page the important object is the list of
          human beings, not the privacy control.
        */}
        <View style={s.peoplePanel}>
          {allPrivate ? (
            <Text style={[targetType.body, s.peopleEmpty]}>
              No one in this community is listed by name right now. Everyone here still counts
              toward what you are building together.
            </Text>
          ) : (
            rows.map((m, i) => (
              <View
                key={m.displayName}
                style={[s.personRow, i > 0 ? s.personRowRule : null]}
              >
                <View style={[s.avatar, s.avatarOnNavy, m.isChampion ? s.avatarChampion : null]}>
                  <Text
                    style={[
                      s.avatarText,
                      m.isChampion ? s.avatarTextChampion : s.avatarTextOnNavy,
                    ]}
                  >
                    {initialsOf(m.displayName)}
                  </Text>
                </View>
                <Text style={[targetType.h3, s.personName]} numberOfLines={1}>
                  {m.displayName}
                </Text>
                {/*
                  ROLE ONLY WHERE IT IS USEFUL. Champion is worth knowing —
                  it is who to ask. "Member" on every other row would be a
                  column of the same word, which is what an admin table looks
                  like and this page is not one.
                */}
                {m.isChampion ? (
                  <View style={s.rolePill}>
                    <Text style={s.rolePillText}>Champion</Text>
                  </View>
                ) : null}
              </View>
            ))
          )}
        </View>

        {/*
          ONE BOUNDED PAGE AT A TIME, and the affordance carries NO COUNT. The
          callable returns `nextCursor` and nothing that says how many remain;
          a number here would be a second membership figure beside the true
          one, and the difference between them is the hidden count the product
          declines to compute for the reader.
        */}
        {!allPrivate ? (
          <View style={s.quietLink} testID="wsf-members-more">
            <Text style={[targetType.body, s.quietLinkText]}>Show more people</Text>
            <Text style={s.quietLinkChevron}>›</Text>
          </View>
        ) : null}

        {/*
          THE MEMBER'S OWN CONTROL: one unweighted row, no border, no fill, no
          heading — the discipline #390 arrived at after three drafts that let
          privacy climb the hierarchy until it was the page. The guarantee is
          enforced in the callable; it does not need proving on screen.
        */}
        <View style={s.quietLink} testID="wsf-own-visibility-link">
          <Text style={[targetType.body, s.quietLinkText]}>
            You are listed here · Change in Settings
          </Text>
          <Text style={s.quietLinkChevron}>›</Text>
        </View>
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 3 · SETTINGS — privacy, per community, subordinate to the community
// ─────────────────────────────────────────────────────────────────────────────

function Toggle({ on }: { on: boolean }) {
  return (
    <View style={[s.toggle, on ? s.toggleOn : s.toggleOff]}>
      <View style={[s.toggleKnob, on ? s.toggleKnobOn : s.toggleKnobOff]} />
    </View>
  );
}

function CommunityVisibilityBlock({
  name,
  showName,
  showContributions,
  note,
}: {
  name: string;
  showName: boolean;
  showContributions: boolean;
  note?: string;
}) {
  return (
    <View style={s.visBlock}>
      {/*
        THE COMMUNITY IS THE HEADING AND THE CONTROLS SIT UNDER IT. Per the
        direction: per-community controls are visually subordinate to the
        community itself. Inverting this — two global toggles with a list of
        communities inside each — is what makes a settings screen feel like a
        policy console.
      */}
      <Text style={[targetType.h3, s.visName]}>{name}</Text>

      <View style={s.visRow}>
        <View style={s.visRowText}>
          <Text style={[targetType.body, s.visLabel]}>Show my name in this community</Text>
        </View>
        <Toggle on={showName} />
      </View>

      <View style={[s.visRow, s.visRowRule]}>
        <View style={s.visRowText}>
          <Text style={[targetType.body, s.visLabel]}>Show my contributions in activity</Text>
        </View>
        <Toggle on={showContributions} />
      </View>

      {note ? <Text style={[targetType.meta, s.visNote]}>{note}</Text> : null}
    </View>
  );
}

export function SettingsPrivacyTarget({ compact = false }: { compact?: boolean }) {
  return (
    <View style={s.screen} testID="wsf-target-settings-privacy">
      <View style={[s.body, compact ? s.bodyCompact : null]}>
        <View style={s.chrome}>
          <Text style={s.back}>‹</Text>
          <Text style={[targetType.meta, s.chromeTitle]}>Settings</Text>
        </View>

        <View style={s.identity}>
          <Text style={[targetType.eyebrow, s.identityEyebrow]}>Privacy</Text>
          <Text style={[targetType.h1, s.identityName]}>Community visibility</Text>
          <Text style={[targetType.meta, s.identitySub]}>
            You choose this for each community separately.
          </Text>
        </View>

        <CommunityVisibilityBlock
          name="Alpharetta Morning Movers"
          showName
          showContributions
        />

        {/*
          THE STATE THE CONTRACT EXISTS FOR, drawn rather than described: name
          off, contributions on. The note says exactly what the feed will show,
          in the feed's own words, so the setting is not a guess.
        */}
        <CommunityVisibilityBlock
          name="Smyrna Strong"
          showName={false}
          showContributions
          note="Your activity appears as “A member.” Your effort still counts toward the total."
        />

        {!compact ? (
          <CommunityVisibilityBlock
            name="Westside Lunch Crew"
            showName={false}
            showContributions={false}
            note="You are not listed and your activity is not shown here. Your effort still counts toward the total."
          />
        ) : null}

        <Text style={[targetType.meta, s.footnote]}>
          Nothing here is shown outside the community — public screens and displays never show
          names.
        </Text>
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 4 · YOU — the quiet way in
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The only change this lane proposes to You: a quiet settings action.
 *
 * NOT ANOTHER BOTTOM TAB. The agreed IA is Home · Community · MOVE · Progress ·
 * You, and the direction says a gear or action, not a sixth destination. The
 * board puts a gear in the top-right chrome of the profile screen, which is
 * where this sits.
 */
export function YouSettingsEntryTarget({ compact = false }: { compact?: boolean }) {
  return (
    <View style={s.screen} testID="wsf-target-you-settings-entry">
      <View style={[s.body, compact ? s.bodyCompact : null]}>
        <View style={s.chrome}>
          <WsfWordmark variant="navy" height={20} />
          <View style={s.gear} testID="wsf-you-settings-gear">
            <Text style={s.gearGlyph}>⚙</Text>
          </View>
        </View>

        <View style={s.identity}>
          <Text style={[targetType.eyebrow, s.identityEyebrow]}>You</Text>
          <Text style={[targetType.h1, s.identityName]}>Dana Whitfield</Text>
          <Text style={[targetType.meta, s.identitySub]}>Moving with 3 communities</Text>
        </View>

        <View style={s.card}>
          <Text style={[targetType.eyebrow, s.cardEyebrow]}>Your part</Text>
          <Text style={[targetType.h2, s.youPart]}>420 squats</Text>
          <Text style={[targetType.meta, s.youPartSub]}>private to you</Text>
        </View>

        {/*
          The same destination as the gear, spelled out. A gear alone is
          discoverable only to people who already expect it to be there, and
          the privacy control behind it is the one setting a member is most
          likely to go looking for deliberately.
        */}
        <View style={s.quietLink}>
          <Text style={[targetType.body, s.quietLinkText]}>Settings</Text>
          <Text style={s.quietLinkChevron}>›</Text>
        </View>
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

const AVATAR = 34;

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: CREAM },
  body: { flex: 1, paddingHorizontal: 20, paddingTop: 12, gap: 11 },
  bodyCompact: { gap: 8, paddingTop: 9 },

  chrome: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  chromeTitle: { color: INK_MUTED, fontWeight: '700' },
  back: { color: NAVY, fontSize: 26, fontWeight: '800', lineHeight: 28 },
  gear: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: HAIRLINE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gearGlyph: { fontSize: 15, color: NAVY },

  identity: { gap: 6 },
  identityEyebrow: { color: PROGRESS_GREEN },
  identityName: { color: INK },
  identitySub: { color: INK_MUTED },

  // ── presence ──
  presenceRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  avatar: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: AVATAR / 2,
    backgroundColor: NAVY,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: CREAM,
  },
  avatarOnNavy: { borderColor: 'transparent', backgroundColor: 'rgba(255,255,255,0.14)' },
  avatarOverlap: { marginLeft: -5 },
  avatarChampion: { backgroundColor: PROGRESS_GREEN },
  avatarMore: { backgroundColor: SURFACE, borderColor: CREAM },
  avatarText: { color: ON_NAVY, fontSize: 11.5, fontWeight: '800', letterSpacing: 0 },
  avatarTextChampion: { color: '#0B1F3A' },
  avatarTextOnNavy: { color: ON_NAVY },
  avatarMoreText: { color: INK_MUTED },

  // ── hero ──
  hero: {
    backgroundColor: NAVY,
    borderRadius: targetRadius.hero,
    padding: 14,
    gap: 6,
    overflow: 'hidden',
    ...targetShadow.card,
  },
  heroTopLight: {
    position: 'absolute',
    top: -60,
    left: -20,
    right: -20,
    height: 130,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 999,
  },
  heroTitle: { color: ON_NAVY },
  heroWindow: { color: ON_NAVY_MUTED },
  weWrap: { alignItems: 'center', justifyContent: 'center', paddingVertical: 4 },
  glowLayer: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  glow2: {
    width: 190,
    height: 190,
    borderRadius: 95,
    backgroundColor: 'rgba(145,203,125,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  glow1: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(145,203,125,0.12)',
  },
  progressPanel: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: targetRadius.control,
    padding: 12,
    gap: 7,
  },
  totalRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 7 },
  total: { color: ON_NAVY },
  totalCompact: { fontSize: 34, lineHeight: 38 },
  totalOf: { color: ON_NAVY_MUTED, paddingBottom: 4 },
  track: {
    height: 8,
    borderRadius: 4,
    backgroundColor: ON_NAVY_RULE,
    overflow: 'hidden',
  },
  trackFill: { height: 8, borderRadius: 4, backgroundColor: PROGRESS_GREEN },
  story: { color: ON_NAVY_MUTED },

  // ── action ──
  action: {
    backgroundColor: ACTION_GREEN,
    borderRadius: targetRadius.control,
    paddingVertical: 13,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: ACTION_GREEN_DEEP,
  },
  actionText: { color: '#04260F', fontSize: 16, fontWeight: '800' },

  // ── cards ──
  card: {
    backgroundColor: SURFACE,
    borderRadius: targetRadius.card,
    padding: 14,
    gap: 8,
    borderWidth: 1,
    borderColor: HAIRLINE,
  },
  cardEyebrow: { color: PROGRESS_GREEN },
  momentumHeadline: { color: INK },
  momentumEmpty: { color: INK_QUIET },
  momentumList: { gap: 0 },
  momentumRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  momentumRowRule: { borderTopWidth: 1, borderTopColor: HAIRLINE },
  momentumAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: NAVY,
    alignItems: 'center',
    justifyContent: 'center',
  },
  momentumAvatarAnon: { backgroundColor: '#E4E0D7' },
  anonDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#B3AEA2' },
  momentumAvatarText: { color: ON_NAVY, fontSize: 11, fontWeight: '800' },
  momentumText: { flex: 1, gap: 1 },
  momentumWho: { color: INK, fontWeight: '700' },
  momentumWhat: { color: INK_MUTED },

  // ── quiet link ──
  quietLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
  quietLinkText: { color: NAVY, fontWeight: '700' },
  quietLinkChevron: { color: INK_QUIET, fontSize: 20, fontWeight: '700' },

  // ── members ──
  peoplePanel: {
    backgroundColor: NAVY,
    borderRadius: targetRadius.card,
    paddingHorizontal: 14,
    paddingVertical: 4,
    ...targetShadow.card,
  },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 10 },
  personRowRule: { borderTopWidth: 1, borderTopColor: ON_NAVY_RULE },
  personName: { color: ON_NAVY, flex: 1 },
  peopleEmpty: { color: ON_NAVY_MUTED, paddingVertical: 14 },
  rolePill: {
    backgroundColor: 'rgba(145,203,125,0.18)',
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  rolePillText: { color: PROGRESS_GREEN, fontSize: 10, fontWeight: '800', letterSpacing: 0.4 },

  // ── settings ──
  visBlock: {
    backgroundColor: SURFACE,
    borderRadius: targetRadius.card,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 2,
    borderWidth: 1,
    borderColor: HAIRLINE,
  },
  visName: { color: INK, marginBottom: 4 },
  visRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9 },
  visRowRule: { borderTopWidth: 1, borderTopColor: HAIRLINE },
  visRowText: { flex: 1 },
  visLabel: { color: INK },
  visNote: { color: INK_MUTED, paddingTop: 6 },
  footnote: { color: INK_QUIET },

  toggle: { width: 44, height: 26, borderRadius: 13, padding: 3, justifyContent: 'center' },
  toggleOn: { backgroundColor: ACTION_GREEN },
  toggleOff: { backgroundColor: '#D3CEC4' },
  toggleKnob: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#FFFFFF' },
  toggleKnobOn: { alignSelf: 'flex-end' },
  toggleKnobOff: { alignSelf: 'flex-start' },

  // ── you ──
  youPart: { color: INK },
  youPartSub: { color: INK_QUIET },
});
