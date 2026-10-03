import { ArrowLeft, Check, RefreshCw, Share2 } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import wordmark from "../assets/wordmark-navy-green.png.asset.json";
import { currentView, eligibility, fmt, goalMovements, MAX_ENTRY, movementText, parseCount, plural, goalViewFor, newId, ownMovementTotal, ownTotal, progress, REJECT_COPY, repeatPolicyOf, type GoalView, type MovementKey } from "./model";
import { isChampion, useDemo } from "./store";
import { useNav } from "./shell";
import { GoalNumbers, LivingWE, MovementIcon, MovementPill, Sheet } from "./ui";
import { TogetherReceipt } from "./together";

type DraftStep = "movement" | "instructions" | "count" | "review" | "share";
const STEP_ORDER: Record<string, number> = { movement: 0, instructions: 1, count: 2, review: 3, pending: 4, unknown: 4, notFound: 4, legacyAmbiguous: 4, rejected: 5, confirmed: 5, share: 6 };

export const unknownAttemptCopy = (amount: number, goalTitle: string, movementKey: MovementKey = "squats", customUnit?: string) =>
  `The demo reply was lost. Your +${fmt(amount)} ${movementText(movementKey, customUnit).singular} attempt for ${goalTitle} is kept — checking reads that same attempt, so nothing is counted twice.`;

export function MoveFlow({ mode }: { mode: "start" | "already" }) {
  const { state, dispatch } = useDemo();
  const { close, goTab, open, announce } = useNav();
  const persisted = state.attempt;
  // A new draft is fixed at open: community + goal never change even if background selection does.
  const draft = useRef({ id: newId("attempt"), communityId: state.selectedCommunityId, goalId: state.communities[state.selectedCommunityId]?.currentGoalId ?? null });
  const resumed = useRef(!!persisted).current;
  const communityId = persisted?.communityId ?? draft.current.communityId;
  const goalId = persisted?.goalId ?? draft.current.goalId;
  const openView = useRef<GoalView>(currentView(state, communityId)).current;
  const initialGoal = draft.current.goalId ? state.goals[draft.current.goalId] : undefined;
  const allowedMovements = initialGoal ? goalMovements(initialGoal) : ["squats" as const];
  const [movementKey, setMovementKey] = useState<MovementKey>(persisted?.movementKey ?? allowedMovements[0] ?? "squats");
  const [draftStep, setDraftStep] = useState<DraftStep>(persisted ? "count" : allowedMovements.length > 1 ? "movement" : mode === "start" ? "instructions" : "count");
  const [count, setCount] = useState("");
  const [error, setError] = useState("");
  const [failure, setFailure] = useState<"none" | "lost" | "never">("none");
  const submitting = useRef(false);
  const directPresentation = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const direction = useRef<{ key: string; order: number; dir: "none" | "fwd" | "back" }>({ key: "", order: 0, dir: "none" });

  const stage = persisted?.stage;
  const stepKey = stage === "confirmed" && draftStep === "share" ? "share" : stage ?? draftStep;
  const stepOrder = STEP_ORDER[stepKey] ?? 0;
  if (!direction.current.key) direction.current = { key: stepKey, order: stepOrder, dir: "none" };
  else if (direction.current.key !== stepKey) direction.current = { key: stepKey, order: stepOrder, dir: stepOrder >= direction.current.order ? "fwd" : "back" };
  const firstRender = useRef(true);
  useEffect(() => { if (firstRender.current) { firstRender.current = false; return; } heading.current?.focus(); }, [stepKey]);
  useEffect(() => {
    if (resumed && persisted) announce(persisted.stage === "confirmed" ? "Showing the receipt for your earlier attempt." : "Resuming your earlier attempt.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const community = state.communities[communityId];
  const goal = goalId ? state.goals[goalId] : undefined;
  const frozenMovementKey = persisted?.movementKey ?? movementKey;
  // Identity is frozen: a persisted attempt carries its own custom unit; a draft reads the fixed goal's.
  const movement = movementText(frozenMovementKey, persisted ? persisted.customUnit : goal?.customUnit);
  const quick = frozenMovementKey === "steps" ? [1000, 2500, 5000] : frozenMovementKey === "laps" ? [1, 2, 4] : [10, 20, 30];
  const elig = goal ? eligibility(state, goal.id) : null;
  const amount = persisted?.amount ?? Number(count);
  const chooseMovement = (key: MovementKey) => {
    if (key !== movementKey) setCount("");
    setMovementKey(key);
    setError("");
  };

  // Closing a resolved receipt ends the attempt; unresolved attempts are kept for recovery.
  const onClose = (after?: () => void) => {
    if (persisted?.stage === "confirmed") dispatch({ type: "clearAttempt", attemptId: persisted.id });
    close(after);
  };

  const validate = () => {
    const r = parseCount(count);
    if (r.ok) return "";
    if (r.reason === "over") return `Enter up to ${fmt(MAX_ENTRY)} per entry.`;
    if (r.reason === "zero") return `Enter at least 1 ${movement.singular}.`;
    return `Enter a whole number of ${movement.lower} — no decimals, signs or spaces.`;
  };

  const confirm = () => {
    if (submitting.current || persisted || !goalId) return; // rapid double-click guard; reducer is also idempotent
    const e = eligibility(state, goalId); // review→submit boundary: re-check window and policy at this instant
    if (!e.ok) { setError(REJECT_COPY[e.reason]); return; }
    submitting.current = true;
    directPresentation.current = true;
    dispatch({ type: "submit", attemptId: draft.current.id, communityId, goalId, movementKey: frozenMovementKey, amount, lost: failure === "lost", neverRecorded: failure === "never" });
  };

  const prevStage = useRef(stage);
  useEffect(() => {
    if (stage === "notFound") announce("No record found for this attempt. Nothing was counted.");
    if (stage === "legacyAmbiguous") announce("Older saved demo entry needs review. Its confirmation outcome is unavailable.");
    if (prevStage.current === "pending" && stage === "unknown") announce("Response unknown. Check status for the same attempt.");
    if (prevStage.current && prevStage.current !== "confirmed" && stage === "confirmed") announce(`Demo confirmation: plus ${amount} ${movement.lower}, counted once.`);
    prevStage.current = stage;
    if (stage === "unknown" || stage === "notFound" || stage === "rejected") directPresentation.current = false;
  }, [stage, amount, announce]);

  const title = stage === "confirmed" ? "Contribution receipt" : mode === "start" && !persisted ? "Start moving" : persisted ? "Your attempt" : "Already moved";

  let body: ReactNode;
  if (!community || !goal) {
    body = (
      <div className="flow-step">
        <h3 ref={heading} tabIndex={-1}>No active goal</h3>
        <p>{community ? `${community.name} has no open goal to add movement to.` : "This sample community isn’t available."}</p>
        <div className="flow-actions">
          {community && isChampion(state, communityId) && <button className="primary-action" type="button" onClick={() => open("goal", { communityId })}>Set up a goal</button>}
          <button className="secondary-action" type="button" onClick={() => onClose(() => goTab("community"))}>Go to Community</button>
        </div>
      </div>
    );
  } else if (!persisted && elig && !elig.ok && (elig.reason === "once" || elig.reason === "scheduled" || elig.reason === "ended") && draftStep !== "review") {
    body = (
      <div className="flow-step">
        <h3 ref={heading} tabIndex={-1}>{elig.reason === "once" ? "You’ve already contributed" : elig.reason === "scheduled" ? "Not started yet" : "This goal has ended"}</h3>
        <p>{REJECT_COPY[elig.reason]} {elig.reason === "scheduled" && goal.startsAt ? `It opens ${new Date(goal.startsAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}.` : ""}</p>
        <p className="muted small">Your confirmed history stays in Progress.</p>
        <div className="flow-actions"><button className="primary-action" type="button" onClick={() => onClose(() => goTab("progress"))}>See your progress</button></div>
      </div>
    );
  } else if (!persisted && !openView.canContribute) {
    const stale = openView.kind === "stale" || openView.kind === "unknown";
    body = (
      <div className="flow-step">
        <h3 ref={heading} tabIndex={-1}>{stale ? "Confirmation paused" : openView.kind === "none" ? "No active goal" : "This goal is closed"}</h3>
        <p>{stale ? "Community totals aren’t live, so this demo won’t confirm anything it can’t verify." : openView.kind === "none" ? `${community.name} has no open goal to add movement to.` : "New movement can’t be added to a closed goal."}</p>
        <div className="flow-actions">
          {stale && <button className="primary-action" type="button" onClick={() => { dispatch({ type: "scenario", scenario: "inhabited" }); close(); }}><RefreshCw aria-hidden="true" /> Retry connection</button>}
          {!stale && isChampion(state, communityId) && <button className="primary-action" type="button" onClick={() => open("goal", { communityId })}>Set up a goal</button>}
          <button className="secondary-action" type="button" onClick={() => close(() => goTab("community"))}>Go to Community</button>
        </div>
      </div>
    );
  } else if (stage === "pending" || (!persisted && draftStep === "review") || (!persisted && submitting.current)) {
    const pending = stage === "pending";
    const ownBefore = persisted?.ownBefore ?? ownTotal(state, goal.id);
    body = (
      <div className="flow-step">
        <h3 ref={heading} tabIndex={-1}>{pending ? "Confirming your contribution" : "Review your contribution"}</h3>
        <div className="review-card">
           <span className="review-amt">+{fmt(amount)} <small>{movement.lower}</small></span>
          <dl>
            <div><dt>Goal</dt><dd>{goal.title}</dd></div>
            <div><dt>Community</dt><dd>{community.name}</dd></div>
             <div><dt>Movement</dt><dd>{movement.label}</dd></div>
             <div><dt>Your {movement.lower} in this goal</dt><dd>{fmt(ownMovementTotal(state, goal.id, frozenMovementKey))} → {fmt(ownMovementTotal(state, goal.id, frozenMovementKey) + amount)}</dd></div>
          </dl>
          <p className="muted small">The shared total is shown only after confirmation — we don’t predict it.</p>
        </div>
        {pending
          ? <p className="muted small" role="status">Simulated confirmation in progress. You can close this — the same attempt is kept and resumes here.</p>
          : (
            <fieldset className="demo-switch-group">
              <legend className="muted small">Demo only: simulated outcome</legend>
              {([["none", "Normal confirmation"], ["lost", "Reply lost (server recorded it)"], ["never", "Request never recorded"]] as const).map(([v, l]) => (
                <label key={v} className="demo-switch"><input type="radio" name="sim-failure" checked={failure === v} onChange={() => setFailure(v)} /><span>{l}</span></label>
              ))}
            </fieldset>
          )}
        {error && <p className="field-error" role="alert">{error}</p>}
        <div className="flow-actions">
          <button className="secondary-action" type="button" disabled={pending} onClick={() => { setError(""); setDraftStep("count"); }}><ArrowLeft aria-hidden="true" /> Edit</button>
          <button className="primary-action" type="button" onClick={confirm} aria-disabled={pending} data-testid="confirm">{pending ? "Confirming (simulated)…" : "Confirm (demo)"}</button>
        </div>
      </div>
    );
  } else if (stage === "unknown" && persisted) {
    body = (
      <div className="flow-step">
        <h3 ref={heading} tabIndex={-1}>We didn’t hear back</h3>
         <p>{unknownAttemptCopy(persisted.amount, goal.title, frozenMovementKey, persisted.customUnit)}</p>
        <p className="muted small">Not yet counted in your total, your history or the shared total. Only a confirmed check adds it.</p>
        <div className="flow-actions">
          <button className="primary-action" type="button" onClick={() => dispatch({ type: "reconcile", attemptId: persisted.id })}><RefreshCw aria-hidden="true" /> Check status</button>
        </div>
      </div>
    );
  } else if (stage === "notFound" && persisted) {
    body = (
      <div className="flow-step">
        <h3 ref={heading} tabIndex={-1}>No record of this attempt</h3>
         <p>The simulated server has no saved outcome for your +{fmt(persisted.amount)} {movement.lower}. Nothing was counted.</p>
        <p className="muted small" role="status">Checked {plural(persisted.checks ?? 1, "time")}. You can check again, or discard this attempt and start a new one.</p>
        <div className="flow-actions">
          <button className="secondary-action" type="button" onClick={() => { dispatch({ type: "discardAttempt", attemptId: persisted.id }); draft.current = { id: newId("attempt"), communityId: persisted.communityId, goalId: persisted.goalId }; submitting.current = false; setCount(String(persisted.amount)); setFailure("none"); setDraftStep("count"); }}>Discard attempt</button>
          <button className="primary-action" type="button" onClick={() => dispatch({ type: "reconcile", attemptId: persisted.id })}><RefreshCw aria-hidden="true" /> Check again</button>
        </div>
      </div>
    );
  } else if (stage === "legacyAmbiguous" && persisted) {
    body = (
      <div className="flow-step">
        <h3 ref={heading} tabIndex={-1}>Older saved entry needs review</h3>
         <p>This older sample session already added <strong>+{fmt(persisted.amount)} squats</strong> locally, but it has no saved confirmation record.</p>
        <p className="demo-note" role="status">We can’t honestly say it was confirmed or that nothing was counted. The old local entry is preserved but held outside confirmed totals and history until you decide.</p>
        <div className="flow-actions">
          <button className="secondary-action" type="button" onClick={() => onClose()}>Keep for review</button>
          <button className="primary-action" type="button" onClick={() => { dispatch({ type: "removeLegacyAttempt", attemptId: persisted.id }); draft.current = { id: newId("attempt"), communityId: persisted.communityId, goalId: persisted.goalId }; submitting.current = false; setCount(String(persisted.amount)); setFailure("none"); setDraftStep("count"); }}>Remove local entry</button>
        </div>
        <p className="muted small">Removing affects only this ambiguous local demo entry. Other saved communities, preferences, goals and contributions stay unchanged.</p>
      </div>
    );
  } else if (stage === "rejected" && persisted) {
    const reason = state.serverLedger?.[persisted.id]?.rejected ?? "closed";
    body = (
      <div className="flow-step">
        <h3 ref={heading} tabIndex={-1}>Not counted</h3>
        <p>Your +{fmt(persisted.amount)} {movement.lower} wasn’t added. {REJECT_COPY[reason]}</p>
        <p className="muted small">The simulated server checked this same attempt once. Nothing changed in your total, your history or the shared total.</p>
        <div className="flow-actions"><button className="primary-action" type="button" onClick={() => { dispatch({ type: "clearAttempt", attemptId: persisted.id }); close(); }}>Close</button></div>
      </div>
    );
  } else if (stage === "confirmed" && persisted) {
    const liveAfter = goalViewFor(state, goal.id);
    const hasSnapshot = persisted.receiptBefore != null && persisted.receiptAfter != null && persisted.receiptTarget !== undefined && persisted.receiptStatus != null;
    const receiptView: GoalView = hasSnapshot ? { ...liveAfter, kind: persisted.receiptStatus ?? "open", total: persisted.receiptAfter ?? null, target: persisted.receiptTarget ?? null, live: true, canContribute: persisted.receiptStatus === "open" || persisted.receiptStatus === "reachedOpen", statusLabel: persisted.receiptStatus === "reachedOpen" ? "Reached · still open" : "Open", sampleState: liveAfter.sampleState } : { ...liveAfter, total: null, target: null };
    const after = receiptView;
    const reachedAfterNearSample = after.sampleState === "Reviewer sample state · Near goal" && progress(after.total ?? 0, after.target)?.reached;
    if (draftStep !== "share") return <TogetherReceipt key={persisted.id} result={{ amount, movement: movement.lower, communityName: community.name, goalTitle: goal.title, before: persisted.receiptBefore ?? null, after: persisted.receiptAfter ?? null, target: persisted.receiptTarget, status: persisted.receiptStatus, fresh: directPresentation.current && !resumed, crossed: persisted.crossedTarget === true }} onPresented={() => { directPresentation.current = false; }} onClose={() => onClose()} onShare={() => { directPresentation.current = false; setDraftStep("share"); }} onFinish={() => onClose(() => { dispatch({ type: "select", communityId }); goTab("community"); })} />;
    body = draftStep === "share" ? <SharePreview view={after} communityName={community.name} onBack={() => setDraftStep("review")} heading={heading} /> : (
      <div className="flow-step receipt">
        <p className="receipt-badge"><Check aria-hidden="true" /> Demo confirmation · local only</p>
         <h3 ref={heading} tabIndex={-1}>+{fmt(amount)} {movement.lower} added</h3>
        <div className="receipt-split">
          <div><small>Your addition</small><strong>+{fmt(amount)}</strong></div>
           <div><small>Your {movement.lower} in this goal</small><strong>{fmt(ownMovementTotal(state, goal.id, frozenMovementKey))}</strong></div>
        </div>
        <div className="receipt-shared">
          <LivingWE view={after} size="md" />
          <div><small>Current shared demo total · {goal.title}</small><GoalNumbers view={after} compact /></div>
        </div>
        {after.sampleState && (
          <p className="sample-state-note">
            {reachedAfterNearSample
              ? "Reviewer sample loaded near goal; this contribution has now reached the target."
              : `${after.sampleState} — shared total includes the loaded sample state.`}
          </p>
        )}
        {progress(after.total ?? 0, after.target)?.reached && after.kind === "reachedOpen" && <p className="muted small">This goal has reached its target. Movement still counts while it’s open.</p>}
        {repeatPolicyOf(goal) === "once" && <p className="muted small">This goal counts one contribution per member — yours is in.</p>}
        <p className="muted small">Simulated in this browser only. Not recorded to any server.</p>
        <div className="flow-actions">
          <button className="secondary-action" type="button" onClick={() => setDraftStep("share")}><Share2 aria-hidden="true" /> Share preview</button>
          <button className="primary-action" type="button" onClick={() => onClose(() => { dispatch({ type: "select", communityId }); goTab("community"); })}>Finish</button>
        </div>
      </div>
    );
   } else if (draftStep === "movement") {
     body = (
       <div className="flow-step">
         <p className="flow-goal">For <strong>{goal.title}</strong> · {community.name}</p>
          <h3 ref={heading} tabIndex={-1}>{mode === "start" ? "What do you want to do?" : "What did you do?"}</h3>
         <p>Choose one movement for this contribution.</p>
         <div className="movement-grid movement-choice" role="group" aria-label="Movement for this contribution">
            {goalMovements(goal).map((key) => <MovementPill key={key} movementKey={key} label={movementText(key, goal.customUnit).label} selected={movementKey === key} onClick={() => chooseMovement(key)} />)}
         </div>
         <button className="primary-action" type="button" onClick={() => setDraftStep(mode === "start" ? "instructions" : "count")}>Continue with {movement.label}</button>
       </div>
     );
   } else if (draftStep === "instructions") {
    body = (
      <div className="flow-step">
        <p className="flow-goal">For <strong>{goal.title}</strong> · {community.name}</p>
         <div className="movement-heading"><MovementIcon movementKey={frozenMovementKey} /><h3 ref={heading} tabIndex={-1}>{movement.guide.title}</h3></div>
        <ol className="instructions">
           {movement.guide.rules.map((rule) => <li key={rule}>{rule}</li>)}
        </ol>
        <p className="guide-counts"><strong>Counts:</strong> {movement.guide.counts} <strong>Doesn’t count:</strong> {movement.guide.doesNotCount}</p>
        <p className="muted small">{frozenMovementKey === "steps" ? "Entered by hand — this demo doesn’t read a phone, watch or health app. " : ""}Counting guide only — not medical or safety guidance.</p>
        <div className="flow-actions">
          {goalMovements(goal).length > 1 && <button className="secondary-action" type="button" onClick={() => setDraftStep("movement")}><ArrowLeft aria-hidden="true" /> Change movement</button>}
          <button className="primary-action" type="button" onClick={() => setDraftStep("count")}>I’m done — enter my count</button>
        </div>
      </div>
    );
  } else {
    body = (
      <form className="flow-step" onSubmit={(e) => { e.preventDefault(); const v = validate(); setError(v); if (!v) setDraftStep("review"); }} noValidate>
        <p className="flow-goal">For <strong>{goal.title}</strong> · {community.name}</p>
         <h3 ref={heading} tabIndex={-1}>How many {movement.lower}?</h3>
        <label className="count-field">
           <span>{movement.countLabel} · whole number, up to {fmt(MAX_ENTRY)}</span>
          <input data-autofocus inputMode="numeric" autoComplete="off" value={count} onChange={(e) => { setCount(e.target.value); setError(""); }} aria-invalid={!!error} aria-describedby="count-err" placeholder="0" />
        </label>
        <div className="quick-counts">{quick.map((n) => <button key={n} type="button" onClick={() => { setCount(String(n)); setError(""); }}>{fmt(n)}</button>)}</div>
        <p id="count-err" className="field-error" role="alert">{error}</p>
        <div className="flow-actions">
           {(mode === "start" || goalMovements(goal).length > 1) && <button className="secondary-action" type="button" onClick={() => setDraftStep(mode === "start" ? "instructions" : "movement")}><ArrowLeft aria-hidden="true" /> Back</button>}
          <button className="primary-action" type="submit">Review</button>
        </div>
      </form>
    );
  }

  return <Sheet title={title} variant="sheet" onClose={() => onClose()}><div key={stepKey} className="step-anim" data-dir={direction.current.dir}>{body}</div></Sheet>;
}

/** Preview only: fixed, aggregate-only snapshot rendered as React text (no markup injection). Nothing is posted or downloaded. */
function SharePreview({ view, communityName, onBack, heading }: { view: GoalView; communityName: string; onBack: () => void; heading: RefObject<HTMLHeadingElement | null> }) {
  const p = progress(view.total ?? 0, view.target);
  const asOf = useRef(new Date().toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })).current;
  return (
    <div className="flow-step">
      <h3 ref={heading} tabIndex={-1}>Share preview</h3>
      <div className="share-card" aria-label="Sample aggregate share image preview">
        <span className="share-plate"><img src={wordmark.url} alt="WE STAY FIT" /></span>
        <span className="share-kicker">Sample · design prototype</span>
        <strong>{communityName}</strong>
        <em>{view.goal?.title} · {view.goal?.period} · {view.statusLabel}</em>
        <div className="share-row"><LivingWE view={view} size="sm" /><div><b>{fmt(view.total ?? 0)}</b><em>of {fmt(view.target ?? 0)} {view.goal?.unit} · {p?.label}</em></div></div>
        <small>As of {asOf} · fictional aggregate · no member names</small>
      </div>
      <p className="muted small">Preview only — nothing is posted, sent or downloaded, and members are never shared.</p>
      <div className="flow-actions">
        <button className="secondary-action" type="button" onClick={onBack}><ArrowLeft aria-hidden="true" /> Back to receipt</button>
      </div>
    </div>
  );
}
