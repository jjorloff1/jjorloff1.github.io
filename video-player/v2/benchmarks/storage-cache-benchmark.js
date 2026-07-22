const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

const { loadStorage } = require('../tests/storage-test-harness');

const DATA_ROOT = path.resolve(__dirname, '../../data');
const VIDEO_CSV = path.join(DATA_ROOT, 'difficulty-scores/video_difficulty_scores.csv');
const SHORTS_CSV = path.join(DATA_ROOT, 'difficulty-scores/shorts_difficulty_scores.csv');
const PLAYED_JSON = path.join(DATA_ROOT, 'user-data/played_videos.json');
const EXCLUDED_JSON = path.join(DATA_ROOT, 'user-data/excluded_videos.json');
const WATCHED_JSON = path.join(DATA_ROOT, 'user-data/profile_watched_data.json');

function parseCsvVideoIds(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  const header = rows.shift() || [];
  const videoIdIndex = header.indexOf('video_id');
  return rows.map((values) => values[videoIdIndex]).filter(Boolean);
}

function loadRealData() {
  const required = [VIDEO_CSV, SHORTS_CSV, PLAYED_JSON, EXCLUDED_JSON, WATCHED_JSON];
  if (!required.every((filename) => fs.existsSync(filename))) return null;

  const watchedExport = JSON.parse(fs.readFileSync(WATCHED_JSON, 'utf8'));
  const excludedIds = JSON.parse(fs.readFileSync(EXCLUDED_JSON, 'utf8'));
  return {
    source: 'real ignored data',
    ids: [
      ...parseCsvVideoIds(fs.readFileSync(VIDEO_CSV, 'utf8')),
      ...parseCsvVideoIds(fs.readFileSync(SHORTS_CSV, 'utf8'))
    ],
    played: JSON.parse(fs.readFileSync(PLAYED_JSON, 'utf8')),
    excluded: Object.fromEntries(excludedIds.map((videoId) => [videoId, true])),
    profiles: watchedExport.profiles,
    watched: watchedExport.watchedByProfile
  };
}

function makeSyntheticData() {
  const ids = Array.from({ length: 12_983 }, (_, index) => `video-${index}`);
  const profiles = Array.from({ length: 5 }, (_, index) => ({
    id: `profile-${index}`,
    name: `Profile ${index + 1}`
  }));
  const played = {};
  const excluded = {};
  const watched = Object.fromEntries(profiles.map((profile) => [profile.id, {}]));

  ids.slice(0, 407).forEach((videoId) => {
    played[videoId] = { played: true };
  });
  ids.slice(407, 1_092).forEach((videoId) => {
    excluded[videoId] = true;
  });
  ids.slice(1_092, 1_584).forEach((videoId, index) => {
    watched[profiles[index % profiles.length].id][videoId] = { played: true };
  });

  return { source: 'generated representative data', ids, profiles, played, excluded, watched };
}

function runLegacy(data, serialized) {
  let parseCount = 0;
  let kept = 0;
  const parse = (text) => {
    parseCount += 1;
    return JSON.parse(text);
  };
  const started = performance.now();

  for (const videoId of data.ids) {
    if (parse(serialized.excluded)[videoId]) continue;
    if (parse(serialized.played)[videoId]) continue;

    let watchedByAnyProfile = false;
    for (const profile of data.profiles) {
      const watched = parse(serialized.watched);
      if (watched[profile.id]?.[videoId]) {
        watchedByAnyProfile = true;
        break;
      }
    }
    if (!watchedByAnyProfile) kept += 1;
  }

  return { kept, parseCount, storageReads: parseCount, elapsedMs: performance.now() - started };
}

function runCached(data, serialized) {
  const harness = loadStorage({
    playedVideos: serialized.played,
    excludedVideos: serialized.excluded,
    soloProfiles: serialized.profiles,
    soloWatchedByProfile: serialized.watched
  });
  const { Storage, localStorage, jsonMetrics } = harness;
  harness.resetMetrics();

  let kept = 0;
  const started = performance.now();
  for (const videoId of data.ids) {
    if (Storage.isExcluded(videoId)) continue;
    if (Storage.isPlayed(videoId)) continue;
    if (Storage.getSoloWatchers(videoId).length) continue;
    kept += 1;
  }

  return {
    kept,
    parseCount: jsonMetrics.parseCount,
    storageReads: localStorage.totalReads(),
    elapsedMs: performance.now() - started
  };
}

const data = loadRealData() || makeSyntheticData();
const serialized = {
  played: JSON.stringify(data.played),
  excluded: JSON.stringify(data.excluded),
  profiles: JSON.stringify(data.profiles),
  watched: JSON.stringify(data.watched)
};

const legacy = runLegacy(data, serialized);
const cached = runCached(data, serialized);
const sameResult = legacy.kept === cached.kept;
const speedup = legacy.elapsedMs / cached.elapsedMs;

console.log(`Data source: ${data.source}`);
console.log(`Rows: ${data.ids.length.toLocaleString()}, profiles: ${data.profiles.length}`);
console.log(
  `Legacy: ${legacy.elapsedMs.toFixed(1)} ms, ${legacy.storageReads.toLocaleString()} storage reads, ` +
  `${legacy.parseCount.toLocaleString()} JSON parses`
);
console.log(
  `Cached: ${cached.elapsedMs.toFixed(1)} ms, ${cached.storageReads.toLocaleString()} storage reads, ` +
  `${cached.parseCount.toLocaleString()} JSON parses`
);
console.log(`Equivalent result: ${sameResult ? 'yes' : 'no'}`);
console.log(`Speedup: ${speedup.toFixed(1)}x`);

if (!sameResult) process.exitCode = 1;
