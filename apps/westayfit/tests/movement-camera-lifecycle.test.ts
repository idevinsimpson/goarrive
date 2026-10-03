import { describe, expect, it, vi } from 'vitest';

import type { PoseEstimator } from '../src/movement/adapter';
import type { PoseFrame } from '../src/movement/types';
import { MovementCameraLifecycle } from '../src/movement/web/cameraLifecycle';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

class FakeTrack extends EventTarget {
  readonly kind = 'video';
  readyState: MediaStreamTrackState = 'live';
  stop = vi.fn(() => { this.readyState = 'ended'; });
  end() {
    this.readyState = 'ended';
    this.dispatchEvent(new Event('ended'));
  }
}

function fakeStream(tracks = [new FakeTrack()]) {
  return {
    tracks,
    stream: { getTracks: () => tracks, getVideoTracks: () => tracks } as unknown as MediaStream,
  };
}

class FakeVideo extends EventTarget {
  srcObject: MediaStream | null = null;
  readyState = 2;
  currentTime = 0;
  videoWidth = 640;
  videoHeight = 480;
  error: Error | null = null;
  play = vi.fn(() => Promise.resolve());
  pause = vi.fn();
}

function fakeEstimator() {
  return {
    engine: 'test pose engine',
    maxPoses: 3,
    estimate: vi.fn((_input: unknown, now: number): PoseFrame => ({ timestampMs: now, poses: [] })),
    close: vi.fn(),
  };
}

function callbacks() {
  return { onLoading: vi.fn(), onReady: vi.fn(), onFrame: vi.fn(), onError: vi.fn() };
}

function harness() {
  const video = new FakeVideo();
  const cameraRequests: ReturnType<typeof deferred<MediaStream>>[] = [];
  const modelRequests: ReturnType<typeof deferred<PoseEstimator>>[] = [];
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrameId = 0;
  const getVideo = vi.fn(() => video as unknown as HTMLVideoElement | null);
  const lifecycle = new MovementCameraLifecycle({
    getVideo,
    getUserMedia: () => {
      const request = deferred<MediaStream>();
      cameraRequests.push(request);
      return request.promise;
    },
    createEstimator: () => {
      const request = deferred<PoseEstimator>();
      modelRequests.push(request);
      return request.promise;
    },
    requestFrame: (callback) => {
      const id = ++nextFrameId;
      frames.set(id, callback);
      return id;
    },
    cancelFrame: (id) => { frames.delete(id); },
  });
  function takeFrame() {
    const entry = frames.entries().next().value;
    if (!entry) throw new Error('No frame is scheduled.');
    const [id, callback] = entry;
    frames.delete(id);
    return callback;
  }
  return { lifecycle, video, getVideo, cameraRequests, modelRequests, frames, takeFrame };
}

/** Permission resolution and play() each cross a microtask before model init. */
async function grant(h: ReturnType<typeof harness>, index = 0, stream = fakeStream()) {
  h.cameraRequests[index].resolve(stream.stream);
  await Promise.resolve();
  await Promise.resolve();
  return stream;
}

async function running(h = harness()) {
  const events = callbacks();
  const task = h.lifecycle.startCamera(events);
  const stream = await grant(h);
  const estimator = fakeEstimator();
  h.modelRequests[0].resolve(estimator);
  await task;
  return { ...h, events, stream, estimator };
}

describe('camera lifecycle — actual I/O owner used by the web lab', () => {
  it('runs one frame loop, processes each new video frame once, and Stop releases the stream and engine', async () => {
    const h = await running();
    expect(h.events.onReady).toHaveBeenCalledWith(h.estimator.engine);
    expect(h.video.srcObject).toBe(h.stream.stream);
    expect(h.frames.size).toBe(1);
    h.takeFrame()(1000);
    h.takeFrame()(1016);
    expect(h.estimator.estimate).toHaveBeenCalledTimes(1);
    h.video.currentTime = 1;
    h.takeFrame()(1032);
    expect(h.events.onFrame).toHaveBeenCalledTimes(2);
    expect(h.frames.size).toBe(1);

    h.lifecycle.stop();
    expect(h.lifecycle.active).toBe(false);
    expect(h.frames.size).toBe(0);
    expect(h.video.srcObject).toBeNull();
    expect(h.stream.tracks[0].stop).toHaveBeenCalledTimes(1);
    expect(h.estimator.close).toHaveBeenCalledTimes(1);
  });

  it('stops every late-granted track after cancellation while permission was pending', async () => {
    const h = harness();
    const events = callbacks();
    const task = h.lifecycle.startCamera(events);
    h.lifecycle.stop();
    const stream = fakeStream([new FakeTrack(), new FakeTrack()]);
    h.cameraRequests[0].resolve(stream.stream);
    await task;

    for (const track of stream.tracks) expect(track.stop).toHaveBeenCalledTimes(1);
    expect(h.video.play).not.toHaveBeenCalled();
    expect(h.modelRequests).toHaveLength(0);
    expect(events.onReady).not.toHaveBeenCalled();
    expect(events.onError).not.toHaveBeenCalled();
    expect(h.frames.size).toBe(0);
  });

  it('releases the camera immediately during pending playback and never starts a late model', async () => {
    const h = harness();
    const playback = deferred<void>();
    h.video.play.mockReturnValueOnce(playback.promise);
    const events = callbacks();
    const task = h.lifecycle.startCamera(events);
    const stream = await grant(h);
    expect(h.video.srcObject).toBe(stream.stream);
    h.lifecycle.stop();
    expect(stream.tracks[0].stop).toHaveBeenCalledTimes(1);
    playback.resolve();
    await task;

    expect(h.video.srcObject).toBeNull();
    expect(h.modelRequests).toHaveLength(0);
    expect(events.onReady).not.toHaveBeenCalled();
    expect(h.frames.size).toBe(0);
  });

  it('closes a model that resolves after cancellation and does not schedule a loop', async () => {
    const h = harness();
    const events = callbacks();
    const task = h.lifecycle.startCamera(events);
    const stream = await grant(h);
    expect(h.modelRequests).toHaveLength(1);
    h.lifecycle.stop();
    const estimator = fakeEstimator();
    h.modelRequests[0].resolve(estimator);
    await task;

    expect(stream.tracks[0].stop).toHaveBeenCalledTimes(1);
    expect(estimator.close).toHaveBeenCalledTimes(1);
    expect(events.onReady).not.toHaveBeenCalled();
    expect(events.onError).not.toHaveBeenCalled();
    expect(h.frames.size).toBe(0);
  });

  it('keeps only the newest of two pending starts even if the older grant arrives last', async () => {
    const h = harness();
    const oldEvents = callbacks();
    const old = h.lifecycle.startCamera(oldEvents);
    const newEvents = callbacks();
    const current = h.lifecycle.startCamera(newEvents);
    const currentStream = await grant(h, 1);
    const estimator = fakeEstimator();
    h.modelRequests[0].resolve(estimator);
    await current;
    const oldStream = await grant(h, 0);
    await old;

    expect(oldStream.tracks[0].stop).toHaveBeenCalledTimes(1);
    expect(oldEvents.onReady).not.toHaveBeenCalled();
    expect(h.video.srcObject).toBe(currentStream.stream);
    expect(currentStream.tracks[0].stop).not.toHaveBeenCalled();
    expect(estimator.close).not.toHaveBeenCalled();
    expect(h.frames.size).toBe(1);
    h.lifecycle.stop();
    expect(currentStream.tracks[0].stop).toHaveBeenCalledTimes(1);
    expect(h.frames.size).toBe(0);
  });

  it('a superseded model resolves without closing or detaching the newer camera', async () => {
    const h = harness();
    const oldEvents = callbacks();
    const old = h.lifecycle.startCamera(oldEvents);
    const oldStream = await grant(h);
    const currentEvents = callbacks();
    const current = h.lifecycle.startCamera(currentEvents);
    const currentStream = await grant(h, 1);
    const currentEstimator = fakeEstimator();
    h.modelRequests[1].resolve(currentEstimator);
    await current;
    const oldEstimator = fakeEstimator();
    h.modelRequests[0].resolve(oldEstimator);
    await old;

    expect(oldStream.tracks[0].stop).toHaveBeenCalledTimes(1);
    expect(oldEstimator.close).toHaveBeenCalledTimes(1);
    expect(oldEvents.onReady).not.toHaveBeenCalled();
    expect(h.video.srcObject).toBe(currentStream.stream);
    expect(currentEstimator.close).not.toHaveBeenCalled();
    expect(h.frames.size).toBe(1);
  });

  it('switching to synthetic owns the loop even when permission resolves afterwards', async () => {
    const h = harness();
    const events = callbacks();
    const task = h.lifecycle.startCamera(events);
    const syntheticFrame = vi.fn();
    h.lifecycle.startSynthetic(syntheticFrame, vi.fn());
    const stream = await grant(h);
    await task;
    h.takeFrame()(1000);

    expect(stream.tracks[0].stop).toHaveBeenCalledTimes(1);
    expect(syntheticFrame).toHaveBeenCalledWith(1000);
    expect(events.onReady).not.toHaveBeenCalled();
    expect(events.onFrame).not.toHaveBeenCalled();
    expect(h.video.srcObject).toBeNull();
    expect(h.frames.size).toBe(1);
  });

  it('ignores a cancelled camera callback already delivered to the event queue after switching source', async () => {
    const h = await running();
    const oldFrame = h.takeFrame();
    const syntheticFrame = vi.fn();
    h.lifecycle.startSynthetic(syntheticFrame, vi.fn());
    oldFrame(1000);

    expect(h.estimator.estimate).not.toHaveBeenCalled();
    expect(h.estimator.close).toHaveBeenCalledTimes(1);
    expect(h.stream.tracks[0].stop).toHaveBeenCalledTimes(1);
    expect(h.frames.size).toBe(1);
    h.takeFrame()(1016);
    expect(syntheticFrame).toHaveBeenCalledTimes(1);
  });

  it('ignores a queued synthetic callback when a new camera start takes over', async () => {
    const h = harness();
    const syntheticFrame = vi.fn();
    h.lifecycle.startSynthetic(syntheticFrame, vi.fn());
    const oldFrame = h.takeFrame();
    const events = callbacks();
    const task = h.lifecycle.startCamera(events);
    oldFrame(1000);
    expect(syntheticFrame).not.toHaveBeenCalled();
    expect(h.frames.size).toBe(0);
    await grant(h);
    h.modelRequests[0].resolve(fakeEstimator());
    await task;
    expect(h.frames.size).toBe(1);
  });

  it('ends a denied permission request without entering playback or model initialization', async () => {
    const h = harness();
    const events = callbacks();
    const task = h.lifecycle.startCamera(events);
    const error = Object.assign(new Error('permission denied'), { name: 'NotAllowedError' });
    h.cameraRequests[0].reject(error);
    await task;

    expect(events.onError).toHaveBeenCalledWith('permission', error);
    expect(h.lifecycle.active).toBe(false);
    expect(h.video.play).not.toHaveBeenCalled();
    expect(h.modelRequests).toHaveLength(0);
    expect(h.frames.size).toBe(0);
  });

  it('does not report a superseded permission rejection into the new camera session', async () => {
    const h = harness();
    const oldEvents = callbacks();
    const old = h.lifecycle.startCamera(oldEvents);
    const events = callbacks();
    const task = h.lifecycle.startCamera(events);
    const stream = await grant(h, 1);
    h.modelRequests[0].resolve(fakeEstimator());
    await task;
    h.cameraRequests[0].reject(new Error('old permission failed'));
    await old;

    expect(oldEvents.onError).not.toHaveBeenCalled();
    expect(events.onError).not.toHaveBeenCalled();
    expect(h.video.srcObject).toBe(stream.stream);
    expect(stream.tracks[0].stop).not.toHaveBeenCalled();
    expect(h.frames.size).toBe(1);
  });

  it('treats rejected playback as a failure and stops the camera before model loading', async () => {
    const h = harness();
    const error = new Error('playback refused');
    h.video.play.mockRejectedValueOnce(error);
    const events = callbacks();
    const task = h.lifecycle.startCamera(events);
    const stream = await grant(h);
    await task;

    expect(events.onError).toHaveBeenCalledWith('playback', error);
    expect(h.lifecycle.active).toBe(false);
    expect(stream.tracks[0].stop).toHaveBeenCalledTimes(1);
    expect(h.video.srcObject).toBeNull();
    expect(h.modelRequests).toHaveLength(0);
  });

  it('ignores an old playback rejection after another camera has started', async () => {
    const h = harness();
    const playback = deferred<void>();
    h.video.play.mockReturnValueOnce(playback.promise);
    const oldEvents = callbacks();
    const old = h.lifecycle.startCamera(oldEvents);
    await grant(h);
    const events = callbacks();
    const task = h.lifecycle.startCamera(events);
    const stream = await grant(h, 1);
    h.modelRequests[0].resolve(fakeEstimator());
    await task;
    playback.reject(new Error('old playback failed'));
    await old;

    expect(oldEvents.onError).not.toHaveBeenCalled();
    expect(h.video.srcObject).toBe(stream.stream);
    expect(stream.tracks[0].stop).not.toHaveBeenCalled();
    expect(h.frames.size).toBe(1);
  });

  it('stops the stream on model failure and allows an explicit fresh start', async () => {
    const h = harness();
    const events = callbacks();
    const task = h.lifecycle.startCamera(events);
    const stream = await grant(h);
    const error = new Error('model unavailable');
    h.modelRequests[0].reject(error);
    await task;

    expect(events.onError).toHaveBeenCalledWith('model', error);
    expect(stream.tracks[0].stop).toHaveBeenCalledTimes(1);
    expect(h.frames.size).toBe(0);
    const retryEvents = callbacks();
    const retry = h.lifecycle.startCamera(retryEvents);
    await grant(h, 1);
    h.modelRequests[1].resolve(fakeEstimator());
    await retry;
    expect(retryEvents.onReady).toHaveBeenCalledTimes(1);
    expect(h.frames.size).toBe(1);
  });

  it('ignores an obsolete model rejection without stopping the current run', async () => {
    const h = harness();
    const oldEvents = callbacks();
    const old = h.lifecycle.startCamera(oldEvents);
    await grant(h);
    const events = callbacks();
    const task = h.lifecycle.startCamera(events);
    const stream = await grant(h, 1);
    const estimator = fakeEstimator();
    h.modelRequests[1].resolve(estimator);
    await task;
    h.modelRequests[0].reject(new Error('obsolete model failed'));
    await old;

    expect(oldEvents.onError).not.toHaveBeenCalled();
    expect(events.onError).not.toHaveBeenCalled();
    expect(h.video.srcObject).toBe(stream.stream);
    expect(estimator.close).not.toHaveBeenCalled();
    expect(h.frames.size).toBe(1);
  });

  it('ends the run after an inference exception and never repeatedly invokes the failed engine', async () => {
    const h = await running();
    const error = new Error('inference failed');
    h.estimator.estimate.mockImplementationOnce(() => { throw error; });
    h.takeFrame()(1000);

    expect(h.events.onError).toHaveBeenCalledWith('inference', error);
    expect(h.events.onFrame).not.toHaveBeenCalled();
    expect(h.frames.size).toBe(0);
    expect(h.lifecycle.active).toBe(false);
    expect(h.stream.tracks[0].stop).toHaveBeenCalledTimes(1);
    expect(h.estimator.close).toHaveBeenCalledTimes(1);
  });

  it('releases camera and model if the playing video reports an error', async () => {
    const h = await running();
    h.video.error = new Error('preview failed');
    h.video.dispatchEvent(new Event('error'));

    expect(h.events.onError).toHaveBeenCalledWith('playback', h.video.error);
    expect(h.stream.tracks[0].stop).toHaveBeenCalledTimes(1);
    expect(h.estimator.close).toHaveBeenCalledTimes(1);
    expect(h.frames.size).toBe(0);
  });

  it('ends the run when the camera track ends and does not resume from an obsolete frame', async () => {
    const h = await running();
    const oldFrame = h.takeFrame();
    h.stream.tracks[0].end();
    oldFrame(1000);

    expect(h.events.onError).toHaveBeenCalledWith('ended', expect.any(Error));
    expect(h.estimator.close).toHaveBeenCalledTimes(1);
    expect(h.estimator.estimate).not.toHaveBeenCalled();
    expect(h.video.srcObject).toBeNull();
    expect(h.frames.size).toBe(0);
  });

  it('closes a late model after a camera track ended during initialization', async () => {
    const h = harness();
    const events = callbacks();
    const task = h.lifecycle.startCamera(events);
    const stream = await grant(h);
    stream.tracks[0].end();
    const estimator = fakeEstimator();
    h.modelRequests[0].resolve(estimator);
    await task;

    expect(events.onError).toHaveBeenCalledTimes(1);
    expect(events.onError).toHaveBeenCalledWith('ended', expect.any(Error));
    expect(events.onReady).not.toHaveBeenCalled();
    expect(estimator.close).toHaveBeenCalledTimes(1);
    expect(h.frames.size).toBe(0);
  });

  it.each(['ended', 'empty'] as const)('refuses a stream whose video tracks are already %s', async (state) => {
    const h = harness();
    const events = callbacks();
    const task = h.lifecycle.startCamera(events);
    const stream = fakeStream(state === 'empty' ? [] : [new FakeTrack()]);
    for (const track of stream.tracks) track.readyState = 'ended';
    await grant(h, 0, stream);
    await task;

    expect(events.onError).toHaveBeenCalledWith('ended', expect.any(Error));
    expect(h.video.play).not.toHaveBeenCalled();
    expect(h.modelRequests).toHaveLength(0);
    expect(h.frames.size).toBe(0);
  });

  it('does not leak a stream if its video element has disappeared', async () => {
    const h = harness();
    h.getVideo.mockReturnValue(null);
    const events = callbacks();
    const task = h.lifecycle.startCamera(events);
    const stream = await grant(h);
    await task;

    expect(events.onError).toHaveBeenCalledWith('playback', expect.any(Error));
    expect(stream.tracks[0].stop).toHaveBeenCalledTimes(1);
    expect(h.frames.size).toBe(0);
  });

  it('makes repeated Stop harmless and removes listeners before releasing resources', async () => {
    const h = await running();
    h.lifecycle.stop();
    h.lifecycle.stop();
    h.stream.tracks[0].end();
    h.video.dispatchEvent(new Event('error'));

    expect(h.stream.tracks[0].stop).toHaveBeenCalledTimes(1);
    expect(h.estimator.close).toHaveBeenCalledTimes(1);
    expect(h.events.onError).not.toHaveBeenCalled();
    expect(h.frames.size).toBe(0);
  });

  it('continues releasing other resources if a track or estimator rejects cleanup', async () => {
    const h = harness();
    const events = callbacks();
    const task = h.lifecycle.startCamera(events);
    const stream = await grant(h, 0, fakeStream([new FakeTrack(), new FakeTrack()]));
    const estimator = fakeEstimator();
    h.modelRequests[0].resolve(estimator);
    await task;
    stream.tracks[0].stop.mockImplementationOnce(() => { throw new Error('stop failed'); });
    estimator.close.mockImplementationOnce(() => { throw new Error('close failed'); });

    expect(() => h.lifecycle.stop()).not.toThrow();
    expect(stream.tracks[1].stop).toHaveBeenCalledTimes(1);
    expect(estimator.close).toHaveBeenCalledTimes(1);
    expect(h.video.srcObject).toBeNull();
    expect(h.frames.size).toBe(0);
  });
});
