// js/storage.js
(function () {
  const PLAYED_KEY = 'playedVideos';
  const EXCLUDED_KEY = 'excludedVideos';

  function getPlayedMap() {
    try {
      return JSON.parse(localStorage.getItem(PLAYED_KEY) || '{}');
    } catch {
      return {};
    }
  }

  function setPlayedMap(map) {
    localStorage.setItem(PLAYED_KEY, JSON.stringify(map || {}));
  }

  function isPlayed(videoId) {
    const played = getPlayedMap();
    return !!played[videoId];
  }

  function markPlayed(videoId, extra) {
    const played = getPlayedMap();
    played[videoId] = {
      played: true,
      timestamp: new Date().toISOString(),
      ...(extra || {})
    };
    setPlayedMap(played);
  }

  function unmarkPlayed(videoId) {
    const played = getPlayedMap();
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

  // ===== Excluded videos =====
  function getExcludedMap() {
    try {
      return JSON.parse(localStorage.getItem(EXCLUDED_KEY) || '{}');
    } catch {
      return {};
    }
  }

  function setExcludedMap(map) {
    localStorage.setItem(EXCLUDED_KEY, JSON.stringify(map || {}));
  }

  function isExcluded(videoId) {
    const excluded = getExcludedMap();
    return !!excluded[videoId];
  }

  function markExcluded(videoId) {
    const excluded = getExcludedMap();
    excluded[videoId] = true;
    setExcludedMap(excluded);
  }

  function unmarkExcluded(videoId) {
    const excluded = getExcludedMap();
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

  window.Storage = {
    PLAYED_KEY,
    getPlayedMap,
    setPlayedMap,
    isPlayed,
    markPlayed,
    unmarkPlayed,
    downloadPlayedJson,
    uploadPlayedJsonFile,

    EXCLUDED_KEY,
    getExcludedMap,
    setExcludedMap,
    isExcluded,
    markExcluded,
    unmarkExcluded,
    downloadExcludedJson,
    uploadExcludedJsonFile
  };
})();