// js/storage.js
(function () {
  const PLAYED_KEY = 'playedVideos';
  const EXCLUDED_KEY = 'excludedVideos';
  const SOLO_PLAYED_KEY = 'soloPlayedVideos';
  const SOLO_PROFILES_KEY = 'soloProfiles';
  const ACTIVE_SOLO_PROFILE_KEY = 'activeSoloProfileId';
  const SOLO_VISIBILITY_PROFILE_IDS_KEY = 'soloVisibilityProfileIds';
  const SOLO_WATCHED_BY_PROFILE_KEY = 'soloWatchedByProfile';
  const SOLO_MIGRATION_KEY = 'soloProfilesMigratedFromSoloPlayedVideos';
  const DEFAULT_SOLO_PROFILES = [
    { id: 'jesse', name: 'Jesse' },
    { id: 'naomi', name: 'Naomi' },
    { id: 'titus', name: 'Titus' }
  ];
  const CACHE_UNINITIALIZED = Symbol('cache-uninitialized');

  let playedMapCache = CACHE_UNINITIALIZED;
  let excludedMapCache = CACHE_UNINITIALIZED;
  let soloWatchedByProfileCache = CACHE_UNINITIALIZED;
  let soloProfilesCache = CACHE_UNINITIALIZED;

  function safeParseObject(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (raw == null || raw === '') return fallback;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
    } catch {
      return fallback;
    }
  }

  function safeParseArray(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (raw == null || raw === '') return fallback;
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : fallback;
    } catch {
      return fallback;
    }
  }

  function normalizeObjectMap(map) {
    return map && typeof map === 'object' && !Array.isArray(map) ? map : {};
  }

  function cloneObjectMap(map) {
    return { ...normalizeObjectMap(map) };
  }

  function normalizeProfile(profile) {
    if (!profile || typeof profile !== 'object') return null;
    const id = String(profile.id || '').trim();
    const name = String(profile.name || '').trim();
    if (!id || !name) return null;
    return { id, name };
  }

  function getSoloProfiles() {
    if (soloProfilesCache !== CACHE_UNINITIALIZED) return soloProfilesCache;

    const stored = safeParseArray(SOLO_PROFILES_KEY, []);
    const profiles = stored.map(normalizeProfile).filter(Boolean);
    if (profiles.length) {
      soloProfilesCache = profiles;
      return soloProfilesCache;
    }

    setSoloProfiles(DEFAULT_SOLO_PROFILES);
    return soloProfilesCache;
  }

  function setSoloProfiles(profiles) {
    const normalized = (profiles || []).map(normalizeProfile).filter(Boolean);
    localStorage.setItem(SOLO_PROFILES_KEY, JSON.stringify(normalized));
    soloProfilesCache = normalized.length ? normalized : CACHE_UNINITIALIZED;
  }

  function getValidSoloProfileIds(profileIds) {
    const validIds = new Set(getSoloProfiles().map((profile) => profile.id));
    return (Array.isArray(profileIds) ? profileIds : []).filter((id, index, arr) =>
      typeof id === 'string' &&
      validIds.has(id) &&
      arr.indexOf(id) === index
    );
  }

  function makeProfileNameFromId(profileId) {
    return String(profileId || 'Profile')
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }

  function mergeImportedProfiles(importedProfiles, profileIds) {
    const existing = getSoloProfiles();
    const existingIds = new Set(existing.map((profile) => profile.id));
    const importedById = (Array.isArray(importedProfiles) ? importedProfiles : [])
      .map(normalizeProfile)
      .filter(Boolean)
      .reduce((acc, profile) => {
        acc[profile.id] = profile;
        return acc;
      }, {});

    const additions = (profileIds || [])
      .filter((id, index, arr) =>
        typeof id === 'string' &&
        id.trim() &&
        !existingIds.has(id) &&
        arr.indexOf(id) === index
      )
      .map((id) => importedById[id] || { id, name: makeProfileNameFromId(id) });

    if (additions.length) setSoloProfiles(existing.concat(additions));
  }

  function makeSoloProfileId(name) {
    const profiles = getSoloProfiles();
    const existingIds = new Set(profiles.map((profile) => profile.id));
    const base = String(name || 'profile')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'profile';
    let id = base;
    let index = 2;
    while (existingIds.has(id)) {
      id = `${base}-${index}`;
      index += 1;
    }
    return id;
  }

  function getActiveSoloProfileId() {
    const profiles = getSoloProfiles();
    const fallback = profiles[0]?.id || DEFAULT_SOLO_PROFILES[0].id;
    const saved = localStorage.getItem(ACTIVE_SOLO_PROFILE_KEY) || fallback;
    if (profiles.some((profile) => profile.id === saved)) return saved;
    setActiveSoloProfileId(fallback);
    return fallback;
  }

  function setActiveSoloProfileId(profileId) {
    const profiles = getSoloProfiles();
    const next = profiles.some((profile) => profile.id === profileId)
      ? profileId
      : profiles[0]?.id;
    if (next) localStorage.setItem(ACTIVE_SOLO_PROFILE_KEY, next);
  }

  function getActiveSoloProfile() {
    const id = getActiveSoloProfileId();
    return getSoloProfiles().find((profile) => profile.id === id) || getSoloProfiles()[0];
  }

  function addSoloProfile(name) {
    const trimmed = String(name || '').trim();
    if (!trimmed) return null;
    const profiles = getSoloProfiles();
    const profile = { id: makeSoloProfileId(trimmed), name: trimmed };
    setSoloProfiles(profiles.concat(profile));
    return profile;
  }

  function renameSoloProfile(profileId, name) {
    const trimmed = String(name || '').trim();
    if (!profileId || !trimmed) return false;
    const profiles = getSoloProfiles();
    const next = profiles.map((profile) =>
      profile.id === profileId ? { ...profile, name: trimmed } : profile
    );
    setSoloProfiles(next);
    return true;
  }

  function getSoloWatchedByProfileMap() {
    if (soloWatchedByProfileCache === CACHE_UNINITIALIZED) {
      soloWatchedByProfileCache = safeParseObject(SOLO_WATCHED_BY_PROFILE_KEY, {});
    }
    return soloWatchedByProfileCache;
  }

  function normalizeSoloPlayedMap(map) {
    return normalizeObjectMap(map);
  }

  function cloneSoloWatchedByProfileMap(map) {
    return Object.entries(normalizeObjectMap(map)).reduce((acc, [profileId, played]) => {
      acc[profileId] = cloneObjectMap(played);
      return acc;
    }, {});
  }

  function setSoloWatchedByProfileMap(map) {
    const normalized = cloneSoloWatchedByProfileMap(map);
    localStorage.setItem(SOLO_WATCHED_BY_PROFILE_KEY, JSON.stringify(normalized));
    soloWatchedByProfileCache = normalized;
  }

  function deleteSoloProfile(profileId) {
    const profiles = getSoloProfiles();
    if (profiles.length <= 1) return false;

    const nextProfiles = profiles.filter((profile) => profile.id !== profileId);
    if (nextProfiles.length === profiles.length) return false;

    const watched = { ...getSoloWatchedByProfileMap() };
    delete watched[profileId];
    setSoloWatchedByProfileMap(watched);
    setSoloProfiles(nextProfiles);

    if (getActiveSoloProfileId() === profileId) {
      setActiveSoloProfileId(nextProfiles[0].id);
    }

    const selected = getSoloVisibilityProfileIds().filter((id) => id !== profileId);
    setSoloVisibilityProfileIds(selected);
    return true;
  }

  function getSoloVisibilityProfileIds() {
    const profiles = getSoloProfiles();
    const validIds = new Set(profiles.map((profile) => profile.id));
    const raw = localStorage.getItem(SOLO_VISIBILITY_PROFILE_IDS_KEY);
    if (raw == null) return profiles.map((profile) => profile.id);
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((id) => validIds.has(id));
    } catch {
      return [];
    }
  }

  function setSoloVisibilityProfileIds(profileIds) {
    const validIds = new Set(getSoloProfiles().map((profile) => profile.id));
    const next = (profileIds || []).filter((id, index, arr) =>
      validIds.has(id) && arr.indexOf(id) === index
    );
    localStorage.setItem(SOLO_VISIBILITY_PROFILE_IDS_KEY, JSON.stringify(next));
  }

  function getEffectiveSoloVisibilityProfileIds(profileIds) {
    const profiles = getSoloProfiles();
    const validIds = new Set(profiles.map((profile) => profile.id));
    const selected = Array.isArray(profileIds) ? profileIds : getSoloVisibilityProfileIds();
    const normalized = selected.filter((id, index, arr) =>
      validIds.has(id) && arr.indexOf(id) === index
    );
    return normalized.length ? normalized : [getActiveSoloProfileId()].filter(Boolean);
  }

  function getPlayedMap() {
    if (playedMapCache === CACHE_UNINITIALIZED) {
      playedMapCache = safeParseObject(PLAYED_KEY, {});
    }
    return playedMapCache;
  }

  function setPlayedMap(map) {
    const normalized = cloneObjectMap(map);
    localStorage.setItem(PLAYED_KEY, JSON.stringify(normalized));
    playedMapCache = normalized;
  }

  function isPlayed(videoId) {
    const played = getPlayedMap();
    return !!played[videoId];
  }

  function markPlayed(videoId, extra) {
    const played = {
      ...getPlayedMap(),
      [videoId]: {
        played: true,
        timestamp: new Date().toISOString(),
        ...(extra || {})
      }
    };
    setPlayedMap(played);
  }

  function unmarkPlayed(videoId) {
    const played = { ...getPlayedMap() };
    delete played[videoId];
    setPlayedMap(played);
  }

  function downloadPlayedJson(filename = 'played_videos.json') {
    const played = getPlayedMap();
    const blob = new Blob([JSON.stringify(played, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function uploadPlayedJsonFile(file, onDone) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target.result);
        setPlayedMap(data);
        if (typeof onDone === 'function') onDone(data);
      } catch {
        alert('Invalid JSON file');
      }
    };
    reader.readAsText(file);
  }

  // ===== Solo Played videos =====
  function getSoloPlayedMap(profileId) {
    const targetProfileId = profileId || getActiveSoloProfileId();
    const watched = getSoloWatchedByProfileMap();
    const map = watched[targetProfileId];
    return normalizeSoloPlayedMap(map);
  }

  function setSoloPlayedMap(map, profileId) {
    const targetProfileId = profileId || getActiveSoloProfileId();
    const watched = {
      ...getSoloWatchedByProfileMap(),
      [targetProfileId]: cloneObjectMap(map)
    };
    setSoloWatchedByProfileMap(watched);
  }

  function isSoloPlayed(videoId, profileId) {
    const soloPlayed = getSoloPlayedMap(profileId);
    return !!soloPlayed[videoId];
  }

  function isSoloPlayedByAnyProfile(videoId, profileIds) {
    const watched = getSoloWatchedByProfileMap();
    return getEffectiveSoloVisibilityProfileIds(profileIds).some((profileId) =>
      !!normalizeSoloPlayedMap(watched[profileId])[videoId]
    );
  }

  function markSoloPlayed(videoId, extra, profileId) {
    const targetProfileId = profileId || getActiveSoloProfileId();
    const soloPlayed = {
      ...getSoloPlayedMap(targetProfileId),
      [videoId]: {
        played: true,
        timestamp: new Date().toISOString(),
        ...(extra || {})
      }
    };
    setSoloPlayedMap(soloPlayed, targetProfileId);
  }

  function unmarkSoloPlayed(videoId, profileId) {
    const targetProfileId = profileId || getActiveSoloProfileId();
    const soloPlayed = { ...getSoloPlayedMap(targetProfileId) };
    delete soloPlayed[videoId];
    setSoloPlayedMap(soloPlayed, targetProfileId);
  }

  function getSoloWatchers(videoId, profileIds) {
    const profiles = getSoloProfiles();
    const watched = getSoloWatchedByProfileMap();
    const profilesById = profiles.reduce((acc, profile) => {
      acc[profile.id] = profile;
      return acc;
    }, {});
    const ids = Array.isArray(profileIds)
      ? getEffectiveSoloVisibilityProfileIds(profileIds)
      : profiles.map((profile) => profile.id);
    return ids
      .filter((profileId) =>
        profilesById[profileId] &&
        !!normalizeSoloPlayedMap(watched[profileId])[videoId]
      )
      .map((profileId) => profilesById[profileId]);
  }

  function getSoloWatcherProfileIds(videoId) {
    const watched = getSoloWatchedByProfileMap();
    return getSoloProfiles()
      .map((profile) => profile.id)
      .filter((profileId) => !!normalizeSoloPlayedMap(watched[profileId])[videoId]);
  }

  function setSoloWatcherProfileIds(videoId, profileIds) {
    if (!videoId) return;
    const nextIds = new Set(getValidSoloProfileIds(profileIds));
    const watched = { ...getSoloWatchedByProfileMap() };
    const now = new Date().toISOString();

    getSoloProfiles().forEach((profile) => {
      const map = cloneObjectMap(watched[profile.id]);
      if (nextIds.has(profile.id)) {
        if (!map[videoId]) {
          map[videoId] = { played: true, timestamp: now };
        }
      } else {
        delete map[videoId];
      }

      if (Object.keys(map).length) watched[profile.id] = map;
      else delete watched[profile.id];
    });

    setSoloWatchedByProfileMap(watched);
  }

  function getSoloWatchedCountsByProfile() {
    const watched = getSoloWatchedByProfileMap();
    return getSoloProfiles().reduce((acc, profile) => {
      acc[profile.id] = Object.keys(normalizeSoloPlayedMap(watched[profile.id])).length;
      return acc;
    }, {});
  }

  function buildSoloProfilesWatchedPayload() {
    const profiles = getSoloProfiles();
    const watched = getSoloWatchedByProfileMap();
    const watchedByProfile = profiles.reduce((acc, profile) => {
      acc[profile.id] = normalizeSoloPlayedMap(watched[profile.id]);
      return acc;
    }, {});
    return {
      version: 2,
      exportedAt: new Date().toISOString(),
      profiles,
      watchedByProfile
    };
  }

  function downloadSoloPlayedJson(filename = 'solo_played_videos.json', profileId) {
    const soloPlayed = getSoloPlayedMap(profileId);
    const blob = new Blob([JSON.stringify(soloPlayed, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function downloadSoloProfilesWatchedJson(filename = 'solo_profiles_watched.json') {
    const blob = new Blob([JSON.stringify(buildSoloProfilesWatchedPayload(), null, 2)], {
      type: 'application/json'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function chooseLegacySoloImportProfileId() {
    const profiles = getSoloProfiles();
    const options = profiles
      .map((profile, index) => `${index + 1}. ${profile.name}`)
      .join('\n');
    const answer = prompt(
      `Import this legacy solo watched JSON into which profile?\n\n${options}\n\nEnter a number, name, or profile id:`,
      '1'
    );
    if (!answer) return null;

    const trimmed = answer.trim();
    const index = parseInt(trimmed, 10);
    if (!Number.isNaN(index) && profiles[index - 1]) return profiles[index - 1].id;

    const normalized = trimmed.toLowerCase();
    const profile = profiles.find((item) =>
      item.id.toLowerCase() === normalized ||
      item.name.toLowerCase() === normalized
    );
    if (profile) return profile.id;

    alert('No matching profile was found for that import target.');
    return null;
  }

  function importSoloProfilesWatchedData(data, profileId) {
    if (data?.watchedByProfile && typeof data.watchedByProfile === 'object' && !Array.isArray(data.watchedByProfile)) {
      const incomingIds = Object.keys(data.watchedByProfile).filter((id) =>
        id.trim() &&
        data.watchedByProfile[id] &&
        typeof data.watchedByProfile[id] === 'object' &&
        !Array.isArray(data.watchedByProfile[id])
      );
      mergeImportedProfiles(data.profiles, incomingIds);
      const watched = { ...getSoloWatchedByProfileMap() };
      incomingIds.forEach((id) => {
        watched[id] = cloneObjectMap(data.watchedByProfile[id]);
      });
      setSoloWatchedByProfileMap(watched);
      return { type: 'bundle', profileIds: incomingIds };
    }

    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      alert('Invalid profile watched JSON');
      return null;
    }

    const targetProfileId = profileId || chooseLegacySoloImportProfileId();
    if (!targetProfileId) return null;
    setSoloPlayedMap(normalizeSoloPlayedMap(data), targetProfileId);
    return { type: 'legacy', profileIds: [targetProfileId] };
  }

  function uploadSoloPlayedJsonFile(file, onDone, profileId) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target.result);
        const result = importSoloProfilesWatchedData(data, profileId);
        if (result && typeof onDone === 'function') onDone(result);
      } catch {
        alert('Invalid JSON file');
      }
    };
    reader.readAsText(file);
  }

  function migrateSoloPlayedToProfiles() {
    if (localStorage.getItem(SOLO_MIGRATION_KEY)) return;

    const legacy = safeParseObject(SOLO_PLAYED_KEY, {});
    const legacyIds = Object.keys(legacy);
    if (legacyIds.length) {
      const watched = { ...getSoloWatchedByProfileMap() };
      const existing = watched.jesse && typeof watched.jesse === 'object' ? watched.jesse : {};
      watched.jesse = { ...legacy, ...existing };
      setSoloWatchedByProfileMap(watched);
    }

    localStorage.setItem(SOLO_MIGRATION_KEY, new Date().toISOString());
  }

  // ===== Excluded videos =====
  function getExcludedMap() {
    if (excludedMapCache === CACHE_UNINITIALIZED) {
      excludedMapCache = safeParseObject(EXCLUDED_KEY, {});
    }
    return excludedMapCache;
  }

  function setExcludedMap(map) {
    const normalized = cloneObjectMap(map);
    localStorage.setItem(EXCLUDED_KEY, JSON.stringify(normalized));
    excludedMapCache = normalized;
  }

  function isExcluded(videoId) {
    const excluded = getExcludedMap();
    return !!excluded[videoId];
  }

  function markExcluded(videoId) {
    const excluded = { ...getExcludedMap(), [videoId]: true };
    setExcludedMap(excluded);
  }

  function unmarkExcluded(videoId) {
    const excluded = { ...getExcludedMap() };
    delete excluded[videoId];
    setExcludedMap(excluded);
  }

  function downloadExcludedJson(filename = 'excluded_videos.json') {
    const excluded = getExcludedMap();
    const videoIds = Object.keys(excluded);
    const blob = new Blob([JSON.stringify(videoIds, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function uploadExcludedJsonFile(file, onDone) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target.result);
        // Accept either array of IDs or map
        if (Array.isArray(data)) {
          const map = data.reduce((acc, key) => {
            acc[key] = true;
            return acc;
          }, {});
          setExcludedMap(map);
        } else {
          setExcludedMap(data);
        }
        if (typeof onDone === 'function') onDone();
      } catch {
        alert('Invalid JSON file');
      }
    };
    reader.readAsText(file);
  }

  function invalidateCachedStorage(event) {
    if (event?.storageArea && event.storageArea !== localStorage) return;

    if (event?.key == null) {
      playedMapCache = CACHE_UNINITIALIZED;
      excludedMapCache = CACHE_UNINITIALIZED;
      soloWatchedByProfileCache = CACHE_UNINITIALIZED;
      soloProfilesCache = CACHE_UNINITIALIZED;
      return;
    }

    if (event.key === PLAYED_KEY) playedMapCache = CACHE_UNINITIALIZED;
    else if (event.key === EXCLUDED_KEY) excludedMapCache = CACHE_UNINITIALIZED;
    else if (event.key === SOLO_WATCHED_BY_PROFILE_KEY) {
      soloWatchedByProfileCache = CACHE_UNINITIALIZED;
    } else if (event.key === SOLO_PROFILES_KEY) {
      soloProfilesCache = CACHE_UNINITIALIZED;
    }
  }

  window.addEventListener?.('storage', invalidateCachedStorage);

  window.Storage = {
    PLAYED_KEY,
    getPlayedMap,
    setPlayedMap,
    isPlayed,
    markPlayed,
    unmarkPlayed,
    downloadPlayedJson,
    uploadPlayedJsonFile,

    SOLO_PLAYED_KEY,
    SOLO_PROFILES_KEY,
    ACTIVE_SOLO_PROFILE_KEY,
    SOLO_VISIBILITY_PROFILE_IDS_KEY,
    SOLO_WATCHED_BY_PROFILE_KEY,
    DEFAULT_SOLO_PROFILES,
    getSoloProfiles,
    setSoloProfiles,
    getActiveSoloProfileId,
    setActiveSoloProfileId,
    getActiveSoloProfile,
    addSoloProfile,
    renameSoloProfile,
    deleteSoloProfile,
    getSoloVisibilityProfileIds,
    setSoloVisibilityProfileIds,
    getEffectiveSoloVisibilityProfileIds,
    getSoloWatchedByProfileMap,
    setSoloWatchedByProfileMap,
    getSoloPlayedMap,
    setSoloPlayedMap,
    isSoloPlayed,
    isSoloPlayedByAnyProfile,
    markSoloPlayed,
    unmarkSoloPlayed,
    getSoloWatchers,
    getSoloWatcherProfileIds,
    setSoloWatcherProfileIds,
    getSoloWatchedCountsByProfile,
    downloadSoloPlayedJson,
    downloadSoloProfilesWatchedJson,
    uploadSoloPlayedJsonFile,

    EXCLUDED_KEY,
    getExcludedMap,
    setExcludedMap,
    isExcluded,
    markExcluded,
    unmarkExcluded,
    downloadExcludedJson,
    uploadExcludedJsonFile
  };

  migrateSoloPlayedToProfiles();
})();
