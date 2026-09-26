import { httpsCallable } from 'firebase/functions';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useWsfAuth } from '../auth';
import { getFirebaseFunctions } from '../firebase';
import { forgetCommunity, readMyCommunities } from '../memberReads';
import { isChampionRole } from './CommunityPresence';
import { CommunityPrivacyPanelView } from './CommunityPrivacyPanelView';
import type { PrivacyCommunity, PrivacySaveErrorKind, Visibility } from './communityParityTypes';

/**
 * PRIVACY — how you appear in each of your communities: the STATE and the
 * saves, drawn by W4's accepted `CommunityPrivacyPanelView`
 * (COMMUNITY-SETTINGS-PARITY-1; Director #497 `5841956174`). One owner for the
 * Settings panel over the member's tabs and the `/settings/privacy` page.
 *
 * WHAT IS RENDERED IS WHAT IS STORED. `wsfSetCommunityVisibility` returns the
 * SETTLED value and the switch adopts it; nothing is optimistic.
 *
 * A FAILED SAVE STAYS SAID (W7 Check 43). The stored values are re-read
 * QUIETLY after a failure, and the failure stays until the member retries or
 * makes another change, in one of three kinds:
 *   · `membershipRefused` — `not-found` / `permission-denied`: this account no
 *     longer belongs there; that community's record goes, and its block says
 *     so with no switches;
 *   · `unconfirmed` — the re-read found the asked-for value stored (the write
 *     landed though its reply did not), or could not re-read at all;
 *   · `notSaved` — the re-read found the value unchanged.
 *
 * NO LATE ANSWER OVERWRITES A NEWER ONE (hardening addendum, Director #489
 * `5841405625`). Every community + setting has a generation, advanced by each
 * action on it. A save's reply is adopted only if nothing newer happened to
 * that setting, and only for that setting (the reply also carries the other
 * one, which another save may have moved since). A re-read issued before a
 * save lands does not put back what the save settled. A community takes no
 * second action while its save is unresolved: nothing optimistic is shown, so
 * a second press could only repeat the first intent. An account epoch,
 * advanced on account change and on close, drops every reply that arrives for
 * an account or a panel that is no longer here.
 */

type Setting = 'name' | 'activity';
const keyOf = (groupId: string, setting: Setting) => `${groupId}:${setting}`;

/** Settled privacy changes, for surfaces that show who is named (the roster). */
const settledListeners = new Set<(groupId: string) => void>();
export function onPrivacySettled(listener: (groupId: string) => void): () => void {
  settledListeners.add(listener);
  return () => {
    settledListeners.delete(listener);
  };
}

type CommunityRow = {
  groupId: string;
  displayName: string;
  role?: string;
  nameVisibility: Visibility;
  activityVisibility: Visibility;
};

type SetResponse = { groupId: string; name: Visibility; activity: Visibility };

type Failure = { kind: PrivacySaveErrorKind; setting: Setting; value: Visibility };

const REFUSED = new Set(['functions/not-found', 'functions/permission-denied']);

export function CommunityPrivacyControls({ compact = false }: { compact?: boolean }) {
  const { user, ready } = useWsfAuth();
  const uid = user?.uid ?? null;
  const [rows, setRows] = useState<CommunityRow[]>([]);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'failed'>('loading');
  /** Per community: the last save's failure, kept until a retry or a new change. */
  const [failures, setFailures] = useState<Record<string, Failure>>({});
  /** Per community: the setting whose save is unresolved. */
  const [saving, setSaving] = useState<Record<string, Setting>>({});
  /** Guards a landed answer against a newer load and against another account. */
  const live = useRef(0);
  /** Advanced on every account change and on unmount: older replies are dropped. */
  const epoch = useRef(0);
  /** Per community + setting: advanced by each action on it. */
  const gens = useRef(new Map<string, number>());
  const savingRef = useRef<Record<string, Setting>>(saving);
  savingRef.current = saving;
  const rowsRef = useRef<CommunityRow[]>(rows);
  rowsRef.current = rows;
  const failuresRef = useRef<Record<string, Failure>>(failures);
  failuresRef.current = failures;
  /** Per community: advanced by each action, so a late failure never outlives a newer one. */
  const actions = useRef(new Map<string, number>());

  useEffect(() => {
    epoch.current += 1;
    gens.current = new Map();
    return () => {
      epoch.current += 1;
    };
  }, [uid]);

  const setSavingFor = (groupId: string, setting: Setting | null) => {
    const next = { ...savingRef.current };
    if (setting) next[groupId] = setting;
    else delete next[groupId];
    savingRef.current = next;
    setSaving(next);
  };

  /** Re-reads what is stored. Returns the fresh rows, or null if it could not. */
  const load = useCallback(
    async ({ quiet }: { quiet: boolean }): Promise<CommunityRow[] | null> => {
      if (!uid) return null;
      const token = ++live.current;
      const ep = epoch.current;
      // What each setting's generation was when this read was issued.
      const issued = new Map(gens.current);
      if (!quiet) setPhase('loading');
      try {
        const answer = await readMyCommunities(uid);
        if (live.current !== token || epoch.current !== ep) return null;
        const fresh = (answer.items ?? []) as unknown as CommunityRow[];
        const merged = fresh.map((f) => {
          const shown = rowsRef.current.find((r) => r.groupId === f.groupId);
          if (!shown) return f;
          // A setting acted on since this read was issued keeps what its own
          // save settled; the read is older than that.
          const keep = (setting: Setting) => {
            const k = keyOf(f.groupId, setting);
            return (gens.current.get(k) ?? 0) !== (issued.get(k) ?? 0) || savingRef.current[f.groupId] === setting;
          };
          return {
            ...f,
            nameVisibility: keep('name') ? shown.nameVisibility : f.nameVisibility,
            activityVisibility: keep('activity') ? shown.activityVisibility : f.activityVisibility,
          };
        });
        // A community refused while this panel is open stays, with its refusal
        // said and no switches, until the member moves on.
        const refusedKept = rowsRef.current.filter(
          (r) => !merged.some((m) => m.groupId === r.groupId) && failuresRef.current[r.groupId]?.kind === 'membershipRefused',
        );
        const next = [...merged, ...refusedKept];
        rowsRef.current = next;
        setRows(next);
        setPhase('ready');
        return merged;
      } catch {
        if (live.current !== token || epoch.current !== ep) return null;
        if (!quiet) setPhase('failed');
        return null;
      }
    },
    [uid],
  );
  useEffect(() => {
    if (!ready || !uid) return;
    setFailures({});
    void load({ quiet: false });
  }, [ready, uid, load]);

  const setFailure = (groupId: string, failure: Failure | null) => {
    const next = { ...failuresRef.current };
    if (failure) next[groupId] = failure;
    else delete next[groupId];
    failuresRef.current = next;
    setFailures(next);
  };

  const save = useCallback(
    async (groupId: string, setting: Setting, value: Visibility) => {
      if (!uid) return;
      const row = rowsRef.current.find((r) => r.groupId === groupId);
      if (!row || savingRef.current[groupId]) return;
      const key = keyOf(groupId, setting);
      const gen = (gens.current.get(key) ?? 0) + 1;
      gens.current.set(key, gen);
      const ep = epoch.current;
      const action = (actions.current.get(groupId) ?? 0) + 1;
      actions.current.set(groupId, action);
      setSavingFor(groupId, setting);
      // A new action is the member moving on: that community's last failure goes.
      setFailure(groupId, null);
      try {
        const fn = httpsCallable<{ groupId: string; name?: Visibility; activity?: Visibility }, SetResponse>(
          getFirebaseFunctions(),
          'wsfSetCommunityVisibility',
        );
        const res = await fn({ groupId, [setting]: value });
        if (epoch.current !== ep || gens.current.get(key) !== gen) return;
        // ADOPT THE SETTLED VALUE, never the requested one -- and only for the
        // setting this save was about.
        const settled = res.data[setting];
        const next = rowsRef.current.map((r) =>
          r.groupId === groupId
            ? setting === 'name'
              ? { ...r, nameVisibility: settled }
              : { ...r, activityVisibility: settled }
            : r,
        );
        rowsRef.current = next;
        setRows(next);
        settledListeners.forEach((l) => l(groupId));
      } catch (e) {
        if (epoch.current !== ep) return;
        const code = (e as { code?: unknown } | null)?.code;
        if (typeof code === 'string' && REFUSED.has(code)) {
          forgetCommunity(uid, groupId);
          setFailure(groupId, { kind: 'membershipRefused', setting, value });
          setSavingFor(groupId, null);
          await load({ quiet: true });
          return;
        }
        // Re-read rather than guess -- quietly, and without clearing the failure.
        setSavingFor(groupId, null);
        const fresh = await load({ quiet: true });
        // The member has acted on this community since: that is the news now.
        if (epoch.current !== ep || actions.current.get(groupId) !== action) return;
        const stored = fresh?.find((r) => r.groupId === groupId);
        const landed =
          stored !== undefined && (setting === 'name' ? stored.nameVisibility : stored.activityVisibility) === value;
        setFailure(groupId, { kind: fresh === null || landed ? 'unconfirmed' : 'notSaved', setting, value });
      } finally {
        if (epoch.current === ep && savingRef.current[groupId] === setting) setSavingFor(groupId, null);
      }
    },
    [uid, load],
  );

  const communities: PrivacyCommunity[] = rows.map((r) => ({
    groupId: r.groupId,
    displayName: r.displayName,
    isChampion: isChampionRole(r.role),
    stored: { name: r.nameVisibility, activity: r.activityVisibility },
    saving: saving[r.groupId] ?? null,
    saveError: failures[r.groupId]?.kind ?? null,
  }));

  return (
    <CommunityPrivacyPanelView
      load={phase}
      communities={communities}
      compact={compact}
      onChange={(groupId, key, value) => void save(groupId, key, value)}
      onRetrySave={(groupId) => {
        const f = failuresRef.current[groupId];
        if (f && f.kind !== 'membershipRefused') void save(groupId, f.setting, f.value);
      }}
      onRetryLoad={() => void load({ quiet: false })}
      testID="wsf-privacy-controls"
    />
  );
}
