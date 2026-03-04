/* js/video-filters.js
 *
 * Owns:
 * - Reading/writing current filter state to localStorage (videoFilters)
 * - Wiring filter input events to save + rerender (debounced)
 * - Clear filters behavior
 * - Filtering data (filterData)
 * - Filter Sets (save, save as, rename, delete, import/export)
 * - “Selected: X (saved/modified)” status indicator
 *
 * Expects the host page to provide:
 *   VideoFilters.init({
 *     render: () => { ... },
 *     isPlayed: (videoId) => boolean,
 *     isSoloPlayed: (videoId) => boolean,
 *     isExcluded: (videoId) => boolean
 *   })
 */

(function () {
  const CURRENT_FILTERS_KEY = 'videoFilters';

  const FILTER_SETS_KEY = 'videoFilterSets'; // array: [{name, filters, updatedAt}]
  const ACTIVE_FILTER_SET_KEY = 'activeFilterSetName';

  // Default UI baseline (what Clear should restore to)
  // Note: hidePlayed is default true in your UI today
  const DEFAULTS = {
    filterTitleIncludes: '',
    filterTitleExcludes: '',
    filterMinDuration: '',
    filterMaxDuration: '',
    filterMinRaw: '',
    filterMaxRaw: '',
    filterMinScaled: '',
    filterMaxScaled: '',
    hidePlayed: true,
    hideSoloPlayed: false,
    showExcluded: false,
    showExcludedOnly: false,
    filterChannel: []
  };

  let _render = null;
  let _isPlayed = () => false;
  let _isSoloPlayed = () => false;
  let _isExcluded = () => false;

  // ---------- small utils ----------
  function debounce(fn, delay) {
    let timer;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  function safeJsonParse(str, fallback) {
    try {
      return JSON.parse(str);
    } catch {
      return fallback;
    }
  }

  function getEl(id) {
    return document.getElementById(id);
  }

  function normalizeFiltersForCompare(filters) {
    const f = { ...DEFAULTS, ...JSON.parse(JSON.stringify(filters || {})) };
    if (Array.isArray(f.filterChannel)) {
      f.filterChannel = [...f.filterChannel].sort((a, b) =>
        String(a).localeCompare(String(b))
      );
    }
    return f;
  }

  function filtersEqual(a, b) {
    return (
      JSON.stringify(normalizeFiltersForCompare(a)) ===
      JSON.stringify(normalizeFiltersForCompare(b))
    );
  }

  // ---------- current filters (active state) ----------
  function getCurrentFiltersFromUI() {
    const filterMap = {
      filterTitleIncludes: 'value',
      filterTitleExcludes: 'value',
      filterMinDuration: 'value',
      filterMaxDuration: 'value',
      filterMinRaw: 'value',
      filterMaxRaw: 'value',
      filterMinScaled: 'value',
      filterMaxScaled: 'value',
      hidePlayed: 'checked',
      hideSoloPlayed: 'checked',
      showExcluded: 'checked',
      showExcludedOnly: 'checked'
    };

    const filters = {};
    Object.entries(filterMap).forEach(([id, prop]) => {
      const el = getEl(id);
      if (el) filters[id] = el[prop];
    });

    const channelSelect = getEl('filterChannel');
    if (channelSelect) {
      filters.filterChannel = Array.from(channelSelect.selectedOptions).map(
        (opt) => opt.value
      );
    } else {
      filters.filterChannel = [];
    }

    return filters;
  }

  function applyFiltersToUI(filters) {
    const f = filters || {};

    const map = {
      filterTitleIncludes: 'value',
      filterTitleExcludes: 'value',
      filterMinDuration: 'value',
      filterMaxDuration: 'value',
      filterMinRaw: 'value',
      filterMaxRaw: 'value',
      filterMinScaled: 'value',
      filterMaxScaled: 'value',
      hidePlayed: 'checked',
      hideSoloPlayed: 'checked',
      showExcluded: 'checked',
      showExcludedOnly: 'checked'
    };

    Object.entries(map).forEach(([id, prop]) => {
      const el = getEl(id);
      if (!el) return;
      if (f[id] === undefined) return;
      el[prop] = f[id];
    });

    const channelSelect = getEl('filterChannel');
    if (channelSelect && Array.isArray(f.filterChannel)) {
      Array.from(channelSelect.options).forEach((opt) => {
        opt.selected = f.filterChannel.includes(opt.value);
      });
    }
  }

  function loadCurrentFiltersFromStorage() {
    const saved = safeJsonParse(localStorage.getItem(CURRENT_FILTERS_KEY) || '{}', {});
    // Ensure missing keys fall back to defaults
    return { ...DEFAULTS, ...saved };
  }

  function saveCurrentFiltersToStorage(filters) {
    localStorage.setItem(CURRENT_FILTERS_KEY, JSON.stringify(filters || {}));
    updateFilterSetStatus();
  }

  function restore() {
    const saved = loadCurrentFiltersFromStorage();
    applyFiltersToUI(saved);
    updateFilterSetStatus();
  }

  function clear() {
    applyFiltersToUI(DEFAULTS);
    saveFilterValues(); // persist + status
  }

  function saveFilterValues() {
    const filters = getCurrentFiltersFromUI();
    saveCurrentFiltersToStorage(filters);
  }

  // ---------- filtering ----------
  function getFilterPredicate() {
    const showExcluded = !!getEl('showExcluded')?.checked;
    const showExcludedOnly = !!getEl('showExcludedOnly')?.checked;
    const hidePlayed = !!getEl('hidePlayed')?.checked;
    const hideSoloPlayed = !!getEl('hideSoloPlayed')?.checked;

    const selectedChannels = Array.from(
      getEl('filterChannel')?.selectedOptions || []
    ).map((opt) => opt.value);

    const titleIncludesArr = (getEl('filterTitleIncludes')?.value || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

    const titleExcludesArr = (getEl('filterTitleExcludes')?.value || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

    const minDuration = parseInt(getEl('filterMinDuration')?.value, 10);
    const maxDuration = parseInt(getEl('filterMaxDuration')?.value, 10);

    const minRaw = parseFloat(getEl('filterMinRaw')?.value);
    const maxRaw = parseFloat(getEl('filterMaxRaw')?.value);

    const minScaled = parseFloat(getEl('filterMinScaled')?.value);
    const maxScaled = parseFloat(getEl('filterMaxScaled')?.value);

    return function (video) {
      const id = video.video_id;

      // Excluded behavior
      if (!(showExcluded || showExcludedOnly) && _isExcluded(id)) return false;
      if (showExcludedOnly && !_isExcluded(id)) return false;

      // Played behavior
      if (hidePlayed && _isPlayed(id)) return false;
      if (hideSoloPlayed && _isSoloPlayed(id)) return false;

      // Channel filter
      if (selectedChannels.length && !selectedChannels.includes(video.channel_id))
        return false;

      // Title includes/excludes (comma-separated lists)
      const title = (video.title || '').toLowerCase();
      if (titleIncludesArr.length && !titleIncludesArr.some((inc) => title.includes(inc)))
        return false;
      if (titleExcludesArr.length && titleExcludesArr.some((exc) => title.includes(exc)))
        return false;

      // Numeric filters
      const dur = parseInt(video.duration, 10);
      if (!isNaN(minDuration) && dur < minDuration) return false;
      if (!isNaN(maxDuration) && dur > maxDuration) return false;

      const raw = parseFloat(video.raw_difficulty_score);
      if (!isNaN(minRaw) && raw < minRaw) return false;
      if (!isNaN(maxRaw) && raw > maxRaw) return false;

      const scaled = parseFloat(video.scaled_difficulty_score);
      if (!isNaN(minScaled) && scaled < minScaled) return false;
      if (!isNaN(maxScaled) && scaled > maxScaled) return false;

      return true;
    };
  }

  function filterData(data /* array */, { isPlayed, isSoloPlayed, isExcluded } = {}) {
    if (typeof isPlayed === 'function') _isPlayed = isPlayed;
    if (typeof isSoloPlayed === 'function') _isSoloPlayed = isSoloPlayed;
    if (typeof isExcluded === 'function') _isExcluded = isExcluded;
    const predicate = getFilterPredicate();
    return (data || []).filter(predicate);
  }

  // ---------- filter sets ----------
  function loadFilterSets() {
    const raw = safeJsonParse(localStorage.getItem(FILTER_SETS_KEY) || '[]', []);
    return Array.isArray(raw) ? raw : [];
  }

  function saveFilterSets(sets) {
    localStorage.setItem(FILTER_SETS_KEY, JSON.stringify(sets || []));
  }

  function findFilterSetByName(sets, name) {
    return (sets || []).find((s) => s && s.name === name) || null;
  }

  function setActiveFilterSetName(name) {
    if (name) localStorage.setItem(ACTIVE_FILTER_SET_KEY, name);
    else localStorage.removeItem(ACTIVE_FILTER_SET_KEY);
    updateFilterSetStatus();
  }

  function populateFilterSetSelect() {
    const select = getEl('filterSetSelect');
    if (!select) return;

    const sets = loadFilterSets();
    const activeName = localStorage.getItem(ACTIVE_FILTER_SET_KEY) || '';

    select.innerHTML = '';

    const none = document.createElement('option');
    none.value = '';
    none.textContent = sets.length ? '(No set selected)' : '(No saved sets)';
    select.appendChild(none);

    sets
      .slice()
      .sort((a, b) =>
        String(a.name).toLowerCase().localeCompare(String(b.name).toLowerCase())
      )
      .forEach((s) => {
        const opt = document.createElement('option');
        opt.value = s.name;
        opt.textContent = s.name;
        select.appendChild(opt);
      });

    if (activeName && findFilterSetByName(sets, activeName)) {
      select.value = activeName;
    }

    updateFilterSetStatus();
  }

  function updateFilterSetStatus() {
    const icon = getEl('filterSetStatusIcon');
    const select = getEl('filterSetSelect');
    if (!icon || !select) return;

    const selectedName = select.value || '';

    // Icons:
    // ○ = no set selected
    // ✔ = selected set matches current filters
    // ✎ = selected set modified (current filters differ)
    // ⚠ = selected set missing

    if (!selectedName) {
      icon.textContent = '○';
      icon.title = 'No filter set selected';
      icon.setAttribute('aria-label', 'No filter set selected');
      return;
    }

    const sets = loadFilterSets();
    const set = findFilterSetByName(sets, selectedName);
    if (!set) {
      icon.textContent = '⚠';
      icon.title = `Selected filter set "${selectedName}" is missing`;
      icon.setAttribute('aria-label', `Selected filter set ${selectedName} is missing`);
      return;
    }

    const current = getCurrentFiltersFromUI();
    const modified = !filtersEqual(current, set.filters);

    if (modified) {
      icon.textContent = '✎';
      icon.title = `Selected filter set "${selectedName}" is modified (current filters differ)`;
      icon.setAttribute('aria-label', `Selected filter set ${selectedName} is modified`);
    } else {
      icon.textContent = '✔';
      icon.title = `Selected filter set "${selectedName}" matches current filters`;
      icon.setAttribute('aria-label', `Selected filter set ${selectedName} matches current filters`);
    }
  }

  function saveCurrentToSet(name, { overwrite } = { overwrite: true }) {
    const trimmed = String(name || '').trim();
    if (!trimmed) return false;

    const sets = loadFilterSets();
    const existing = findFilterSetByName(sets, trimmed);
    if (existing && !overwrite) return false;

    const snapshot = getCurrentFiltersFromUI();
    const next = sets.filter((s) => s && s.name !== trimmed);
    next.push({ name: trimmed, filters: snapshot, updatedAt: Date.now() });

    saveFilterSets(next);
    setActiveFilterSetName(trimmed);
    populateFilterSetSelect();
    return true;
  }

  function deleteSet(name) {
    const trimmed = String(name || '').trim();
    if (!trimmed) return;
    const sets = loadFilterSets();
    const next = sets.filter((s) => s && s.name !== trimmed);
    saveFilterSets(next);
    setActiveFilterSetName('');
    populateFilterSetSelect();
  }

  function renameSet(oldName, newName) {
    const from = String(oldName || '').trim();
    const to = String(newName || '').trim();
    if (!from || !to) return;

    const sets = loadFilterSets();
    const existingFrom = findFilterSetByName(sets, from);
    if (!existingFrom) return;

    // overwrite target name if it exists
    const next = sets.filter((s) => s && s.name !== from && s.name !== to);
    next.push({ name: to, filters: existingFrom.filters, updatedAt: Date.now() });

    saveFilterSets(next);
    setActiveFilterSetName(to);
    populateFilterSetSelect();
  }

  function downloadFilterSetsJson(filename = 'video_filter_sets.json') {
    const sets = loadFilterSets();
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      sets: sets
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function importFilterSetsJsonFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target.result);
        const incoming = Array.isArray(parsed)
          ? parsed
          : Array.isArray(parsed.sets)
            ? parsed.sets
            : [];

        const cleanIncoming = incoming
          .filter((s) => s && typeof s.name === 'string' && s.name.trim())
          .map((s) => ({
            name: s.name.trim(),
            filters: s.filters || {},
            updatedAt: s.updatedAt || Date.now()
          }));

        const existing = loadFilterSets();
        const existingNames = new Set(existing.map((s) => s.name));
        const conflicts = cleanIncoming
          .filter((s) => existingNames.has(s.name))
          .map((s) => s.name);

        if (conflicts.length) {
          const ok = confirm(
            `Import will overwrite ${conflicts.length} existing set(s):\n\n${conflicts.join(
              '\n'
            )}\n\nContinue?`
          );
          if (!ok) return;
        }

        // Merge by name (incoming overwrites)
        const merged = existing
          .filter((s) => !cleanIncoming.some((i) => i.name === s.name))
          .concat(cleanIncoming);

        saveFilterSets(merged);
        populateFilterSetSelect();
        updateFilterSetStatus();
      } catch {
        alert('Invalid filter sets JSON');
      }
    };
    reader.readAsText(file);
  }

  // ---------- wiring ----------
  function init({ render, isPlayed, isSoloPlayed, isExcluded } = {}) {
    _render = typeof render === 'function' ? render : null;
    _isPlayed = typeof isPlayed === 'function' ? isPlayed : _isPlayed;
    _isSoloPlayed = typeof isSoloPlayed === 'function' ? isSoloPlayed : _isSoloPlayed;
    _isExcluded = typeof isExcluded === 'function' ? isExcluded : _isExcluded;

    // populate dropdown immediately
    populateFilterSetSelect();

    // Debounced render for text/number filters
    const debouncedRender = debounce(() => {
      saveFilterValues();
      if (_render) _render();
    }, 200);

    // “input” is great for text/number
    const filterInputs = document.querySelectorAll('.filters input, .filters select');
    filterInputs.forEach((el) => el.addEventListener('input', debouncedRender));

    // Some elements (select + checkboxes) are more reliable with change
    filterInputs.forEach((el) =>
      el.addEventListener('change', () => {
        saveFilterValues();
        if (_render) _render();
      })
    );

    const channel = getEl('filterChannel');
    if (channel) {
      channel.addEventListener('change', () => {
        saveFilterValues();
        if (_render) _render();
      });
    }

    ['hidePlayed', 'hideSoloPlayed', 'showExcluded', 'showExcludedOnly'].forEach((id) => {
      const el = getEl(id);
      if (!el) return;
      el.addEventListener('change', () => {
        saveFilterValues();
        if (_render) _render();
      });
    });

    // Filter Sets: auto-apply on select
    const setSelect = getEl('filterSetSelect');
    if (setSelect) {
      setSelect.addEventListener('change', (e) => {
        const name = e.target.value || '';
        setActiveFilterSetName(name);
        if (!name) {
          updateFilterSetStatus();
          return;
        }
        const sets = loadFilterSets();
        const set = findFilterSetByName(sets, name);
        if (!set) {
          updateFilterSetStatus();
          return;
        }
        applyFiltersToUI(set.filters);
        saveFilterValues();
        if (_render) _render();
        updateFilterSetStatus();
      });
    }

    // Buttons
    const saveBtn = getEl('saveFilterSet');
    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        const select = getEl('filterSetSelect');
        const name = select?.value || '';
        if (!name) {
          const proposed = prompt('Name this filter set:');
          if (!proposed) return;
          saveCurrentToSet(proposed, { overwrite: true });
          return;
        }
        saveCurrentToSet(name, { overwrite: true });
      });
    }

    const saveAsBtn = getEl('saveAsFilterSet');
    if (saveAsBtn) {
      saveAsBtn.addEventListener('click', () => {
        const proposed = prompt('Save filter set as:');
        if (!proposed) return;
        const name = proposed.trim();
        if (!name) return;

        const sets = loadFilterSets();
        const exists = !!findFilterSetByName(sets, name);
        if (exists) {
          const ok = confirm('A filter set with that name already exists. Overwrite it?');
          if (!ok) return;
        }
        saveCurrentToSet(name, { overwrite: true });
      });
    }

    const renameBtn = getEl('renameFilterSet');
    if (renameBtn) {
      renameBtn.addEventListener('click', () => {
        const select = getEl('filterSetSelect');
        const oldName = select?.value || '';
        if (!oldName) {
          alert('Select a filter set to rename.');
          return;
        }
        const proposed = prompt('Rename filter set to:', oldName);
        if (!proposed) return;
        const newName = proposed.trim();
        if (!newName) return;

        const sets = loadFilterSets();
        const exists = !!findFilterSetByName(sets, newName);
        if (exists && newName !== oldName) {
          const ok = confirm('A filter set with that name already exists. Overwrite it?');
          if (!ok) return;
        }
        renameSet(oldName, newName);
      });
    }

    const deleteBtn = getEl('deleteFilterSet');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', () => {
        const select = getEl('filterSetSelect');
        const name = select?.value || '';
        if (!name) {
          alert('Select a filter set to delete.');
          return;
        }
        const ok = confirm(`Delete filter set "${name}"?`);
        if (!ok) return;
        deleteSet(name);
      });
    }

    const downloadBtn = getEl('downloadFilterSets');
    if (downloadBtn) {
      downloadBtn.addEventListener('click', () => downloadFilterSetsJson());
    }

    const importBtn = getEl('importFilterSetsBtn');
    const importInput = getEl('importFilterSets');
    if (importBtn && importInput) {
      importBtn.addEventListener('click', () => importInput.click());
      importInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        importFilterSetsJsonFile(file);
        // allow re-importing the same file
        e.target.value = '';
      });
    }

    // Status update when anything changes
    updateFilterSetStatus();
  }

  // Expose minimal API for page usage
  window.VideoFilters = {
    init,
    restore,
    clear,
    save: saveFilterValues,
    filterData,
    getCurrentFiltersFromUI,
    applyFiltersToUI,
    updateFilterSetStatus,
    populateFilterSetSelect
  };
})();