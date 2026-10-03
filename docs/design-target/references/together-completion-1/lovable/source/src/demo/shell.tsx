import { Activity, BarChart3, CircleUserRound, Home as HomeIcon, Menu, Users } from "lucide-react";
import { Component, createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import wordmark from "../assets/wordmark-navy-green.png.asset.json";
import { DemoProvider, useDemo } from "./store";
import { HomeScreen } from "./screens/home";
import { CommunityScreen } from "./screens/community";
import { ProgressScreen } from "./screens/progress";
import { YouScreen } from "./screens/you";
import { OverlayHost } from "./overlays";

export type Tab = "home" | "community" | "progress" | "you";
export type OverlayKind = "menu" | "members" | "privacy" | "move" | "join" | "start" | "goal" | "manage" | "expo" | "tools" | "coverage" | "receipt" | "share";
export interface OverlayParams { communityId?: string | undefined; mode?: "start" | "already" | undefined; id?: string | undefined }
export interface OverlayState { kind: OverlayKind; params?: OverlayParams | undefined }

interface NavCtx {
  tab: Tab; goTab: (t: Tab) => void;
  overlay: OverlayState | null;
  open: (kind: OverlayKind, params?: OverlayParams, trigger?: HTMLElement | null) => void;
  close: (after?: () => void) => void;
  toast: (msg: string) => void; announce: (msg: string) => void;
}
const Nav = createContext<NavCtx | null>(null);
export const useNav = () => { const v = useContext(Nav); if (!v) throw new Error("useNav"); return v; };

export const EXIT_MS = 180;

const TABS: { id: Tab; label: string; icon: typeof HomeIcon }[] = [
  { id: "home", label: "Home", icon: HomeIcon }, { id: "community", label: "Community", icon: Users },
  { id: "progress", label: "Progress", icon: BarChart3 }, { id: "you", label: "You", icon: CircleUserRound },
];

export function PrototypeApp() {
  return <Recovery><DemoProvider><Shell /></DemoProvider></Recovery>;
}

/** If a persisted sample reference is missing at render time, show an honest reset view instead of broken screens. */
class Recovery extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="recovery" role="alert">
        <img className="wordmark" src={wordmark.url} alt="WE STAY FIT" />
        <h1>This sample session couldn’t be read</h1>
        <p>The locally saved prototype state is incomplete. Resetting starts a fresh fictional sample session. No real data is involved.</p>
        <button type="button" className="primary-action" onClick={() => { localStorage.removeItem("wsf-proto-state-v4"); this.setState({ failed: false }); window.location.reload(); }}>Reset sample session</button>
      </div>
    );
  }
}

function Shell() {
  const [tab, setTab] = useState<Tab>("home");
  const [overlay, setOverlay] = useState<OverlayState | null>(null);
  const [toastMsg, setToastMsg] = useState("");
  const [live, setLive] = useState("");
  const scrolls = useRef<Record<Tab, number>>({ home: 0, community: 0, progress: 0, you: 0 });
  const pendingTab = useRef<Tab | null>(null);
  const origin = useRef<{ trigger: HTMLElement | null; scroll: number } | null>(null);
  const pushed = useRef(false);
  const bg = useRef<HTMLDivElement>(null);

  const goTab = useCallback((t: Tab) => {
    setTab((cur) => {
      if (cur === t) return cur; // active reselect: true no-op
      scrolls.current[cur] = window.scrollY;
      pendingTab.current = t;
      return t;
    });
  }, []);
  useLayoutEffect(() => {
    if (pendingTab.current === tab) { window.scrollTo({ top: scrolls.current[tab], behavior: "instant" }); pendingTab.current = null; }
  }, [tab]);

  // Exit motion: overlay stays mounted (background inert, focus contained) while it plays; a timer — not animationend — guarantees completion.
  const [closing, setClosing] = useState(false);
  const closeTimer = useRef<number | null>(null);
  const finishClose = useCallback((after?: () => void) => {
    if (closeTimer.current !== null) return; // already dismissing: rapid Close/Escape/Back collapse into one exit
    const done = () => {
      closeTimer.current = null;
      setClosing(false);
      const o = origin.current;
      origin.current = null;
      setOverlay(null);
      requestAnimationFrame(() => {
        after?.();
        requestAnimationFrame(() => {
          const logicalFallback = document.querySelector<HTMLElement>('.bottom-nav [aria-current="page"]');
          if (o && !after) window.scrollTo({ top: o.scroll, behavior: "instant" });
          const target = after ? logicalFallback : o?.trigger?.isConnected ? o.trigger : logicalFallback;
          target?.focus({ preventScroll: true });
          if (target && document.activeElement !== target) logicalFallback?.focus({ preventScroll: true });
          if (o && !after) window.scrollTo({ top: o.scroll, behavior: "instant" });
        });
      });
    };
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) { closeTimer.current = -1; done(); return; }
    setClosing(true);
    closeTimer.current = window.setTimeout(done, EXIT_MS);
  }, []);

  const open = useCallback((kind: OverlayKind, params?: OverlayParams, trigger?: HTMLElement | null) => {
    if (closeTimer.current === -1) closeTimer.current = null; // a prior reduced-motion close completed synchronously
    if (closeTimer.current !== null) { window.clearTimeout(closeTimer.current); closeTimer.current = null; setClosing(false); } // interrupted exit
    if (!origin.current) origin.current = { trigger: trigger ?? (document.activeElement as HTMLElement | null), scroll: window.scrollY };
    if (!pushed.current) { window.history.pushState({ ...(window.history.state ?? {}), wsfOverlay: true }, ""); pushed.current = true; }
    setOverlay({ kind, params });
  }, []);

  const afterRef = useRef<(() => void) | undefined>(undefined);
  const backPending = useRef(false);
  const close = useCallback((after?: () => void) => {
    if (backPending.current || closeTimer.current !== null) return; // one dismissal at a time; never double history.back()
    if (pushed.current) { backPending.current = true; afterRef.current = after; window.history.back(); }
    else finishClose(after);
  }, [finishClose]);

  useEffect(() => {
    const onPop = () => {
      if (pushed.current || backPending.current) { pushed.current = false; backPending.current = false; const a = afterRef.current; afterRef.current = undefined; finishClose(a); }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [finishClose]);

  useEffect(() => {
    const el = bg.current;
    if (!el) return;
    if (overlay) { el.setAttribute("inert", ""); document.body.style.overflow = "hidden"; }
    else { el.removeAttribute("inert"); document.body.style.overflow = ""; }
  }, [overlay]);

  const toast = useCallback((m: string) => { setToastMsg(m); window.setTimeout(() => setToastMsg(""), 2600); }, []);
  const announce = useCallback((m: string) => { setLive(""); requestAnimationFrame(() => setLive(m)); }, []);

  const { recovered } = useDemo();
  useEffect(() => { if (recovered) toast("Saved sample session was out of date, so a fresh sample session started."); }, [recovered, toast]);

  const value: NavCtx = { tab, goTab, overlay, open, close, toast, announce };

  return (
    <Nav.Provider value={value}>
      <div className="app-root" data-overlay-closing={closing ? "" : undefined}>
        <div ref={bg} className="app-bg">
          <div className="proto-band"><strong>PROPOSED</strong> Design prototype · Sample data</div>
          <div className="member-app">
            <header className="topbar">
              <img className="wordmark" src={wordmark.url} alt="WE STAY FIT" />
              <button className="icon-button" type="button" aria-label="Open menu" onClick={(e) => open("menu", undefined, e.currentTarget)}><Menu aria-hidden="true" /></button>
            </header>
            <main className="tab-stage">
              <section hidden={tab !== "home"} aria-label="Home"><HomeScreen /></section>
              <section hidden={tab !== "community"} aria-label="Community"><CommunityScreen /></section>
              <section hidden={tab !== "progress"} aria-label="Progress"><ProgressScreen /></section>
              <section hidden={tab !== "you"} aria-label="You"><YouScreen /></section>
            </main>
            <nav className="bottom-nav" aria-label="Primary navigation">
              {TABS.slice(0, 2).map((t) => <TabButton key={t.id} t={t} active={tab === t.id} onClick={() => goTab(t.id)} />)}
              <button className="move-button" type="button" aria-label="MOVE — add a contribution" onClick={(e) => open("move", { mode: "start" }, e.currentTarget)}><Activity aria-hidden="true" /><span>MOVE</span></button>
              {TABS.slice(2).map((t) => <TabButton key={t.id} t={t} active={tab === t.id} onClick={() => goTab(t.id)} />)}
            </nav>
          </div>
          {toastMsg && <div className="prototype-toast" role="status">{toastMsg}</div>}
        </div>
        <div className="sr-only" aria-live="polite">{live}</div>
        {overlay && <OverlayHost overlay={overlay} />}
      </div>
    </Nav.Provider>
  );
}

function TabButton({ t, active, onClick }: { t: (typeof TABS)[number]; active: boolean; onClick: () => void }) {
  const Icon = t.icon;
  return (
    <button className={`nav-item ${active ? "active" : ""}`} type="button" data-tab={t.id} aria-current={active ? "page" : undefined} onClick={onClick}>
      <Icon aria-hidden="true" /><span>{t.label}</span>
    </button>
  );
}

export function ScreenPad({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`screen ${className}`}>{children}</div>;
}
