import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { revealInScroll } from '../src/ui/revealInScroll';

/**
 * NATIVE-MEMBER-1 W16-8 (MF-12). Goal setup's scroll-to-first-error measured
 * against `scroll.getInnerViewNode()`, a numeric node handle that the new
 * architecture (Fabric) cannot measure against: the call failed silently and
 * the form never scrolled. It now measures against `getInnerViewRef()`, the
 * content's host instance (src/ui/revealInScroll.ts), and nothing in the app
 * may call getInnerViewNode again.
 */

describe('revealInScroll (MF-12)', () => {
  const HOST = { kind: 'host instance of the scroll content' };

  it('measures against the host instance, never a number, and scrolls the anchor 12 pt below the top', () => {
    const scrollTo = vi.fn();
    const measureLayout = vi.fn((relativeTo: unknown, ok: (x: number, y: number) => void) => ok(0, 300));
    revealInScroll({ getInnerViewRef: () => HOST, scrollTo }, { measureLayout } as never);
    expect(measureLayout).toHaveBeenCalledTimes(1);
    expect(measureLayout.mock.calls[0]![0]).toBe(HOST);
    expect(typeof measureLayout.mock.calls[0]![0]).not.toBe('number');
    expect(scrollTo).toHaveBeenCalledWith({ y: 288, animated: true });
  });

  it('never scrolls above the top', () => {
    const scrollTo = vi.fn();
    revealInScroll({ getInnerViewRef: () => HOST, scrollTo }, { measureLayout: (_r: unknown, ok: (x: number, y: number) => void) => ok(0, 5) } as never);
    expect(scrollTo).toHaveBeenCalledWith({ y: 0, animated: true });
  });

  it('does nothing without a content instance, and a failed measurement scrolls nothing', () => {
    const scrollTo = vi.fn();
    const measureLayout = vi.fn();
    revealInScroll({ getInnerViewRef: () => null, scrollTo }, { measureLayout } as never);
    revealInScroll({ scrollTo }, { measureLayout } as never);
    expect(measureLayout).not.toHaveBeenCalled();
    revealInScroll(
      { getInnerViewRef: () => HOST, scrollTo },
      { measureLayout: (_r: unknown, _ok: unknown, fail: () => void) => fail() } as never,
    );
    expect(scrollTo).not.toHaveBeenCalled();
  });
});

describe('Goal setup reveals its first refused field through it', () => {
  const src = readFileSync(resolve(__dirname, '../app/goals/new.tsx'), 'utf8');
  it('revealField calls revealInScroll with the scroll view and the anchor', () => {
    const start = src.indexOf('const revealField = useCallback(');
    expect(start).toBeGreaterThan(0);
    const body = src.slice(start, src.indexOf('[anchorRefs]', start));
    expect(body).toContain('revealInScroll(scroll, anchor);');
    expect(body).not.toContain('measureLayout');
  });
});

describe('scan: nothing in the app calls getInnerViewNode (MF-12)', () => {
  const ROOT = resolve(__dirname, '..');
  function files(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return files(path);
      return /\.(ts|tsx)$/.test(name) ? [path] : [];
    });
  }
  it('app/ and src/ never call it (a numeric handle Fabric cannot measure)', () => {
    const offenders = [...files(join(ROOT, 'app')), ...files(join(ROOT, 'src'))]
      .filter((f) => /\bgetInnerViewNode\s*\(/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(ROOT, f));
    expect(offenders).toEqual([]);
  });
});
