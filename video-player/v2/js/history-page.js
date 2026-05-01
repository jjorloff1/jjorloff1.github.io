(function () {
  const DAYS_BATCH_SIZE = 6;

  let videoById = {};
  let cumulativeChart = null;
  let weeklyChart = null;
  let showAllHistory = false;
  let renderedDayCount = 0;
  let cachedDayKeys = [];
  let cachedByDay = {};

  function getEl(id) {
    return document.getElementById(id);
  }

  function rebuildVideoMapFromSavedLists() {
    const entries = VideoLists.loadAllCsvTexts();
    const built = VideoCatalog.buildVideoByIdFromCsvTexts(entries);
    videoById = built.videoById;
  }

  function ensureVideoMapReady() {
    if (Object.keys(videoById).length > 0) return;
    rebuildVideoMapFromSavedLists();
  }

  function computeAggregates() {
    ensureVideoMapReady();
    const played = Storage.getPlayedMap();

    let totalPlayedSeconds = 0;
    let playedTodaySeconds = 0;
    const today = new Date();
    const byDay = {};

    Object.keys(played).forEach((videoId) => {
      const video = videoById[videoId];
      if (!video) return;

      const duration = parseInt(video.duration, 10) || 0;
      totalPlayedSeconds += duration;

      const ts = played[videoId]?.timestamp;
      if (!ts) return;

      const playedDate = new Date(ts);
      if (
        playedDate.getFullYear() === today.getFullYear() &&
        playedDate.getMonth() === today.getMonth() &&
        playedDate.getDate() === today.getDate()
      ) {
        playedTodaySeconds += duration;
      }

      const key = Time.ymd(ts);
      if (!byDay[key]) byDay[key] = { seconds: 0, items: [] };
      byDay[key].seconds += duration;
      byDay[key].items.push(videoId);
    });

    return { totalPlayedSeconds, playedTodaySeconds, byDay };
  }

  function updateTotalsDisplay() {
    const { totalPlayedSeconds, playedTodaySeconds } = computeAggregates();

    if (Object.keys(Storage.getPlayedMap()).length > 0 && Object.keys(videoById).length === 0) {
      getEl('playedTodayValue').textContent = '0:00:00';
      getEl('playedTotalValue').textContent = 'Saved lists missing';
      return;
    }

    getEl('playedTodayValue').textContent = Time.secondsToHMS(playedTodaySeconds);
    getEl('playedTotalValue').textContent = Time.secondsToHMS(totalPlayedSeconds);
  }

  function buildCharts() {
    const { totalPlayedSeconds, byDay } = computeAggregates();
    const now = new Date();
    const dayKeysAll = Object.keys(byDay).sort();

    let labels = [];
    let cumulativeHours = [];
    let yMin = 0;
    let yMax = Math.ceil((totalPlayedSeconds || 0) / 3600);

    if (!showAllHistory) {
      const start = Time.startOfDay(now);
      start.setDate(start.getDate() - 29);

      const dailySeconds = [];
      for (let i = 0; i < 30; i += 1) {
        const d = new Date(start);
        d.setDate(d.getDate() + i);
        const key = Time.ymd(d);
        labels.push(key.slice(5));
        dailySeconds.push(byDay[key]?.seconds || 0);
      }

      const lifetimeTotalHours = (totalPlayedSeconds || 0) / 3600;
      const windowHours = dailySeconds.reduce((acc, s) => acc + (s / 3600), 0);
      const startHours = Math.max(0, lifetimeTotalHours - windowHours);

      let runningHours = 0;
      dailySeconds.forEach((seconds) => {
        runningHours += seconds / 3600;
        cumulativeHours.push(startHours + runningHours);
      });

      yMin = Math.floor(startHours);
      yMax = Math.ceil(lifetimeTotalHours);
      getEl('cumulativeTitle').textContent = 'Cumulative Study Time (30 Days)';
    } else {
      const earliestKey = dayKeysAll.length ? dayKeysAll[0] : Time.ymd(now);
      const latestKey = dayKeysAll.length ? dayKeysAll[dayKeysAll.length - 1] : Time.ymd(now);
      const earliest = new Date(`${earliestKey}T00:00:00`);
      const latest = new Date(`${latestKey}T00:00:00`);
      const spanDays = Math.max(
        1,
        Math.round((Time.startOfDay(latest) - Time.startOfDay(earliest)) / (1000 * 60 * 60 * 24)) + 1
      );

      let mode = 'week';
      if (spanDays <= 30) mode = 'day';
      else if (spanDays <= 420) mode = 'week';
      else if (spanDays <= 930) mode = 'month';
      else mode = 'quarter';

      const bucketSeconds = {};
      const bucketOrder = [];
      const addBucket = (key, seconds) => {
        if (!(key in bucketSeconds)) {
          bucketSeconds[key] = 0;
          bucketOrder.push(key);
        }
        bucketSeconds[key] += seconds;
      };

      dayKeysAll.forEach((dayKey) => {
        const seconds = byDay[dayKey]?.seconds || 0;
        const d = new Date(`${dayKey}T00:00:00`);

        if (mode === 'day') {
          addBucket(dayKey, seconds);
        } else if (mode === 'week') {
          addBucket(Time.ymd(Time.startOfISOWeek(d)), seconds);
        } else if (mode === 'month') {
          addBucket(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, seconds);
        } else {
          addBucket(`${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`, seconds);
        }
      });

      bucketOrder.sort((a, b) => (a < b ? -1 : 1));
      let runningHours = 0;
      bucketOrder.forEach((key) => {
        labels.push(mode === 'day' ? key.slice(5) : key);
        runningHours += bucketSeconds[key] / 3600;
        cumulativeHours.push(runningHours);
      });

      yMin = 0;
      yMax = Math.ceil((totalPlayedSeconds || 0) / 3600);
      const label = mode === 'day' ? 'Daily' : mode === 'week' ? 'Weekly' : mode === 'month' ? 'Monthly' : 'Quarterly';
      getEl('cumulativeTitle').textContent = `Cumulative Study Time (All Time - ${label})`;
    }

    const ctx1 = getEl('chartCumulative').getContext('2d');
    if (cumulativeChart) cumulativeChart.destroy();
    cumulativeChart = new Chart(ctx1, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Hours (cumulative)',
          data: cumulativeHours,
          tension: 0.25,
          pointRadius: 2,
          borderColor: '#b91c1c',
          backgroundColor: 'rgba(185, 28, 28, 0.16)'
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          y: {
            title: { display: true, text: 'Hours' },
            min: yMin,
            max: yMax
          }
        }
      }
    });

    getEl('lifetime').textContent = `Total lifetime study duration - ${Time.secondsToHMS(totalPlayedSeconds)}`;

    const weekLabels = [];
    const weekHours = [];
    const thisWeekStart = Time.startOfISOWeek(now);
    const firstWeekStart = new Date(thisWeekStart);
    firstWeekStart.setDate(firstWeekStart.getDate() - 11 * 7);

    const weeklySeconds = {};
    Object.keys(byDay).forEach((dayKey) => {
      const wsKey = Time.ymd(Time.startOfISOWeek(new Date(`${dayKey}T00:00:00`)));
      weeklySeconds[wsKey] = (weeklySeconds[wsKey] || 0) + byDay[dayKey].seconds;
    });

    for (let i = 0; i < 12; i += 1) {
      const ws = new Date(firstWeekStart);
      ws.setDate(ws.getDate() + i * 7);
      const wsKey = Time.ymd(ws);
      weekLabels.push(wsKey.slice(5));
      weekHours.push((weeklySeconds[wsKey] || 0) / 3600);
    }

    const ctx2 = getEl('chartWeekly').getContext('2d');
    if (weeklyChart) weeklyChart.destroy();
    weeklyChart = new Chart(ctx2, {
      type: 'bar',
      data: {
        labels: weekLabels,
        datasets: [{
          label: 'Hours',
          data: weekHours,
          borderColor: '#7f1d1d',
          backgroundColor: 'rgba(185, 28, 28, 0.72)'
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: { y: { title: { display: true, text: 'Hours' } } }
      }
    });
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
    const video = videoById[videoId];
    const title = video?.title || videoId;
    PlayerModal.open(videoId, title);
    getEl('video-player').appendChild(createModalMetadata(video, videoId));
  }

  function closeModal() {
    PlayerModal.close();
  }

  function createVideoCard(videoId, playedEntry) {
    const video = videoById[videoId];
    const isMissing = !video;

    const card = document.createElement('article');
    card.className = 'video-card';
    card.dataset.id = videoId;

    const wrapper = document.createElement('div');
    wrapper.className = 'video-wrapper';

    const img = document.createElement('img');
    img.className = 'thumbnail';
    img.src = `https://img.youtube.com/vi/${videoId}/0.jpg`;
    img.alt = isMissing ? videoId : (video.title || videoId);
    img.loading = 'lazy';
    img.addEventListener('click', () => renderPlayer(videoId));

    const statuses = document.createElement('div');
    statuses.className = 'status-stack';
    const playedBadge = document.createElement('span');
    playedBadge.className = 'status-badge played';
    playedBadge.textContent = 'Played';
    playedBadge.style.display = 'inline-flex';
    statuses.appendChild(playedBadge);

    const duration = document.createElement('div');
    duration.className = 'video-duration';
    duration.textContent = isMissing
      ? '?:??'
      : `${Time.secondsToMSS(video.duration)} - ${video.scaled_difficulty_score ?? ''}`.trim();

    wrapper.appendChild(img);
    wrapper.appendChild(statuses);
    wrapper.appendChild(duration);

    const info = document.createElement('div');
    info.className = 'video-info';

    const title = document.createElement('h3');
    title.className = 'card-title';
    title.textContent = isMissing ? videoId : (video.title || videoId);

    const meta = document.createElement('div');
    meta.className = 'video-meta';
    const when = playedEntry?.timestamp ? new Date(playedEntry.timestamp) : null;
    const channel = document.createElement('div');
    channel.textContent = isMissing ? '(not found in saved lists)' : (video.channel_id || '');
    const id = document.createElement('code');
    id.textContent = videoId;
    const raw = document.createElement('div');
    raw.textContent = `Raw Score: ${isMissing ? '' : (video.raw_difficulty_score ?? '')}`;
    const playedAt = document.createElement('div');
    playedAt.textContent = `Played: ${when ? when.toLocaleString() : ''}`;
    meta.appendChild(channel);
    meta.appendChild(id);
    meta.appendChild(raw);
    meta.appendChild(playedAt);

    const actions = document.createElement('div');
    actions.className = 'card-actions';
    const unmark = document.createElement('button');
    unmark.className = 'action-pill played is-active';
    unmark.type = 'button';
    unmark.textContent = 'Played';
    unmark.setAttribute('aria-pressed', 'true');
    unmark.addEventListener('click', () => {
      Storage.unmarkPlayed(videoId);
      refreshAll();
    });
    actions.appendChild(unmark);

    info.appendChild(title);
    info.appendChild(meta);
    info.appendChild(actions);

    card.appendChild(wrapper);
    card.appendChild(info);
    return card;
  }

  function createDaySection(dayKey, byDay) {
    const played = Storage.getPlayedMap();
    const section = document.createElement('section');
    section.className = 'day-section';

    const header = document.createElement('div');
    header.className = 'day-header';

    const h2 = document.createElement('h2');
    h2.textContent = dayKey;

    const total = document.createElement('div');
    total.className = 'day-total';
    total.textContent = `${Time.secondsToHM(byDay[dayKey].seconds)} (hh:mm)`;

    header.appendChild(h2);
    header.appendChild(total);

    const grid = document.createElement('div');
    grid.className = 'video-grid';

    const items = (byDay[dayKey].items || []).slice().sort((a, b) => {
      const ta = played[a]?.timestamp || '';
      const tb = played[b]?.timestamp || '';
      return ta < tb ? 1 : -1;
    });

    items.forEach((videoId) => {
      grid.appendChild(createVideoCard(videoId, played[videoId]));
    });

    section.appendChild(header);
    section.appendChild(grid);
    return section;
  }

  function renderNextDayBatch() {
    const root = getEl('historyRoot');
    const end = Math.min(renderedDayCount + DAYS_BATCH_SIZE, cachedDayKeys.length);

    for (let i = renderedDayCount; i < end; i += 1) {
      root.appendChild(createDaySection(cachedDayKeys[i], cachedByDay));
    }

    renderedDayCount = end;
  }

  function renderHistory() {
    const root = getEl('historyRoot');
    root.innerHTML = '';

    const { byDay } = computeAggregates();
    cachedByDay = byDay;
    cachedDayKeys = Object.keys(byDay).sort((a, b) => (a < b ? 1 : -1));
    renderedDayCount = 0;

    if (!cachedDayKeys.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'No played videos found yet. Mark videos as played on the player page to see them here.';
      root.appendChild(empty);
      return;
    }

    renderNextDayBatch();
  }

  function refreshAll() {
    updateTotalsDisplay();
    buildCharts();
    renderHistory();
  }

  function setCumulativeMode(nextShowAll) {
    showAllHistory = nextShowAll;
    getEl('showThirtyDays').classList.toggle('active', !showAllHistory);
    getEl('showAllHistory').classList.toggle('active', showAllHistory);
    getEl('showThirtyDays').setAttribute('aria-pressed', String(!showAllHistory));
    getEl('showAllHistory').setAttribute('aria-pressed', String(showAllHistory));
    buildCharts();
  }

  function wireEvents() {
    getEl('showThirtyDays').addEventListener('click', () => setCumulativeMode(false));
    getEl('showAllHistory').addEventListener('click', () => setCumulativeMode(true));

    getEl('downloadPlayed').addEventListener('click', () => {
      Storage.downloadPlayedJson('played_videos.json');
    });

    getEl('uploadPlayed').addEventListener('change', (e) => {
      Storage.uploadPlayedJsonFile(e.target.files[0], () => refreshAll());
      e.target.value = '';
    });

    getEl('closeModal').addEventListener('click', closeModal);
    window.addEventListener('click', (event) => {
      if (event.target === getEl('videoModal')) closeModal();
    });

    window.addEventListener('scroll', () => {
      if ((window.innerHeight + window.scrollY) >= document.body.offsetHeight - 360) {
        renderNextDayBatch();
      }
    });
  }

  function init() {
    PlayerModal.init({
      modalId: 'videoModal',
      playerContainerId: 'video-player'
    });

    rebuildVideoMapFromSavedLists();
    wireEvents();
    refreshAll();
  }

  init();
})();
