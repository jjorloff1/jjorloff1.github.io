const test = require('node:test');
const assert = require('node:assert/strict');

const { loadStorage, plain } = require('./storage-test-harness');

const KEYS = {
  played: 'playedVideos',
  excluded: 'excludedVideos',
  profiles: 'soloProfiles',
  watched: 'soloWatchedByProfile'
};

function baseState() {
  return {
    [KEYS.played]: JSON.stringify({
      played: { played: true, timestamp: '2026-01-01T00:00:00.000Z' }
    }),
    [KEYS.excluded]: JSON.stringify({ excluded: true }),
    [KEYS.profiles]: JSON.stringify([
      { id: 'alpha', name: 'Alpha' },
      { id: 'beta', name: 'Beta' }
    ]),
    [KEYS.watched]: JSON.stringify({
      alpha: { solo: { played: true, timestamp: '2026-01-02T00:00:00.000Z' } },
      beta: { shared: { played: true, timestamp: '2026-01-03T00:00:00.000Z' } }
    })
  };
}

test('performance-critical storage values hydrate once and stay warm', () => {
  const harness = loadStorage(baseState());
  const { Storage, localStorage, jsonMetrics } = harness;
  harness.resetMetrics();

  assert.equal(Storage.isPlayed('played'), true);
  assert.equal(Storage.isExcluded('excluded'), true);
  assert.deepEqual(plain(Storage.getSoloWatcherProfileIds('solo')), ['alpha']);
  assert.deepEqual(plain(Storage.getSoloWatchers('shared')), [
    { id: 'beta', name: 'Beta' }
  ]);

  for (let index = 0; index < 2_000; index += 1) {
    Storage.isPlayed(`missing-${index}`);
    Storage.isExcluded(`missing-${index}`);
    Storage.getSoloWatchers(`missing-${index}`);
  }

  assert.equal(localStorage.readCount(KEYS.played), 1);
  assert.equal(localStorage.readCount(KEYS.excluded), 1);
  assert.equal(localStorage.readCount(KEYS.profiles), 1);
  assert.equal(localStorage.readCount(KEYS.watched), 1);
  assert.equal(localStorage.totalReads(), 4);
  assert.equal(jsonMetrics.parseCount, 4);
});

test('malformed and unexpected stored values are cached as safe fallbacks', () => {
  const harness = loadStorage({
    [KEYS.played]: '{',
    [KEYS.excluded]: '[]',
    [KEYS.profiles]: '[{"id":"","name":""}]',
    [KEYS.watched]: 'null'
  });
  const { Storage, localStorage, jsonMetrics } = harness;
  harness.resetMetrics();

  const played = Storage.getPlayedMap();
  const excluded = Storage.getExcludedMap();
  const watched = Storage.getSoloWatchedByProfileMap();
  const profiles = Storage.getSoloProfiles();

  assert.strictEqual(Storage.getPlayedMap(), played);
  assert.strictEqual(Storage.getExcludedMap(), excluded);
  assert.strictEqual(Storage.getSoloWatchedByProfileMap(), watched);
  assert.strictEqual(Storage.getSoloProfiles(), profiles);
  assert.deepEqual(plain(played), {});
  assert.deepEqual(plain(excluded), {});
  assert.deepEqual(plain(watched), {});
  assert.deepEqual(plain(profiles), plain(Storage.DEFAULT_SOLO_PROFILES));
  assert.equal(localStorage.readCount(KEYS.played), 1);
  assert.equal(localStorage.readCount(KEYS.excluded), 1);
  assert.equal(localStorage.readCount(KEYS.profiles), 1);
  assert.equal(localStorage.readCount(KEYS.watched), 1);
  assert.equal(localStorage.writeCount(KEYS.profiles), 1);
  assert.equal(jsonMetrics.parseCount, 4);
});

test('copy-on-write mutations leave caches unchanged when persistence fails', () => {
  const harness = loadStorage(baseState());
  const { Storage, localStorage } = harness;

  const playedBefore = Storage.getPlayedMap();
  localStorage.failWritesFor(KEYS.played);
  assert.throws(() => Storage.markPlayed('new-played'), /Simulated storage write failure/);
  assert.strictEqual(Storage.getPlayedMap(), playedBefore);
  assert.equal(Storage.isPlayed('new-played'), false);

  localStorage.allowWritesFor(KEYS.played);
  Storage.markPlayed('new-played', { source: 'test' });
  assert.equal(Storage.isPlayed('new-played'), true);
  assert.equal(Storage.getPlayedMap()['new-played'].source, 'test');

  const watchedBefore = Storage.getSoloWatchedByProfileMap();
  localStorage.failWritesFor(KEYS.watched);
  assert.throws(
    () => Storage.markSoloPlayed('new-solo', { source: 'test' }, 'alpha'),
    /Simulated storage write failure/
  );
  assert.strictEqual(Storage.getSoloWatchedByProfileMap(), watchedBefore);
  assert.equal(Storage.isSoloPlayed('new-solo', 'alpha'), false);

  localStorage.allowWritesFor(KEYS.watched);
  Storage.markSoloPlayed('new-solo', { source: 'test' }, 'alpha');
  assert.equal(Storage.isSoloPlayed('new-solo', 'alpha'), true);

  const profilesBefore = Storage.getSoloProfiles();
  localStorage.failWritesFor(KEYS.profiles);
  assert.throws(() => Storage.addSoloProfile('Gamma'), /Simulated storage write failure/);
  assert.strictEqual(Storage.getSoloProfiles(), profilesBefore);
  assert.equal(Storage.getSoloProfiles().some((profile) => profile.name === 'Gamma'), false);
});

test('watcher queries use cached maps directly and preserve requested order', () => {
  const harness = loadStorage(baseState());
  const { Storage, localStorage } = harness;
  harness.resetMetrics();

  Storage.setSoloWatcherProfileIds('shared', ['alpha', 'beta']);
  assert.deepEqual(
    plain(Storage.getSoloWatchers('shared', ['beta', 'alpha'])).map((profile) => profile.id),
    ['beta', 'alpha']
  );
  assert.deepEqual(plain(Storage.getSoloWatcherProfileIds('shared')), ['alpha', 'beta']);
  assert.equal(Storage.isSoloPlayedByAnyProfile('shared', ['beta']), true);

  const readsAfterWarmup = localStorage.totalReads();
  for (let index = 0; index < 1_000; index += 1) {
    Storage.getSoloWatchers('shared', ['beta', 'alpha']);
    Storage.getSoloWatcherProfileIds('shared');
  }
  assert.equal(localStorage.totalReads(), readsAfterWarmup);

  Storage.setSoloWatcherProfileIds('shared', ['alpha']);
  assert.deepEqual(plain(Storage.getSoloWatcherProfileIds('shared')), ['alpha']);
  assert.equal(JSON.parse(localStorage.values.get(KEYS.watched)).beta?.shared, undefined);
});

test('imports replace warm caches through the normal setters', () => {
  const harness = loadStorage(baseState());
  const { Storage, alerts } = harness;

  Storage.getPlayedMap();
  Storage.getExcludedMap();
  Storage.getSoloWatchedByProfileMap();
  Storage.getSoloProfiles();

  let playedCallback = false;
  Storage.uploadPlayedJsonFile(
    { text: JSON.stringify({ importedPlayed: { played: true } }) },
    () => {
      playedCallback = true;
    }
  );

  let excludedCallback = false;
  Storage.uploadExcludedJsonFile(
    { text: JSON.stringify(['importedExcluded']) },
    () => {
      excludedCallback = true;
    }
  );

  let watchedCallback = false;
  Storage.uploadSoloPlayedJsonFile(
    {
      text: JSON.stringify({
        version: 2,
        profiles: [{ id: 'gamma', name: 'Gamma' }],
        watchedByProfile: { gamma: { importedSolo: { played: true } } }
      })
    },
    () => {
      watchedCallback = true;
    }
  );

  assert.equal(playedCallback, true);
  assert.equal(excludedCallback, true);
  assert.equal(watchedCallback, true);
  assert.equal(Storage.isPlayed('importedPlayed'), true);
  assert.equal(Storage.isPlayed('played'), false);
  assert.equal(Storage.isExcluded('importedExcluded'), true);
  assert.equal(Storage.isExcluded('excluded'), false);
  assert.equal(Storage.isSoloPlayed('importedSolo', 'gamma'), true);
  assert.equal(Storage.getSoloProfiles().some((profile) => profile.id === 'gamma'), true);
  assert.deepEqual(alerts, []);
});

test('storage events invalidate only the affected cache and null invalidates all', () => {
  const harness = loadStorage(baseState());
  const { Storage, window, localStorage } = harness;

  Storage.getPlayedMap();
  Storage.getExcludedMap();
  Storage.getSoloProfiles();
  Storage.getSoloWatchedByProfileMap();
  harness.resetMetrics();

  localStorage.externalSet(KEYS.played, JSON.stringify({ externalPlayed: { played: true } }));
  window.dispatchStorageEvent({
    key: KEYS.played,
    storageArea: localStorage
  });

  assert.equal(Storage.isPlayed('externalPlayed'), true);
  assert.equal(localStorage.readCount(KEYS.played), 1);
  assert.equal(localStorage.readCount(KEYS.excluded), 0);
  assert.equal(localStorage.readCount(KEYS.profiles), 0);
  assert.equal(localStorage.readCount(KEYS.watched), 0);

  localStorage.externalSet(KEYS.excluded, JSON.stringify({ externalExcluded: true }));
  window.dispatchStorageEvent({ key: KEYS.excluded, storageArea: {} });
  assert.equal(Storage.isExcluded('externalExcluded'), false);

  localStorage.externalSet(KEYS.profiles, JSON.stringify([{ id: 'external', name: 'External' }]));
  localStorage.externalSet(KEYS.played, JSON.stringify({ afterClear: { played: true } }));
  localStorage.externalSet(
    KEYS.watched,
    JSON.stringify({ external: { externalSolo: { played: true } } })
  );
  window.dispatchStorageEvent({ key: null, storageArea: localStorage });

  assert.equal(Storage.isExcluded('externalExcluded'), true);
  assert.equal(Storage.isPlayed('afterClear'), true);
  assert.deepEqual(plain(Storage.getSoloProfiles()), [{ id: 'external', name: 'External' }]);
  assert.equal(Storage.isSoloPlayed('externalSolo', 'external'), true);
  assert.equal(localStorage.readCount(KEYS.played), 2);
  assert.equal(localStorage.readCount(KEYS.excluded), 1);
  assert.equal(localStorage.readCount(KEYS.profiles), 1);
  assert.equal(localStorage.readCount(KEYS.watched), 1);
});

test('legacy solo history migration updates persistence and the watched cache', () => {
  const harness = loadStorage(
    {
      soloPlayedVideos: JSON.stringify({
        legacy: { played: true, timestamp: '2025-01-01T00:00:00.000Z' },
        existing: { played: true, source: 'legacy' }
      }),
      [KEYS.watched]: JSON.stringify({
        jesse: { existing: { played: true, source: 'current' } }
      }),
      [KEYS.profiles]: JSON.stringify([{ id: 'jesse', name: 'Jesse' }])
    },
    { includeMigrationMarker: false }
  );
  const { Storage, localStorage } = harness;

  assert.equal(Storage.isSoloPlayed('legacy', 'jesse'), true);
  assert.equal(Storage.getSoloPlayedMap('jesse').existing.source, 'current');
  assert.ok(localStorage.values.get('soloProfilesMigratedFromSoloPlayedVideos'));
  assert.equal(JSON.parse(localStorage.values.get(KEYS.watched)).jesse.legacy.played, true);
});
