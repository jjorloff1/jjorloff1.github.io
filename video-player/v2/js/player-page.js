(function () {
  const BATCH_SIZE = 36;
  const VIEW_MODE_KEY = 'videoPlayerV2ViewMode';
  const SORT_KEY = 'videoPlayerV2Sort';

  let allVideoData = [];
  let filteredVideoData = [];
  let currentRenderIndex = 0;

  function getEl(id) {
    return document.getElementById(id);
  }

  function safeNumber(value) {
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : 0;
  }

  function countKeys(map) {
    return Object.keys(map || {}).length;
  }

  function normalizeProfileIds(profileIds) {
    const validIds = new Set(Storage.getSoloProfiles().map((profile) => profile.id));
    return (Array.isArray(profileIds) ? profileIds : []).filter((id, index, arr) =>
      typeof id === 'string' &&
      validIds.has(id) &&
      arr.indexOf(id) === index
    );
  }

  function profileIdsEqual(a, b) {
    const left = normalizeProfileIds(a).slice().sort();
    const right = normalizeProfileIds(b).slice().sort();
    return left.length === right.length && left.every((id, index) => id === right[index]);
  }

  function parseProfileIds(value) {
    try {
      const parsed = JSON.parse(value || '[]');
      return normalizeProfileIds(parsed);
    } catch {
      return [];
    }
  }

  function getProfileInitial(profile) {
    return String(profile?.name || '')
      .trim()
      .charAt(0)
      .toUpperCase();
  }

  function getVideoWatcherProfileIds(videoId) {
    if (window.Storage?.getSoloWatcherProfileIds) {
      return Storage.getSoloWatcherProfileIds(videoId);
    }
    return Storage.getSoloWatchers(videoId).map((profile) => profile.id);
  }

  function getSelectedSoloWatchers(videoId) {
    return Storage.getSoloWatchers(videoId);
  }

  function formatSoloIndicatorText(watchers) {
    return (watchers || [])
      .map(getProfileInitial)
      .filter(Boolean)
      .join(',');
  }

  function formatSoloPopoverContent(videoId) {
    const watchers = getSelectedSoloWatchers(videoId);
    if (!watchers.length) return 'No profiles have seen this';
    return `Seen by: ${watchers.map(formatSoloWatcherLabel).join(', ')}`;
  }

  function applySoloPopover(element, videoId) {
    if (!element) return;
    element.dataset.soloPopover = 'true';
    element.setAttribute('data-bs-toggle', 'popover');
    element.setAttribute('data-bs-trigger', 'hover focus click');
    element.setAttribute('data-bs-placement', 'top');
    element.setAttribute('data-bs-container', 'body');
    element.setAttribute('data-bs-content', formatSoloPopoverContent(videoId));
  }

  function refreshSoloPopovers(scope) {
    if (!window.bootstrap?.Popover) return;
    (scope || document).querySelectorAll('[data-solo-popover="true"]').forEach((element) => {
      const existing = window.bootstrap.Popover.getInstance(element);
      if (existing) existing.dispose();
      window.bootstrap.Popover.getOrCreateInstance(element);
    });
  }

  function disposeSoloPopovers(scope) {
    if (!window.bootstrap?.Popover) return;
    (scope || document).querySelectorAll('[data-solo-popover="true"]').forEach((element) => {
      const existing = window.bootstrap.Popover.getInstance(element);
      if (existing) existing.dispose();
    });
  }

  function shouldHideForSolo(videoId) {
    const watchers = Storage.getSoloWatchers(videoId);
    if (!watchers.length) return false;
    const rules = getSoloVisibilityRulesFromControls();
    const hideIds = new Set(rules.hideProfileIds);
    const alwaysShowIds = new Set(rules.alwaysShowProfileIds);
    return watchers.some((profile) => hideIds.has(profile.id)) &&
      !watchers.some((profile) => alwaysShowIds.has(profile.id));
  }

  function getSoloVisibilityRulesFromControls() {
    const hideProfileIds = [];
    const alwaysShowProfileIds = [];
    document
      .querySelectorAll('#soloVisibilityRules input[type="radio"]:checked')
      .forEach((input) => {
        if (input.value === 'hide') hideProfileIds.push(input.dataset.profileId);
        if (input.value === 'show') alwaysShowProfileIds.push(input.dataset.profileId);
      });
    return { hideProfileIds, alwaysShowProfileIds };
  }

  function getSoloRuleForProfile(profileId) {
    const checked = document.querySelector(
      `#soloVisibilityRules input[type="radio"][data-profile-id="${CSS.escape(profileId)}"]:checked`
    );
    return checked?.value || 'default';
  }

  function formatSoloWatcherLabel(profile) {
    const rule = getSoloRuleForProfile(profile.id);
    if (rule === 'hide') return `${profile.name} (Hide)`;
    if (rule === 'show') return `${profile.name} (Always Show)`;
    return profile.name;
  }

  function updateSoloDownloadLabels() {
    const download = getEl('downloadSoloPlayed');
    const upload = getEl('uploadSoloPlayedLabel');
    if (download) download.textContent = 'Profile watched data';
    if (upload) upload.textContent = 'Profile watched JSON';
  }

  function parseCSV(text) {
    return VideoCatalog.parseCsvText(text);
  }

  function populateCsvSelect() {
    const select = getEl('csvSelect');
    if (!select) return;

    const filenames = VideoLists.listFilenames();
    select.innerHTML = '';

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = filenames.length ? 'Select saved list...' : 'No saved lists yet';
    select.appendChild(placeholder);

    filenames.forEach((name) => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      select.appendChild(opt);
    });

    const last = VideoLists.lastUsed() || '';
    if (last && filenames.includes(last)) select.value = last;
  }

  function populateChannelFilter(data) {
    const channelSelect = getEl('filterChannel');
    if (!channelSelect) return;

    const channels = [...new Set((data || []).map((v) => v.channel_id).filter(Boolean))]
      .sort((a, b) => String(a).toLowerCase().localeCompare(String(b).toLowerCase()));

    channelSelect.innerHTML = '';
    channels.forEach((channel) => {
      const option = document.createElement('option');
      option.value = channel;
      option.textContent = channel;
      channelSelect.appendChild(option);
    });
  }

  function addSoloProfile() {
    const name = prompt('New profile name:');
    if (!name) return;
    Storage.addSoloProfile(name);
    renderProfileControls();
    if (window.VideoFilters?.save) VideoFilters.save();
    renderGrid(allVideoData);
  }

  function renameSoloProfile(profileId) {
    const profile = Storage.getSoloProfiles().find((item) => item.id === profileId);
    if (!profile) return;
    const nextName = prompt('Rename profile:', profile.name);
    if (!nextName) return;
    Storage.renameSoloProfile(profile.id, nextName);
    renderProfileControls();
    if (window.VideoFilters?.save) VideoFilters.save();
    renderGrid(allVideoData);
  }

  function deleteSoloProfile(profileId) {
    const profile = Storage.getSoloProfiles().find((item) => item.id === profileId);
    if (!profile) return;
    if (Storage.getSoloProfiles().length <= 1) {
      alert('At least one profile is required.');
      return;
    }
    const ok = confirm(`Delete profile "${profile.name}" and its watched data?`);
    if (!ok) return;
    Storage.deleteSoloProfile(profile.id);
    renderProfileControls();
    if (window.VideoFilters?.save) VideoFilters.save();
    renderGrid(allVideoData);
  }

  function renderSoloVisibilityControls() {
    const container = getEl('soloVisibilityRules');
    if (!container) return;

    const currentRules = getSoloVisibilityRulesFromControls();
    const hideIds = new Set(currentRules.hideProfileIds);
    const alwaysShowIds = new Set(currentRules.alwaysShowProfileIds);
    container.innerHTML = '';

    Storage.getSoloProfiles().forEach((profile) => {
      const row = document.createElement('div');
      row.className = 'solo-rule-row';

      const rowHeader = document.createElement('div');
      rowHeader.className = 'solo-rule-header';

      const name = document.createElement('div');
      name.className = 'solo-rule-name';
      name.textContent = profile.name;
      name.title = profile.name;

      const actions = document.createElement('div');
      actions.className = 'profile-rule-actions';

      const renameButton = document.createElement('button');
      renameButton.className = 'btn btn-sm btn-app profile-rule-action';
      renameButton.type = 'button';
      renameButton.textContent = 'Rename';
      renameButton.addEventListener('click', () => renameSoloProfile(profile.id));

      const deleteButton = document.createElement('button');
      deleteButton.className = 'btn btn-sm btn-app profile-rule-action';
      deleteButton.type = 'button';
      deleteButton.textContent = 'Delete';
      deleteButton.addEventListener('click', () => deleteSoloProfile(profile.id));

      actions.appendChild(renameButton);
      actions.appendChild(deleteButton);
      rowHeader.appendChild(name);
      rowHeader.appendChild(actions);

      const options = document.createElement('div');
      options.className = 'btn-group btn-group-sm solo-rule-options';
      options.setAttribute('role', 'group');
      options.setAttribute('aria-label', `${profile.name} visibility rule`);

      const selectedValue = alwaysShowIds.has(profile.id)
        ? 'show'
        : hideIds.has(profile.id)
          ? 'hide'
          : 'default';

      [
        { value: 'default', label: 'Default' },
        { value: 'hide', label: 'Hide' },
        { value: 'show', label: 'Always Show' }
      ].forEach((option) => {
        const input = document.createElement('input');
        input.type = 'radio';
        input.className = 'btn-check solo-rule-input';
        input.name = `solo-rule-${profile.id}`;
        input.id = `solo-rule-${profile.id}-${option.value}`;
        input.value = option.value;
        input.dataset.profileId = profile.id;
        input.checked = option.value === selectedValue;
        input.addEventListener('change', () => {
          if (!input.checked) return;
          if (window.VideoFilters?.save) VideoFilters.save();
          renderGrid(allVideoData);
        });

        const label = document.createElement('label');
        label.className = 'btn btn-app';
        label.htmlFor = input.id;
        label.textContent = option.label;

        options.appendChild(input);
        options.appendChild(label);
      });

      row.appendChild(rowHeader);
      row.appendChild(options);
      container.appendChild(row);
    });
  }

  function renderProfileControls() {
    renderSoloVisibilityControls();
    updateSoloDownloadLabels();
    updateTopbarStats();
  }

  function getSortValue() {
    return getEl('sortVideos')?.value || 'rawAsc';
  }

  function sortVideos(videos) {
    const sorted = (videos || []).slice();
    const sort = getSortValue();

    const byNumber = (field, direction) => (a, b) =>
      (safeNumber(a[field]) - safeNumber(b[field])) * direction;
    const byText = (field) => (a, b) =>
      String(a[field] || '').toLowerCase().localeCompare(String(b[field] || '').toLowerCase());

    const sorters = {
      rawAsc: byNumber('raw_difficulty_score', 1),
      rawDesc: byNumber('raw_difficulty_score', -1),
      scaledAsc: byNumber('scaled_difficulty_score', 1),
      scaledDesc: byNumber('scaled_difficulty_score', -1),
      durationAsc: byNumber('duration', 1),
      durationDesc: byNumber('duration', -1),
      titleAsc: byText('title'),
      channelAsc: byText('channel_id')
    };

    return sorted.sort(sorters[sort] || sorters.rawAsc);
  }

  function isPlayed(videoId) {
    return Storage.isPlayed(videoId);
  }

  function isSoloPlayed(videoId, soloRules) {
    if (soloRules && typeof soloRules === 'object' && !Array.isArray(soloRules)) {
      const watchers = Storage.getSoloWatchers(videoId);
      if (!watchers.length) return false;
      const hideIds = new Set(soloRules.hideProfileIds || []);
      const alwaysShowIds = new Set(soloRules.alwaysShowProfileIds || []);
      return watchers.some((profile) => hideIds.has(profile.id)) &&
        !watchers.some((profile) => alwaysShowIds.has(profile.id));
    }
    if (Array.isArray(soloRules)) return Storage.isSoloPlayedByAnyProfile(videoId, soloRules);
    return getVideoWatcherProfileIds(videoId).length > 0;
  }

  function updateTopbarStats() {
    const played = Storage.getPlayedMap();
    const soloCounts = Storage.getSoloWatchedCountsByProfile?.() || {};
    const excluded = Storage.getExcludedMap();

    let totalPlayedSeconds = 0;
    let playedTodaySeconds = 0;
    const today = new Date();

    allVideoData.forEach((video) => {
      const entry = played[video.video_id];
      if (!entry) return;

      const duration = parseInt(video.duration, 10) || 0;
      totalPlayedSeconds += duration;

      if (entry.timestamp) {
        const playedDate = new Date(entry.timestamp);
        if (
          playedDate.getFullYear() === today.getFullYear() &&
          playedDate.getMonth() === today.getMonth() &&
          playedDate.getDate() === today.getDate()
        ) {
          playedTodaySeconds += duration;
        }
      }
    });

    getEl('playedTodayValue').textContent = Time.secondsToHMS(playedTodaySeconds);
    getEl('playedTotalValue').textContent = Time.secondsToHMS(totalPlayedSeconds);
    getEl('playedCount').textContent = String(countKeys(played));
    const profiles = Storage.getSoloProfiles();
    const summary = profiles
      .map((profile) => `${getProfileInitial(profile)} ${soloCounts[profile.id] || 0}`)
      .join(' / ');
    getEl('soloPlayedCount').textContent = summary || '0';
    const profileCountChip = getEl('soloProfileCounts');
    if (profileCountChip) {
      profileCountChip.title = profiles
        .map((profile) => `${profile.name}: ${soloCounts[profile.id] || 0}`)
        .join('\n');
    }
    getEl('excludedCount').textContent = String(countKeys(excluded));
  }

  function updateCardState(videoId) {
    document.querySelectorAll(`.video-card[data-id="${CSS.escape(videoId)}"]`).forEach((card) => {
      const played = Storage.isPlayed(videoId);
      const excluded = Storage.isExcluded(videoId);
      const soloWatchers = getSelectedSoloWatchers(videoId);
      const solo = soloWatchers.length > 0;

      const playedBadge = card.querySelector('.status-badge.played');
      const soloBadge = card.querySelector('.status-badge.solo');
      const excludedBadge = card.querySelector('.status-badge.excluded');
      if (playedBadge) playedBadge.style.display = played ? 'inline-flex' : 'none';
      if (soloBadge) {
        soloBadge.textContent = formatSoloIndicatorText(soloWatchers);
        soloBadge.style.display = soloWatchers.length ? 'inline-flex' : 'none';
        applySoloPopover(soloBadge, videoId);
      }
      if (excludedBadge) excludedBadge.style.display = excluded ? 'inline-flex' : 'none';

      const playedToggle = card.querySelector('.played-toggle-control');
      const soloToggle = card.querySelector('.seen-by-toggle-control');
      const excludedToggle = card.querySelector('.excluded-toggle-control');
      if (playedToggle) setToggleButtonState(playedToggle, played);
      if (soloToggle) {
        soloToggle.textContent = 'Seen By';
        setToggleButtonState(soloToggle, solo);
      }
      const seenByMenu = card.querySelector('.seen-by-menu');
      if (seenByMenu && !seenByMenu.classList.contains('show')) {
        setProfileChecklistSelections(seenByMenu, getVideoWatcherProfileIds(videoId));
      }
      if (excludedToggle) setToggleButtonState(excludedToggle, excluded);
      refreshSoloPopovers(card);
    });

    const modalPlayed = getEl(`modal-played-${videoId}`);
    const modalSeenBy = getEl(`modal-seen-by-${videoId}`);
    if (modalPlayed) modalPlayed.checked = Storage.isPlayed(videoId);
    if (modalSeenBy) setProfileChecklistSelections(modalSeenBy, getVideoWatcherProfileIds(videoId));

    updateTopbarStats();
  }

  function fadeOutVideoCard(card, undoMessage, undoAction) {
    if (!card) return;
    card.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
    card.style.opacity = '0';
    card.style.transform = 'translateY(8px)';

    setTimeout(() => {
      card.remove();

      const undoBar = document.createElement('div');
      undoBar.className = 'undo-bar';
      const message = document.createElement('span');
      message.textContent = undoMessage;
      const undoBtn = document.createElement('button');
      undoBtn.className = 'btn btn-sm btn-light';
      undoBtn.type = 'button';
      undoBtn.textContent = 'Undo';
      undoBtn.addEventListener('click', () => {
        undoAction();
        undoBar.remove();
      });

      undoBar.appendChild(message);
      undoBar.appendChild(undoBtn);
      document.body.appendChild(undoBar);
      setTimeout(() => undoBar.remove(), 10000);
    }, 250);
  }

  function markPlayed(video, card) {
    Storage.markPlayed(video.video_id);
    updateCardState(video.video_id);
    if (getEl('hidePlayed')?.checked) {
      fadeOutVideoCard(card, 'Video marked as played.', () => {
        Storage.unmarkPlayed(video.video_id);
        renderGrid(allVideoData);
      });
    }
  }

  function saveVideoWatcherProfileIds(video, card, nextProfileIds, previousProfileIds) {
    Storage.setSoloWatcherProfileIds(video.video_id, nextProfileIds);
    updateCardState(video.video_id);
    if (shouldHideForSolo(video.video_id)) {
      fadeOutVideoCard(card, 'Profile watched selection saved.', () => {
        Storage.setSoloWatcherProfileIds(video.video_id, previousProfileIds || []);
        renderGrid(allVideoData);
      });
    }
  }

  function markExcluded(video, card) {
    Storage.markExcluded(video.video_id);
    updateCardState(video.video_id);
    const showExcluded = getEl('showExcluded')?.checked;
    const showExcludedOnly = getEl('showExcludedOnly')?.checked;
    if (!showExcluded && !showExcludedOnly) {
      fadeOutVideoCard(card, 'Video excluded.', () => {
        Storage.unmarkExcluded(video.video_id);
        renderGrid(allVideoData);
      });
    }
  }

  function createStatusBadge(className, label, active) {
    const badge = document.createElement('span');
    badge.className = `status-badge ${className}`;
    badge.textContent = label;
    badge.style.display = active ? 'inline-flex' : 'none';
    return badge;
  }

  function setToggleButtonState(button, pressed) {
    button.classList.toggle('is-active', pressed);
    button.setAttribute('aria-pressed', String(pressed));
  }

  function getCheckedProfileIds(scope) {
    return normalizeProfileIds(
      Array.from(scope.querySelectorAll('.profile-watcher-input:checked'))
        .map((input) => input.value)
    );
  }

  function setProfileChecklistSelections(scope, profileIds) {
    const selected = new Set(normalizeProfileIds(profileIds));
    scope.querySelectorAll('.profile-watcher-input').forEach((input) => {
      input.checked = selected.has(input.value);
    });
  }

  function createProfileWatcherChecklist(videoId, idPrefix, selectedProfileIds, onChange) {
    const list = document.createElement('div');
    list.className = 'profile-watcher-list';
    list.id = idPrefix;

    const selected = new Set(normalizeProfileIds(selectedProfileIds));
    Storage.getSoloProfiles().forEach((profile) => {
      const row = document.createElement('label');
      row.className = 'form-check profile-watcher-check';

      const input = document.createElement('input');
      input.className = 'form-check-input profile-watcher-input';
      input.type = 'checkbox';
      input.value = profile.id;
      input.id = `${idPrefix}-${profile.id}`;
      input.checked = selected.has(profile.id);
      input.addEventListener('change', () => {
        if (typeof onChange === 'function') onChange(getCheckedProfileIds(list));
      });

      const label = document.createElement('span');
      label.className = 'form-check-label';
      label.textContent = profile.name;

      row.appendChild(input);
      row.appendChild(label);
      list.appendChild(row);
    });

    return list;
  }

  function createActionPill(video, card, type, label, checked, onChange) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `action-pill ${type} ${type}-toggle-control`;
    button.textContent = label;
    setToggleButtonState(button, checked);
    button.addEventListener('click', () => {
      const nextPressed = button.getAttribute('aria-pressed') !== 'true';
      onChange(nextPressed);
    });
    return button;
  }

  function createSeenByDropdown(video, card) {
    const wrapper = document.createElement('div');
    wrapper.className = 'dropdown seen-by-dropdown';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'action-pill solo seen-by-toggle-control dropdown-toggle';
    button.textContent = 'Seen By';
    button.setAttribute('data-bs-toggle', 'dropdown');
    button.setAttribute('data-bs-auto-close', 'outside');
    button.setAttribute('aria-expanded', 'false');
    setToggleButtonState(button, getVideoWatcherProfileIds(video.video_id).length > 0);

    const menu = document.createElement('div');
    menu.className = 'dropdown-menu seen-by-menu';
    menu.setAttribute('aria-label', 'Profiles who watched this video');
    menu.appendChild(
      createProfileWatcherChecklist(
        video.video_id,
        `seen-by-${video.video_id}`,
        getVideoWatcherProfileIds(video.video_id)
      )
    );

    wrapper.addEventListener('show.bs.dropdown', () => {
      const currentIds = getVideoWatcherProfileIds(video.video_id);
      menu.dataset.previousProfileIds = JSON.stringify(currentIds);
      setProfileChecklistSelections(menu, currentIds);
    });

    wrapper.addEventListener('hidden.bs.dropdown', () => {
      const previousIds = parseProfileIds(menu.dataset.previousProfileIds);
      const nextIds = getCheckedProfileIds(menu);
      if (profileIdsEqual(previousIds, nextIds)) return;
      saveVideoWatcherProfileIds(video, card, nextIds, previousIds);
    });

    wrapper.appendChild(button);
    wrapper.appendChild(menu);
    return wrapper;
  }

  function createVideoCard(video) {
    const card = document.createElement('article');
    card.className = 'video-card';
    card.dataset.id = video.video_id;

    const wrapper = document.createElement('div');
    wrapper.className = 'video-wrapper';

    const img = document.createElement('img');
    img.src = `https://img.youtube.com/vi/${video.video_id}/0.jpg`;
    img.alt = video.title || video.video_id;
    img.className = 'thumbnail';
    img.loading = 'lazy';
    img.addEventListener('click', () => renderPlayer(video.video_id));

    const statuses = document.createElement('div');
    statuses.className = 'status-stack';
    const soloWatchers = getSelectedSoloWatchers(video.video_id);
    const soloBadge = createStatusBadge('solo', formatSoloIndicatorText(soloWatchers), soloWatchers.length > 0);
    applySoloPopover(soloBadge, video.video_id);
    statuses.appendChild(createStatusBadge('played', 'Played', Storage.isPlayed(video.video_id)));
    statuses.appendChild(soloBadge);
    statuses.appendChild(createStatusBadge('excluded', 'Excluded', Storage.isExcluded(video.video_id)));

    const duration = document.createElement('div');
    duration.className = 'video-duration';
    duration.textContent = `${Time.secondsToMSS(video.duration)} - ${video.scaled_difficulty_score ?? ''}`.trim();

    wrapper.appendChild(img);
    wrapper.appendChild(statuses);
    wrapper.appendChild(duration);

    const info = document.createElement('div');
    info.className = 'video-info';

    const title = document.createElement('h3');
    title.className = 'card-title';
    title.title = video.title || '';
    title.textContent = video.title || video.video_id;

    const meta = document.createElement('div');
    meta.className = 'video-meta';
    const channel = document.createElement('div');
    channel.className = 'meta-line';
    channel.textContent = video.channel_id || '';

    meta.appendChild(channel);
    meta.appendChild(createListMetadataLine(video, video.video_id));

    const actions = document.createElement('div');
    actions.className = 'card-actions';
    actions.appendChild(createActionPill(video, card, 'played', 'Played', Storage.isPlayed(video.video_id), (checked) => {
      if (checked) markPlayed(video, card);
      else {
        Storage.unmarkPlayed(video.video_id);
        updateCardState(video.video_id);
      }
    }));
    actions.appendChild(createSeenByDropdown(video, card));
    actions.appendChild(createActionPill(video, card, 'excluded', 'Excluded', Storage.isExcluded(video.video_id), (checked) => {
      if (checked) markExcluded(video, card);
      else {
        Storage.unmarkExcluded(video.video_id);
        updateCardState(video.video_id);
      }
    }));

    info.appendChild(title);
    info.appendChild(meta);
    info.appendChild(actions);

    card.appendChild(wrapper);
    card.appendChild(info);
    return card;
  }

  function renderNextBatch() {
    const grid = getEl('videoGrid');
    const end = Math.min(currentRenderIndex + BATCH_SIZE, filteredVideoData.length);

    for (let i = currentRenderIndex; i < end; i += 1) {
      grid.appendChild(createVideoCard(filteredVideoData[i]));
    }

    currentRenderIndex = end;
    refreshSoloPopovers(grid);
  }

  function renderEmptyState(message) {
    const grid = getEl('videoGrid');
    grid.innerHTML = '';
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = message;
    grid.appendChild(empty);
  }

  function renderGrid(data) {
    const grid = getEl('videoGrid');
    filteredVideoData = sortVideos(VideoFilters.filterData(data, {
      isPlayed,
      isSoloPlayed,
      isExcluded: (id) => Storage.isExcluded(id)
    }));

    currentRenderIndex = 0;
    disposeSoloPopovers(grid);
    grid.innerHTML = '';
    getEl('resultsCount').textContent = `${filteredVideoData.length.toLocaleString()} video${filteredVideoData.length === 1 ? '' : 's'}`;

    if (!data.length) {
      renderEmptyState('Load a CSV or choose a saved list to begin.');
    } else if (!filteredVideoData.length) {
      renderEmptyState('No videos match the current filters.');
    } else {
      renderNextBatch();
    }

    updateTopbarStats();
  }

  function loadAndRenderFromCsvText(csvText, filenameForLastUsed) {
    if (!csvText) return;
    if (filenameForLastUsed) VideoLists.setLastUsed(filenameForLastUsed);

    allVideoData = parseCSV(csvText);
    populateChannelFilter(allVideoData);
    VideoFilters.restore();
    renderGrid(allVideoData);
  }

  function formatMetaLabel(key) {
    const labels = {
      channel_id: 'Channel',
      video_id: 'Video ID',
      duration: 'Duration',
      scaled_difficulty_score: 'Scaled',
      raw_difficulty_score: 'Raw'
    };
    if (labels[key]) return labels[key];
    return String(key || '')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }

  function formatMetaValue(key, value) {
    if (value == null || value === '') return '';
    if (key === 'duration') {
      return `${Time.secondsToMSS(value)} (${value}s)`;
    }
    return String(value);
  }

  function getMetadataEntries(video, fallbackVideoId) {
    const metadata = video ? { ...video } : { video_id: fallbackVideoId };
    if (!metadata.video_id && fallbackVideoId) metadata.video_id = fallbackVideoId;

    const preferredOrder = [
      'channel_id',
      'video_id',
      'duration',
      'scaled_difficulty_score',
      'raw_difficulty_score'
    ];
    const omittedKeys = new Set(['title']);

    const orderedKeys = preferredOrder
      .filter((key) => key in metadata && !omittedKeys.has(key))
      .concat(Object.keys(metadata).filter((key) => !preferredOrder.includes(key) && !omittedKeys.has(key)));

    return orderedKeys
      .map((key) => ({
        key,
        label: formatMetaLabel(key),
        value: formatMetaValue(key, metadata[key])
      }))
      .filter((entry) => entry.value !== '');
  }

  function createListMetadataLine(video, fallbackVideoId) {
    const line = document.createElement('div');
    line.className = 'metadata-line';
    line.setAttribute('aria-label', 'Video metadata');

    getMetadataEntries(video, fallbackVideoId).forEach((entry, index) => {
      if (index > 0) {
        const separator = document.createElement('span');
        separator.className = 'metadata-separator';
        separator.textContent = '|';
        line.appendChild(separator);
      }
      const label = document.createElement('span');
      label.className = 'metadata-line-label';
      label.textContent = `${entry.label}: `;

      const value = document.createElement('span');
      value.className = 'metadata-line-value';
      value.textContent = entry.value;
      value.title = entry.value;

      line.appendChild(label);
      line.appendChild(value);
    });

    return line;
  }

  function createModalMetadata(video, fallbackVideoId) {
    const entries = getMetadataEntries(video, fallbackVideoId);

    const panel = document.createElement('section');
    panel.className = 'modal-meta';
    panel.setAttribute('aria-label', 'Video metadata');

    const heading = document.createElement('h2');
    heading.className = 'modal-meta-title';
    heading.textContent = 'Video Metadata';

    const grid = document.createElement('div');
    grid.className = 'modal-meta-grid';

    entries.forEach((entry) => {
      const item = document.createElement('div');
      item.className = 'modal-meta-item';

      const label = document.createElement('div');
      label.className = 'modal-meta-label';
      label.textContent = entry.label;

      const valueEl = document.createElement('div');
      valueEl.className = 'modal-meta-value';
      valueEl.textContent = entry.value;

      item.appendChild(label);
      item.appendChild(valueEl);
      grid.appendChild(item);
    });

    panel.appendChild(heading);
    panel.appendChild(grid);
    return panel;
  }

  function renderPlayer(videoId) {
    const video = allVideoData.find((v) => v.video_id === videoId);
    PlayerModal.open(videoId, video?.title || videoId);

    const container = getEl('video-player');

    const playedToggleWrap = document.createElement('label');
    playedToggleWrap.className = 'played-toggle';
    const playedToggle = document.createElement('input');
    playedToggle.type = 'checkbox';
    playedToggle.id = `modal-played-${videoId}`;
    playedToggle.checked = Storage.isPlayed(videoId);
    playedToggle.addEventListener('change', () => {
      if (playedToggle.checked) Storage.markPlayed(videoId);
      else Storage.unmarkPlayed(videoId);
      updateCardState(videoId);
      if (getEl('hidePlayed')?.checked) renderGrid(allVideoData);
    });
    playedToggleWrap.appendChild(playedToggle);
    playedToggleWrap.appendChild(document.createTextNode('Played'));

    const seenByPanel = document.createElement('section');
    seenByPanel.className = 'modal-seen-by';
    const seenByTitle = document.createElement('h2');
    seenByTitle.className = 'modal-seen-by-title';
    seenByTitle.textContent = 'Seen By';
    const seenByList = createProfileWatcherChecklist(
      videoId,
      `modal-seen-by-${videoId}`,
      getVideoWatcherProfileIds(videoId),
      (nextProfileIds) => {
        Storage.setSoloWatcherProfileIds(videoId, nextProfileIds);
        updateCardState(videoId);
        if (shouldHideForSolo(videoId)) renderGrid(allVideoData);
      }
    );
    seenByPanel.appendChild(seenByTitle);
    seenByPanel.appendChild(seenByList);

    container.appendChild(playedToggleWrap);
    container.appendChild(seenByPanel);
    container.appendChild(createModalMetadata(video, videoId));
  }

  function closeModal() {
    PlayerModal.close();
  }

  function setViewMode(mode) {
    const grid = getEl('videoGrid');
    const isList = mode === 'list';
    grid.classList.toggle('list-mode', isList);
    getEl('gridMode').classList.toggle('active', !isList);
    getEl('listMode').classList.toggle('active', isList);
    getEl('gridMode').setAttribute('aria-pressed', String(!isList));
    getEl('listMode').setAttribute('aria-pressed', String(isList));
    localStorage.setItem(VIEW_MODE_KEY, isList ? 'list' : 'grid');
  }

  function wireEvents() {
    getEl('csvFile').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (event) => {
        const csvText = event.target.result;
        VideoLists.saveCsvText(file.name, csvText);
        VideoLists.setLastUsed(file.name);
        populateCsvSelect();
        getEl('csvSelect').value = file.name;
        loadAndRenderFromCsvText(csvText, file.name);
      };
      reader.readAsText(file);
    });

    getEl('csvSelect').addEventListener('change', (e) => {
      const filename = e.target.value;
      if (!filename) return;
      const csvText = VideoLists.loadCsvText(filename);
      if (!csvText) {
        alert('Could not find stored CSV for: ' + filename);
        return;
      }
      loadAndRenderFromCsvText(csvText, filename);
    });

    getEl('addSoloProfile')?.addEventListener('click', addSoloProfile);

    getEl('downloadPlayed').addEventListener('click', () => Storage.downloadPlayedJson('played_videos.json'));
    getEl('downloadSoloPlayed').addEventListener('click', () =>
      Storage.downloadSoloProfilesWatchedJson('profile_watched_data.json')
    );
    getEl('downloadExcluded').addEventListener('click', () => Storage.downloadExcludedJson('excluded_videos.json'));

    getEl('uploadPlayed').addEventListener('change', (e) => {
      Storage.uploadPlayedJsonFile(e.target.files[0], () => renderGrid(allVideoData));
      e.target.value = '';
    });
    getEl('uploadSoloPlayed').addEventListener('change', (e) => {
      Storage.uploadSoloPlayedJsonFile(e.target.files[0], () => {
        renderProfileControls();
        renderGrid(allVideoData);
      });
      e.target.value = '';
    });
    getEl('uploadExcluded').addEventListener('change', (e) => {
      Storage.uploadExcludedJsonFile(e.target.files[0], () => renderGrid(allVideoData));
      e.target.value = '';
    });

    getEl('clearFilters').addEventListener('click', () => {
      VideoFilters.clear();
      renderGrid(allVideoData);
    });

    getEl('sortVideos').addEventListener('change', (e) => {
      localStorage.setItem(SORT_KEY, e.target.value);
      renderGrid(allVideoData);
    });

    getEl('gridMode').addEventListener('click', () => setViewMode('grid'));
    getEl('listMode').addEventListener('click', () => setViewMode('list'));

    getEl('closeModal').addEventListener('click', closeModal);
    window.addEventListener('click', (event) => {
      if (event.target === getEl('videoModal')) closeModal();
    });

    window.addEventListener('scroll', () => {
      if ((window.innerHeight + window.scrollY) >= document.body.offsetHeight - 260) {
        renderNextBatch();
      }
    });
  }

  function init() {
    populateCsvSelect();

    const savedSort = localStorage.getItem(SORT_KEY);
    if (savedSort) getEl('sortVideos').value = savedSort;
    setViewMode(localStorage.getItem(VIEW_MODE_KEY) || 'grid');

    PlayerModal.init({
      modalId: 'videoModal',
      playerContainerId: 'video-player'
    });

    renderProfileControls();

    VideoFilters.init({
      render: () => renderGrid(allVideoData),
      isPlayed,
      isSoloPlayed,
      isExcluded: (id) => Storage.isExcluded(id)
    });

    wireEvents();

    const last = VideoLists.lastUsed() || '';
    const csvText = last ? VideoLists.loadCsvText(last) : '';
    if (csvText) {
      getEl('csvSelect').value = last;
      loadAndRenderFromCsvText(csvText, last);
    } else {
      renderGrid(allVideoData);
    }
  }

  init();
})();
