

// js/video-lists.js
(function () {
  const VIDEO_LISTS_INDEX_KEY = 'videoListsIndex';
  const VIDEO_LIST_PREFIX = 'videoList:'; // full key = videoList:<filename>
  const LAST_USED_FILENAME_KEY = 'lastUsedFilename';

  function listFilenames() {
    try {
      const arr = JSON.parse(localStorage.getItem(VIDEO_LISTS_INDEX_KEY) || '[]');
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  function setFilenamesIndex(arr) {
    localStorage.setItem(VIDEO_LISTS_INDEX_KEY, JSON.stringify(arr || []));
  }

  function saveCsvText(filename, csvText) {
    if (!filename) return;
    localStorage.setItem(VIDEO_LIST_PREFIX + filename, csvText);

    const idx = listFilenames();
    if (!idx.includes(filename)) {
      idx.push(filename);
      idx.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
      setFilenamesIndex(idx);
    }
  }

  function loadCsvText(filename) {
    if (!filename) return null;
    return localStorage.getItem(VIDEO_LIST_PREFIX + filename);
  }

  function loadAllCsvTexts() {
    return listFilenames()
      .map((filename) => ({ filename, csvText: loadCsvText(filename) }))
      .filter((x) => x.csvText);
  }

  function lastUsed() {
    return localStorage.getItem(LAST_USED_FILENAME_KEY);
  }

  function setLastUsed(filename) {
    if (!filename) return;
    localStorage.setItem(LAST_USED_FILENAME_KEY, filename);
  }

  window.VideoLists = {
    INDEX_KEY: VIDEO_LISTS_INDEX_KEY,
    PREFIX: VIDEO_LIST_PREFIX,
    listFilenames,
    saveCsvText,
    loadCsvText,
    loadAllCsvTexts,
    lastUsed,
    setLastUsed
  };

  // ===== VideoCatalog: consistent parsing + lookup building =====
  function parseCsvText(csvText) {
    return Papa.parse(csvText, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: true
    }).data;
  }

  function buildVideoByIdFromCsvTexts(csvTextEntries) {
    const allRows = [];
    const videoById = {};

    const hasDuration = (x) => x && x.duration != null && String(x.duration).trim() !== '';
    const hasTitle = (x) => x && x.title != null && String(x.title).trim() !== '';

    csvTextEntries.forEach(({ csvText }) => {
      if (!csvText) return;
      const rows = parseCsvText(csvText);
      allRows.push(...rows);

      rows.forEach((v) => {
        if (!v || !v.video_id) return;
        const existing = videoById[v.video_id];
        if (!existing) {
          videoById[v.video_id] = v;
          return;
        }

        const shouldReplace = (!hasDuration(existing) && hasDuration(v)) || (!hasTitle(existing) && hasTitle(v));
        if (shouldReplace) videoById[v.video_id] = v;
      });
    });

    return { videoById, allRows };
  }

  window.VideoCatalog = {
    parseCsvText,
    buildVideoByIdFromCsvTexts
  };
})();