import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Dimensions, Platform, Pressable, StyleSheet } from 'react-native';
import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * W12-17 (INT-33): pressed feedback on a phone (kit.pressableStyle).
 *   · The web gets the base style itself, the same object: its DOM is
 *     unchanged (the tab bar's web DOM is also pinned to its pre-W12-8
 *     snapshot in member-tab-bar-text-scale).
 *   · A phone gets a style function that adds PRESSED only while
 *     pressed; Android adds a ripple in the given tint, iOS does not.
 *   · The integrator's controls use it: OptionRow, the tab destinations,
 *     MOVE, the hamburger and the menu rows.
 *   · A source scan: no ButtonLink and no <Link asChild> child receives it
 *     (Link merges the child's style by object spread).
 * No device.
 */
vi.mock('../src/firebase', () => ({ wsfIsStaging: false, getFirebaseAuth: () => ({}) }));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

const { PRESSED, pressableStyle, ACTION_GREEN_DEEP, OPTION_SELECTED_TINT } = await import('../src/ui/kit');
const { OptionRow } = await import('../src/ui/OptionRow');
const { MemberTabBar } = await import('../src/ui/MemberTabBar');
const { MemberTopBar } = await import('../src/ui/MemberTopBar');

let os: string;
let container: HTMLDivElement;
let root: Root;
const setOs = (v: string) => ((Platform as { OS: string }).OS = v);
const byId = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

beforeEach(() => {
  os = Platform.OS;
  vi.spyOn(Dimensions, 'get').mockReturnValue({ width: 390, height: 844, scale: 3, fontScale: 1 });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  setOs(os);
  vi.restoreAllMocks();
});

const BASE = [{ padding: 4 }, { backgroundColor: '#fff' }];

describe('pressableStyle', () => {
  it('web: the base style itself, the same object, and nothing else', () => {
    setOs('web');
    const out = pressableStyle(BASE, ACTION_GREEN_DEEP);
    expect(Object.keys(out)).toEqual(['style']);
    expect(out.style).toBe(BASE);
  });

  it('iOS: the pressed style only while pressed (cleared on release); no ripple', () => {
    setOs('ios');
    const out = pressableStyle(BASE, ACTION_GREEN_DEEP);
    expect(out).not.toHaveProperty('android_ripple');
    expect(typeof out.style).toBe('function');
    const at = (pressed: boolean) =>
      StyleSheet.flatten((out.style as (s: { pressed: boolean; hovered?: boolean }) => never)({ pressed })) as Record<string, unknown>;
    expect(at(false)).toEqual({ padding: 4, backgroundColor: '#fff' });
    expect(at(true)).toEqual({ padding: 4, backgroundColor: '#fff', opacity: 0.72 });
    expect(PRESSED).toEqual({ opacity: 0.72 });
  });

  it('Android: the same, plus a ripple in the tint', () => {
    setOs('android');
    const out = pressableStyle(BASE, OPTION_SELECTED_TINT);
    expect(out.android_ripple).toEqual({ color: OPTION_SELECTED_TINT });
    expect(typeof out.style).toBe('function');
  });
});

describe('the integrator\'s controls use it', () => {
  type Fiber = { type: unknown; return: Fiber | null; alternate: Fiber | null; memoizedProps: Record<string, unknown> };
  /** The props the Pressable that rendered `el` was given. */
  function pressableProps(el: Element): Record<string, unknown> {
    const own = el as unknown as Record<string, unknown>;
    const fiberKey = Object.keys(el).find((k) => k.startsWith('__reactFiber$'))!;
    let fiber = own[fiberKey] as Fiber;
    while (fiber && fiber.type !== Pressable) fiber = fiber.return as Fiber;
    if (!fiber) throw new Error('no Pressable above the element');
    return fiber.memoizedProps;
  }
  function renderAll() {
    act(() =>
      root.render(
        <>
          <OptionRow label="Private" selected={false} onPress={() => undefined} testID="opt" />
          <MemberTopBar
            onHome={() => undefined}
            menu={[{ kind: 'action', key: 'settings', label: 'Settings', onPress: () => undefined }]}
            menuOpen
            onMenuToggle={() => undefined}
          />
          <MemberTabBar
            state={{ index: 0, routes: [{ key: 'h', name: '(home)' }, { key: 'c', name: 'community' }, { key: 'a', name: 'activity' }, { key: 'y', name: 'you' }] } as never}
            navigation={{ emit: () => ({ defaultPrevented: false }), navigate: () => undefined } as never}
            descriptors={{} as never}
            insets={{ top: 0, bottom: 0, left: 0, right: 0 }}
            onMove={() => undefined}
          />
        </>,
      ),
    );
  }
  const CONTROLS: Array<[string, string]> = [
    ['opt', OPTION_SELECTED_TINT],
    ['wsf-member-topbar-menu-button', OPTION_SELECTED_TINT],
    ['wsf-member-topbar-menu-settings', OPTION_SELECTED_TINT],
    ['wsf-member-tab-home', OPTION_SELECTED_TINT],
    ['wsf-member-tab-move', ACTION_GREEN_DEEP],
  ];

  it('Android: each takes a pressed-style function and its ripple', () => {
    setOs('android');
    renderAll();
    for (const [id, tint] of CONTROLS) {
      const props = pressableProps(byId(id)!);
      expect(typeof props.style, id).toBe('function');
      expect(props.android_ripple, id).toEqual({ color: tint });
    }
  });

  it('iOS: each takes the pressed-style function; no ripple', () => {
    setOs('ios');
    renderAll();
    for (const [id] of CONTROLS) {
      const props = pressableProps(byId(id)!);
      expect(typeof props.style, id).toBe('function');
      expect(props.android_ripple, id).toBeUndefined();
    }
  });

  it('web: each takes a plain style and no ripple', () => {
    setOs('web');
    renderAll();
    for (const [id] of CONTROLS) {
      const props = pressableProps(byId(id)!);
      expect(typeof props.style, id).not.toBe('function');
      expect(props, id).not.toHaveProperty('android_ripple');
    }
  });
});

describe('never on a ButtonLink or a <Link asChild> child', () => {
  const APP_ROOT = join(__dirname, '..');
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (entry.endsWith('.tsx')) out.push(full);
    }
    return out;
  };
  const usesPressableStyle = (attrs: ts.JsxAttributes) =>
    attrs.properties.some((a) => /\bpressableStyle\s*\(/.test(a.getText()));
  const tagOf = (n: ts.JsxElement | ts.JsxSelfClosingElement) => (ts.isJsxElement(n) ? n.openingElement : n);
  /** Each ButtonLink, and each first element inside a <Link asChild>, that receives pressableStyle. */
  function offenders(file: string, text: string): string[] {
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const out: string[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tag = tagOf(node);
        const name = tag.tagName.getText();
        if (name === 'ButtonLink' && usesPressableStyle(tag.attributes)) out.push(`${file}: ButtonLink`);
        const asChild = tag.attributes.properties.some((a) => ts.isJsxAttribute(a) && a.name.getText() === 'asChild');
        if (name === 'Link' && asChild && ts.isJsxElement(node)) {
          for (const child of node.children) {
            if ((ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) && usesPressableStyle(tagOf(child).attributes)) {
              out.push(`${file}: <Link asChild> child`);
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    return out;
  }

  it('the scan catches both shapes', () => {
    expect(offenders('x.tsx', '<ButtonLink href="/" {...pressableStyle(s, t)} />')).toHaveLength(1);
    expect(offenders('x.tsx', '<Link href="/" asChild><Pressable {...pressableStyle(s, t)} /></Link>')).toHaveLength(1);
    expect(offenders('x.tsx', '<Link href="/" asChild><Pressable style={s} /></Link>')).toEqual([]);
    expect(offenders('x.tsx', '<Pressable {...pressableStyle(s, t)} />')).toEqual([]);
  });

  it('app/ and src/: none', () => {
    const files = [...walk(join(APP_ROOT, 'app')), ...walk(join(APP_ROOT, 'src'))];
    expect(files.length).toBeGreaterThan(50);
    const found = files.flatMap((f) => offenders(relative(APP_ROOT, f), readFileSync(f, 'utf8')));
    expect(found).toEqual([]);
    // The sites that do use it are where they should be.
    const users = files.filter((f) => /\bpressableStyle\s*\(/.test(readFileSync(f, 'utf8'))).map((f) => relative(APP_ROOT, f)).sort();
    expect(users).toEqual(['src/ui/MemberTabBar.tsx', 'src/ui/MemberTopBar.tsx', 'src/ui/OptionRow.tsx']);
  }, 60_000);
});
