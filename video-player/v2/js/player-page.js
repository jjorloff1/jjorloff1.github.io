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

  function isSoloPlayed(videoId) {
    return Storage.isSoloPlayed(videoId);
  }

  function updateTopbarStats() {
    const played = Storage.getPlayedMap();
    const solo = Storage.getSoloPlayedMap();
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
    getEl('soloPlayedCount').textContent = String(countKeys(solo));
    getEl('excludedCount').textContent = String(countKeys(excluded));
  }

  function updateCardState(videoId) {
    document.querySelectorAll(`.video-card[data-id="${CSS.escape(videoId)}"]`).forEach((card) => {
      const played = Storage.isPlayed(videoId);
      const solo = Storage.isSoloPlayed(videoId);
      const excluded = Storage.isExcluded(videoId);

      const playedBadge = card.querySelector('.status-badge.played');
      const soloBadge = card.querySelector('.status-badge.solo');
      const excludedBadge = card.querySelector('.status-badge.excluded');
      if (playedBadge) playedBadge.style.display = played ? 'inline-flex' : 'none';
      if (soloBadge) soloBadge.style.display = solo ? 'inline-flex' : 'none';
      if (excludedBadge) excludedBadge.style.display = excluded ? 'inline-flex' : 'none';

      const playedToggle = card.querySelector('.played-toggle-control');
      const soloToggle = card.querySelector('.solo-toggle-control');
      const excludedToggle = card.querySelector('.excluded-toggle-control');
      if (playedToggle) setToggleButtonState(playedToggle, played);
      if (soloToggle) setToggleButtonState(soloToggle, solo);
      if (excludedToggle) setToggleButtonState(excludedToggle, excluded);
    });

    const modalPlayed = getEl(`modal-played-${videoId}`);
    const modalSolo = getEl(`modal-solo-${videoId}`);
    if (modalPlayed) modalPlayed.checked = Storage.isPlayed(videoId);
    if (modalSolo) modalSolo.checked = Storage.isSoloPlayed(videoId);

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

  function markSoloPlayed(video, card) {
    Storage.markSoloPlayed(video.video_id);
    updateCardState(video.video_id);
    if (getEl('hideSoloPlayed')?.checked) {
      fadeOutVideoCard(card, 'Video marked as solo played.', () => {
        Storage.unmarkSoloPlayed(video.video_id);
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
    statuses.appendChild(createStatusBadge('played', 'Played', Storage.isPlayed(video.video_id)));
    statuses.appendChild(createStatusBadge('solo', 'Solo', Storage.isSoloPlayed(video.video_id)));
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
    actions.appendChild(createActionPill(video, card, 'solo', 'Solo', Storage.isSoloPlayed(video.video_id), (checked) => {
      if (checked) markSoloPlayed(video, card);
      else {
        Storage.unmarkSoloPlayed(video.video_id);
        updateCardState(video.video_id);
      }
    }));
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

    const soloToggleWrap = document.createElement('label');
    soloToggleWrap.className = 'played-toggle';
    const soloToggle = document.createElement('input');
    soloToggle.type = 'checkbox';
    soloToggle.id = `modal-solo-${videoId}`;
    soloToggle.checked = Storage.isSoloPlayed(videoId);
    soloToggle.addEventListener('change', () => {
      if (soloToggle.checked) Storage.markSoloPlayed(videoId);
      else Storage.unmarkSoloPlayed(videoId);
      updateCardState(videoId);
      if (getEl('hideSoloPlayed')?.checked) renderGrid(allVideoData);
    });
    soloToggleWrap.appendChild(soloToggle);
    soloToggleWrap.appendChild(document.createTextNode('Solo Played'));

    container.appendChild(playedToggleWrap);
    container.appendChild(soloToggleWrap);
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

    getEl('downloadPlayed').addEventListener('click', () => Storage.downloadPlayedJson('played_videos.json'));
    getEl('downloadSoloPlayed').addEventListener('click', () => Storage.downloadSoloPlayedJson('solo_played_videos.json'));
    getEl('downloadExcluded').addEventListener('click', () => Storage.downloadExcludedJson('excluded_videos.json'));

    getEl('uploadPlayed').addEventListener('change', (e) => {
      Storage.uploadPlayedJsonFile(e.target.files[0], () => renderGrid(allVideoData));
      e.target.value = '';
    });
    getEl('uploadSoloPlayed').addEventListener('change', (e) => {
      Storage.uploadSoloPlayedJsonFile(e.target.files[0], () => renderGrid(allVideoData));
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
