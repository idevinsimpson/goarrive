#!/usr/bin/env python3
"""Repro: start-of-workout cue overlap (workout_starting vs heres_whats_coming_up / intro).

Logs in on staging, opens Charlie Strength Workout, taps Start, records the
first 90s WITHOUT skipping. Captures [AUDIO-TRACE]/[VOICE-AUDIT] so we can see
whether two audio elements are audibly playing at the same time.
"""
import sys
import time
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "https://goarrive--staging-gurfzjak.web.app"
EMAIL = "Devin.Simpson@goa.fit"
PASSWORD = "1234567Ds!"

AUDIO_TRACE = r"""
(() => {
  const t0 = Date.now();
  const short = (u) => {
    if (!u) return '(no-src)';
    try { return decodeURIComponent(new URL(u).pathname).split('/').pop().slice(-70); }
    catch { return String(u).slice(0, 70); }
  };
  const active = new Set();
  const log = (ev, el, extra) => {
    console.info('[AUDIO-TRACE]', JSON.stringify({
      t: ((Date.now() - t0) / 1000).toFixed(2), ev, src: short(el.currentSrc || el.src),
      muted: el.muted, concurrent: [...active].map(short), ...extra,
    }));
  };
  const hook = (el) => {
    if (el.__hooked) return; el.__hooked = true;
    el.addEventListener('playing', () => { active.add(el.currentSrc || el.src); log('playing', el); });
    el.addEventListener('pause', () => { active.delete(el.currentSrc || el.src); log('pause', el); });
    el.addEventListener('ended', () => { active.delete(el.currentSrc || el.src); log('ended', el); });
    el.addEventListener('error', () => log('error', el, { code: el.error && el.error.code }));
  };
  const OrigPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...args) {
    hook(this); log('play()', this, { readyState: this.readyState });
    return OrigPlay.apply(this, args);
  };
})();
"""


def main():
    lines = []
    with sync_playwright() as p:
        browser = p.chromium.launch(args=[
            "--autoplay-policy=no-user-gesture-required",
            "--mute-audio",
        ])
        ctx = browser.new_context(viewport={"width": 390, "height": 844})
        page = ctx.new_page()
        page.add_init_script(AUDIO_TRACE)

        def on_console(msg):
            text = msg.text
            if any(k in text for k in ("[AUDIO-TRACE]", "[VOICE-AUDIT]", "[useWorkoutTTS]")):
                line = f"{time.strftime('%H:%M:%S')} {text}"
                lines.append(line)
                print(line, flush=True)

        page.on("console", on_console)

        print("== login ==", flush=True)
        page.goto(BASE + "/login", wait_until="domcontentloaded", timeout=60000)
        page.fill('input[type="email"], input[autocomplete="email"]', EMAIL, timeout=20000)
        page.fill('input[type="password"]', PASSWORD)
        page.click('text=/sign in|log in/i', timeout=5000)
        page.wait_for_timeout(8000)

        print("== build tab ==", flush=True)
        page.goto(BASE + "/build", wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(8000)

        print("== open workout ==", flush=True)
        page.click('text="Charlie Strength Workout"', timeout=10000)
        page.wait_for_timeout(4000)

        print("== find preview/play ==", flush=True)
        for sel in ['text=/^preview$/i', 'text=/preview workout/i', 'text=/^play$/i',
                    '[aria-label*="review" i]', 'text=/try it/i']:
            try:
                page.click(sel, timeout=4000)
                print(f"clicked: {sel}", flush=True)
                break
            except Exception:
                continue
        page.wait_for_timeout(4000)
        page.screenshot(path="/tmp/overlap-0-ready.png")

        print("== tap Start ==", flush=True)
        started = False
        for sel in ['[aria-label*="play" i]', '[aria-label*="start" i]', 'text=/^start/i']:
            try:
                page.click(sel, timeout=4000)
                started = True
                print(f"start tapped via {sel}", flush=True)
                break
            except Exception:
                continue
        if not started:
            page.mouse.click(195, 763)
            print("start tapped via coordinates", flush=True)

        print("== recording first 90s, no skips ==", flush=True)
        for i in range(9):
            page.wait_for_timeout(10000)
            page.screenshot(path=f"/tmp/overlap-{i+1}.png")
            print(f"-- t={10*(i+1)}s --", flush=True)

        with open("/tmp/repro-start-overlap-trace.log", "w") as f:
            f.write("\n".join(lines))
        print("trace written to /tmp/repro-start-overlap-trace.log", flush=True)
        browser.close()


if __name__ == "__main__":
    main()
