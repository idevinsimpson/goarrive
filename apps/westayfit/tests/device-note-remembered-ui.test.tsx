import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { bootNative, createFakeAsyncStorage, flush, type FakeAsyncStorage } from './nativeStorageHarness';

/**
 * NATIVE-MEMBER-1 W16-3 ST-04. The device question's note says the answer "is
 * remembered on this device only". On a phone that is true only while the
 * device kept the last answer and can read it (state's
 * deviceModeMayBeRemembered, W13-3). DeviceChoice shows the note only then,
 * and follows it as it changes: a refused save hides it, and a kept save
 * brings it back. On the web the note always stays.
 *
 * Native cases run over state's native storage harness (the real kv.native
 * and syncRead.native over a fake AsyncStorage: a simulated process start),
 * so this is not a device run. Both variants of the question are rendered.
 *
 * RV14-642-N2: rendered before the launch read has answered, the note waits:
 * hidden until the read lands, then shown if the answer can be remembered,
 * and never shown (no flash on the first render) when the store is
 * unreadable.
 */

let disk: FakeAsyncStorage;
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  disk = createFakeAsyncStorage();
  window.localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  act(() => root.unmount());
  container.remove();
  const { Platform } = await import('react-native');
  (Platform as { OS: string }).OS = 'web';
  for (const m of [
    '@react-native-async-storage/async-storage',
    '../src/storage/kv',
    '../src/storage/sessionKv',
    '../src/storage/syncRead',
    '../src/firebase',
    'firebase/auth',
  ]) {
    vi.doUnmock(m);
  }
  vi.resetModules();
});

const note = (id: string) => container.querySelector(`[data-testid="${id}-note"]`);

async function launchNative() {
  bootNative(disk);
  const { Platform } = await import('react-native');
  (Platform as { OS: string }).OS = 'ios';
  const dm = await import('../src/deviceMode');
  await dm.deviceModeReady();
  const { DeviceChoice } = await import('../src/ui/DeviceChoice');
  return { dm, DeviceChoice };
}

/** A process start whose launch read is held: the question is rendered before the device has answered. */
async function launchNativeBeforeRead() {
  const release = disk.holdReads();
  bootNative(disk);
  const { Platform } = await import('react-native');
  (Platform as { OS: string }).OS = 'ios';
  const dm = await import('../src/deviceMode');
  const { DeviceChoice } = await import('../src/ui/DeviceChoice');
  return { dm, DeviceChoice, release };
}

describe.each(['legacy', 'sheet'] as const)('W16-3 ST-04: the device note (%s), on a phone', (variant) => {
  const id = `wsf-dc-${variant}`;

  it('shown while the answer can be remembered; hidden once the device refuses the save; back once a save is kept', async () => {
    const { dm, DeviceChoice } = await launchNative();
    act(() => root.render(<DeviceChoice onChoosePersonal={() => {}} onChooseShared={() => {}} variant={variant} testID={id} />));
    expect(note(id)).not.toBeNull();
    disk.state.failWrites = true;
    await act(async () => {
      expect(await dm.saveDeviceMode('shared')).toBe(false);
      await flush();
    });
    expect(dm.deviceModeMayBeRemembered()).toBe(false);
    expect(note(id)).toBeNull();
    disk.state.failWrites = false;
    await act(async () => {
      expect(await dm.saveDeviceMode('shared')).toBe(true);
      await flush();
    });
    expect(note(id)).not.toBeNull();
  });

  it('RV14-642-N2: rendered before the launch read answers, hidden until it does; then shown', async () => {
    const { dm, DeviceChoice, release } = await launchNativeBeforeRead();
    act(() => root.render(<DeviceChoice onChoosePersonal={() => {}} onChooseShared={() => {}} variant={variant} testID={id} />));
    expect(dm.isDeviceModeReady()).toBe(false);
    expect(note(id)).toBeNull();
    await act(async () => {
      release();
      await dm.deviceModeReady();
      await flush();
    });
    expect(dm.isDeviceModeReady()).toBe(true);
    expect(note(id)?.textContent).toBe(dm.DEVICE_CHOICE_NOTE);
  });

  it('RV14-642-N2: rendered before the launch read answers, with the store unreadable: never shown, not even on the first render', async () => {
    disk.map.set('wsf.deviceMode', 'shared');
    disk.state.failReads = true;
    const { dm, DeviceChoice, release } = await launchNativeBeforeRead();
    const seen: boolean[] = [];
    act(() => root.render(<DeviceChoice onChoosePersonal={() => {}} onChooseShared={() => {}} variant={variant} testID={id} />));
    seen.push(note(id) !== null);
    await act(async () => {
      release();
      await dm.deviceModeReady();
      await flush();
    });
    seen.push(note(id) !== null);
    expect(dm.isDeviceModeReady()).toBe(true);
    expect(dm.deviceModeMayBeRemembered()).toBe(false);
    expect(seen).toEqual([false, false]);
  });

  it('never shown while the stored answer cannot be read', async () => {
    disk.map.set('wsf.deviceMode', 'shared');
    disk.state.failReads = true;
    const { dm, DeviceChoice } = await launchNative();
    expect(dm.deviceModeMayBeRemembered()).toBe(false);
    act(() => root.render(<DeviceChoice onChoosePersonal={() => {}} onChooseShared={() => {}} variant={variant} testID={id} />));
    expect(note(id)).toBeNull();
  });
});

describe('W16-3 ST-04: the web keeps the note', () => {
  it.each(['legacy', 'sheet'] as const)('%s: the note is there, with its words (deviceModeMayBeRemembered is always true)', async (variant) => {
    vi.resetModules();
    const dm = await import('../src/deviceMode');
    const { DeviceChoice } = await import('../src/ui/DeviceChoice');
    expect(dm.deviceModeMayBeRemembered()).toBe(true);
    act(() => root.render(<DeviceChoice onChoosePersonal={() => {}} onChooseShared={() => {}} variant={variant} testID="wsf-dc" />));
    expect(note('wsf-dc')?.textContent).toBe(dm.DEVICE_CHOICE_NOTE);
  });
});
