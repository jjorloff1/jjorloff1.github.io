const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const YOUTUBE_PLAYBACK_SOURCE = fs.readFileSync(
  path.resolve(__dirname, '../js/youtube-playback.js'),
  'utf8'
);

function loadPlaybackThresholds() {
  const listeners = new Map();
  const document = {
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    }
  };
  const window = {
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    }
  };

  const context = vm.createContext({ document, window, Storage: {} });
  vm.runInContext(YOUTUBE_PLAYBACK_SOURCE, context, { filename: 'js/youtube-playback.js' });

  return window.YouTubePlayback._internal;
}

function loadPlaybackHarness({
  resumeRecord = null,
  currentTime = 120,
  duration = 593
} = {}) {
  const listeners = new Map();
  const calls = {
    clear: [],
    destroy: 0,
    intervals: [],
    save: [],
    seek: []
  };
  let playerOptions = null;

  const fakePlayer = {
    destroy() {
      calls.destroy += 1;
    },
    getCurrentTime() {
      return currentTime;
    },
    getDuration() {
      return duration;
    },
    seekTo(seconds, allowSeekAhead) {
      calls.seek.push([seconds, allowSeekAhead]);
    }
  };

  function FakePlayer(_target, options) {
    playerOptions = options;
    return fakePlayer;
  }

  const window = {
    YT: {
      Player: FakePlayer,
      PlayerState: { ENDED: 0, PLAYING: 1, PAUSED: 2 }
    },
    location: {
      origin: 'http://localhost:8000',
      protocol: 'http:'
    },
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    }
  };
  const document = {
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    querySelector() {
      return null;
    }
  };
  const Storage = {
    clearResumePosition(videoId) {
      calls.clear.push(videoId);
    },
    getResumePosition() {
      return resumeRecord;
    },
    setResumePosition(videoId, seconds, savedDuration) {
      calls.save.push([videoId, seconds, savedDuration]);
    }
  };
  const context = vm.createContext({
    clearInterval() {},
    document,
    setInterval(callback, delay) {
      calls.intervals.push({ callback, delay });
      return calls.intervals.length;
    },
    Storage,
    window
  });

  vm.runInContext(YOUTUBE_PLAYBACK_SOURCE, context, { filename: 'js/youtube-playback.js' });

  return {
    calls,
    fakePlayer,
    getPlayerOptions: () => playerOptions,
    playback: window.YouTubePlayback
  };
}

test('shouldSaveResumePosition requires past the greater-of-floor-and-fraction threshold', () => {
  const { shouldSaveResumePosition } = loadPlaybackThresholds();

  // 400s video: min-watched threshold is flat 30s (10% would be 40s, capped at 30s floor... actually
  // min(30, duration*0.1) = min(30, 40) = 30
  assert.equal(shouldSaveResumePosition(29, 400), false);
  assert.equal(shouldSaveResumePosition(30, 400), true);

  // 20s video: threshold is max(5, min(30, 2)) = 5
  assert.equal(shouldSaveResumePosition(4, 20), false);
  assert.equal(shouldSaveResumePosition(5, 20), true);

  // Zero/negative watched time never qualifies
  assert.equal(shouldSaveResumePosition(0, 400), false);

  // No known duration never qualifies
  assert.equal(shouldSaveResumePosition(60, 0), false);
});

test('isFinished treats last-15-seconds and 95%-watched as finished', () => {
  const { isFinished } = loadPlaybackThresholds();

  // 20s video: 95% = 19s, and (duration - currentTime) <= 15 covers nearly all of it anyway.
  assert.equal(isFinished(18.9, 20), true); // 94.5% watched, but only 1.1s remaining
  assert.equal(isFinished(5, 20), true); // 15s remaining exactly

  // 400s video: 15s-remaining boundary is well before the 95% boundary (380s)
  assert.equal(isFinished(384, 400), true); // 16s remaining, 96% watched -> still finished via fraction
  assert.equal(isFinished(385, 400), true); // exactly 15s remaining
  assert.equal(isFinished(370, 400), false); // 30s remaining, 92.5% watched
  assert.equal(isFinished(380, 400), true); // exactly 95% watched

  assert.equal(isFinished(100, 0), false); // no known duration
});

test('player lifecycle uses the page origin and tracks a qualifying position', async () => {
  const harness = loadPlaybackHarness({
    resumeRecord: { seconds: 60, duration: 593 }
  });
  const resumed = [];

  harness.playback.start({
    target: {},
    videoId: 'video-id',
    onResume(seconds) {
      resumed.push(seconds);
    }
  });
  await new Promise((resolve) => setImmediate(resolve));

  const options = harness.getPlayerOptions();
  assert.equal(options.playerVars.origin, 'http://localhost:8000');

  options.events.onReady({ target: harness.fakePlayer });
  assert.deepEqual(harness.calls.seek, [[60, true]]);
  assert.deepEqual(resumed, [60]);
  assert.equal(harness.calls.intervals.length, 1);
  assert.equal(harness.calls.intervals[0].delay, 5000);

  harness.calls.intervals[0].callback();
  assert.deepEqual(harness.calls.save, [['video-id', 120, 593]]);

  harness.playback.stop();
  assert.deepEqual(harness.calls.save, [
    ['video-id', 120, 593],
    ['video-id', 120, 593]
  ]);
  assert.equal(harness.calls.destroy, 1);
});
