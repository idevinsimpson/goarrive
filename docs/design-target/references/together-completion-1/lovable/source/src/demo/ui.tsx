import { Check, CircleUserRound, X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import monogramGreen from "../assets/monogram-fill-green.png.asset.json";
import monogramWhite from "../assets/monogram-unfilled-white.png.asset.json";
import { fmt, progress, type GoalView, type Identity, type MovementKey } from "./model";

export function MovementIcon({ movementKey }: { movementKey: MovementKey }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (movementKey === "squats") return (
    <svg className="movement-pictogram" viewBox="0 0 32 32" aria-hidden="true" {...common}>
      <circle cx="20" cy="5.5" r="2.5" />
      <path d="M18.5 9l-4 5.5 5.5 4.5 5.5-.5M14.5 14.5l-6-1.5M20 19l-5 7.5M25.5 18.5l3 7" />
      <path d="M10 27h7M27 27h3" />
    </svg>
  );
  if (movementKey === "pushUps") return (
    <svg className="movement-pictogram" viewBox="0 0 32 32" aria-hidden="true" {...common}>
      <circle cx="25.5" cy="12" r="2.4" />
      <path d="M23 14.5l-8.5 2-7.5-1.5M15 16.5l7 4.5M8 15l-3 8M22 21l5 3M2.5 24h5M25 25h4.5" />
    </svg>
  );
  if (movementKey === "sitUps") return (
    <svg className="movement-pictogram" viewBox="0 0 32 32" aria-hidden="true" {...common}>
      <circle cx="11" cy="9" r="2.4" />
      <path d="M12.5 11.5l3.5 9M16 20.5l6-5 5 7M13.5 14l5 1.5" />
      <path d="M3 25h26" />
    </svg>
  );
  if (movementKey === "steps") return (
    <svg className="movement-pictogram" viewBox="0 0 32 32" aria-hidden="true" {...common}>
      <path d="M9 4.5c2.6 0 3.6 3 3.3 6.5-.2 2.4-1.4 3.5-3.3 3.5s-3.1-1.1-3.3-3.5C5.4 7.5 6.4 4.5 9 4.5zM6.5 17.5h5l-.4 2.5a2.1 2.1 0 01-4.2 0z" />
      <path d="M23 12.5c2.6 0 3.6 3 3.3 6.5-.2 2.4-1.4 3.5-3.3 3.5s-3.1-1.1-3.3-3.5c-.3-3.5.7-6.5 3.3-6.5zM20.5 25.5h5l-.4 2.5a2.1 2.1 0 01-4.2 0z" />
    </svg>
  );
  if (movementKey === "laps") return (
    <svg className="movement-pictogram" viewBox="0 0 32 32" aria-hidden="true" {...common}>
      <rect x="4" y="8" width="24" height="16" rx="8" />
      <rect x="9" y="13" width="14" height="6" rx="3" />
      <path d="M16 8v5M14 5.5l2 2.5-2 2.5" />
    </svg>
  );
  if (movementKey === "custom") return (
    <svg className="movement-pictogram" viewBox="0 0 32 32" aria-hidden="true" {...common}>
      <rect x="5" y="5" width="22" height="22" rx="6" />
      <path d="M11 12h10M11 16h10M11 20h6" />
    </svg>
  );
  return (
    <svg className="movement-pictogram" viewBox="0 0 32 32" aria-hidden="true" {...common}>
      <circle cx="16" cy="5.5" r="2.5" />
      <path d="M16 9v9M16 11l-7-4M16 11l7-4M16 18l-6 9M16 18l6 9" />
      <path d="M7 6l2 1-1 2M25 6l-2 1 1 2" />
    </svg>
  );
}

export function MovementPill({ movementKey, label, selected, onClick }: { movementKey: MovementKey; label: string; selected: boolean; onClick: () => void }) {
  return <button type="button" className="movement-pill" aria-pressed={selected} onClick={onClick}><MovementIcon movementKey={movementKey} /><span>{label}</span>{selected && <Check className="movement-check" aria-hidden="true" />}</button>;
}

export function Avatar({ who, size = "md" }: { who: Identity | { initials: string | null; anonymous?: boolean }; size?: "sm" | "md" | "lg" }) {
  const anon = !who.initials;
  return (
    <span className={`avatar avatar-${size} ${anon ? "anonymous" : ""}`} aria-hidden="true">
      {anon ? <CircleUserRound /> : who.initials}
    </span>
  );
}

export function LivingWE({ view, size = "lg" }: { view: GoalView; size?: "sm" | "md" | "lg" }) {
  const p = view.total != null ? progress(view.total, view.target) : null;
  if (!p) return null; // No denominator or unknown total → no instrument.
  const label = view.live ? `Living WE filled to ${p.label}` : `Living WE showing last known ${p.label} — not live`;
  return (
    <div className={`living-we we-${size} ${view.live ? "" : "not-live"}`} role="img" aria-label={label}>
      <img src={monogramWhite.url} alt="" />
      <div className="living-we-fill" style={{ clipPath: `inset(${100 - p.fill}% 0 0 0)` }}><img src={monogramGreen.url} alt="" /></div>
    </div>
  );
}

/** Numbers + bar under the instrument. Handles reached/overshoot/closed/stale/unknown/no target. */
export function GoalNumbers({ view, compact }: { view: GoalView; compact?: boolean }) {
  if (view.kind === "unknown" || view.total == null) {
    return <div className="goal-unknown"><strong>Progress unknown</strong><span>We can’t confirm the current total. Nothing is shown as zero.</span></div>;
  }
  const p = progress(view.total, view.target);
  if (!p) return <div className="goal-unknown"><strong>{fmt(view.total)} {view.goal?.unit}</strong><span>No target set — no progress instrument.</span></div>;
  const unit = view.goal?.unit ?? "";
  return (
    <div className={`goal-numbers ${compact ? "compact" : ""}`}>
      <div className="goal-number"><strong>{fmt(view.total)}</strong><span>/ {fmt(view.target ?? 0)} {view.live ? "confirmed" : "last known"}</span></div>
      <div className="progress-track" aria-hidden="true"><span style={{ width: `${p.fill}%` }} /></div>
      <div className="progress-meta">
        <strong>{p.reached ? `Goal reached${p.overshoot ? ` · +${fmt(p.overshoot)} beyond` : ""}` : `${p.label} complete`}</strong>
        <span>{!view.live ? "Not live" : view.kind === "closedUnfinished" ? `Ended ${fmt(p.remaining)} short` : p.reached ? (view.kind === "reachedOpen" ? "Still open" : "Closed") : `${fmt(p.remaining)} ${unit} to go`}</span>
      </div>
    </div>
  );
}

export function StatusPill({ view, tone = "dark" }: { view: GoalView; tone?: "dark" | "light" }) {
  return <span className={`status status-${view.kind} tone-${tone}`}>{view.statusLabel}</span>;
}

export function Sheet({ title, kicker = "Sample data · Design prototype", onClose, children, variant = "sheet", footer, wide }: {
  title: string; kicker?: string; onClose: () => void; children: ReactNode; variant?: "sheet" | "panel" | "focus"; footer?: ReactNode; wide?: boolean;
}) {
  const ref = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const focusables = () => Array.from(dialog.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])')).filter((n) => !n.hasAttribute("disabled") && n.offsetParent !== null);
    (dialog.querySelector<HTMLElement>("[data-autofocus]") ?? focusables()[0])?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); closeRef.current(); return; }
      if (e.key !== "Tab") return;
      const nodes = focusables();
      if (!nodes.length) return;
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (!first || !last) return;
      if (!dialog.contains(document.activeElement)) { e.preventDefault(); first.focus(); return; }
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div className={`overlay overlay-${variant}`} role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget && variant !== "focus") onClose(); }}>
      <section ref={ref} className={`demo-surface ${variant} ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby="surface-title">
        <header className="surface-head">
          <div><span>{kicker}</span><h2 id="surface-title">{title}</h2></div>
          <button type="button" className="close-button" onClick={onClose}><X aria-hidden="true" /><span>Close</span></button>
        </header>
        <div className="surface-body">{children}</div>
        {footer && <div className="surface-foot">{footer}</div>}
      </section>
    </div>
  );
}

export function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle-row">
      <span>{label}{hint && <small>{hint}</small>}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <i aria-hidden="true" />
    </label>
  );
}

export function SampleTag({ children = "Sample data" }: { children?: ReactNode }) {
  return <span className="sample-tag">{children}</span>;
}
