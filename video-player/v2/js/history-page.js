(function () {
  const DAYS_BATCH_SIZE = 6;
  const HISTORY_SELECTED_PROFILE_IDS_KEY = 'videoHistorySelectedProfileIds';
  const GLOBAL_COLOR = {
    solid: '#b91c1c',
    strong: '#7f1d1d',
    fill: 'rgba(185, 28, 28, 0.16)',
    bar: 'rgba(185, 28, 28, 0.72)'
  };
  const PROFILE_COLORS = [
    '#2563eb',
    '#7c3aed',
    '#d97706',
    '#0891b2',
    '#be185d',
    '#16a34a',
    '#ea580c',
    '#4f46e5'
  ];

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

  function safeParseArray(raw, fallback) {
    try {
      const parsed = JSON.parse(raw || JSON.stringify(fallback));
      return Array.isArray(parsed) ? parsed : fallback;
    } catch {
      return fallback;
    }
  }

  function parseDuration(video) {
    return parseInt(video?.duration, 10) || 0;
  }

  function isValidDate(date) {
    return date instanceof Date && !Number.isNaN(date.getTime());
  }

  function isSameLocalDay(date, target) {
    return (
      isValidDate(date) &&
      date.getFullYear() === target.getFullYear() &&
      date.getMonth() === target.getMonth() &&
      date.getDate() === target.getDate()
    );
  }

  function hours(seconds) {
    return (seconds || 0) / 3600;
  }

  function formatHours(value) {
    return `${Number(value || 0).toFixed(2)}h`;
  }

  function getProfileInitial(profile) {
    return String(profile?.name || '')
      .trim()
      .charAt(0)
      .toUpperCase();
  }

  function hexToRgba(hex, alpha) {
    const clean = String(hex || '').replace('#', '');
    if (clean.length !== 6) return `rgba(30, 58, 95, ${alpha})`;
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function getProfileColor(profileId) {
    const profiles = Storage.getSoloProfiles();
    const index = profiles.findIndex((profile) => profile.id === profileId);
    const color = PROFILE_COLORS[(index >= 0 ? index : 0) % PROFILE_COLORS.length];
    return {
      solid: color,
      fill: hexToRgba(color, 0.16),
      bar: hexToRgba(color, 0.72),
      soft: hexToRgba(color, 0.1)
    };
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

  function setSelectedProfileIds(profileIds) {
    localStorage.setItem(
      HISTORY_SELECTED_PROFILE_IDS_KEY,
      JSON.stringify(normalizeProfileIds(profileIds))
    );
  }

  function pruneSelectedProfileIds() {
    const raw = safeParseArray(localStorage.getItem(HISTORY_SELECTED_PROFILE_IDS_KEY), []);
    const normalized = normalizeProfileIds(raw);
    if (!profileIdsEqual(raw, normalized)) setSelectedProfileIds(normalized);
    return normalized;
  }

  function getSelectedProfiles() {
    const selectedIds = new Set(pruneSelectedProfileIds());
    return Storage.getSoloProfiles().filter((profile) => selectedIds.has(profile.id));
  }

  function makeEmptyDay() {
    return {
      globalSeconds: 0,
      profileSecondsById: {},
      entries: []
    };
  }

  function getDay(byDay, dayKey) {
    if (!byDay[dayKey]) byDay[dayKey] = makeEmptyDay();
    return byDay[dayKey];
  }

  function addProfileSeconds(target, profileId, seconds) {
    target[profileId] = (target[profileId] || 0) + seconds;
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
    const selectedProfiles = getSelectedProfiles();
    const today = new Date();
    const byDay = {};

    let totalPlayedSeconds = 0;
    let playedTodaySeconds = 0;
    const profileTotalsById = selectedProfiles.reduce((acc, profile) => {
      acc[profile.id] = {
        profileTotalSeconds: 0,
        profileTodaySeconds: 0,
        combinedTotalSeconds: 0,
        combinedTodaySeconds: 0
      };
      return acc;
    }, {});

    Object.keys(played).forEach((videoId) => {
      const video = videoById[videoId];
      if (!video) return;

      const duration = parseDuration(video);
      totalPlayedSeconds += duration;

      const timestamp = played[videoId]?.timestamp || '';
      const playedDate = timestamp ? new Date(timestamp) : null;
      if (isSameLocalDay(playedDate, today)) playedTodaySeconds += duration;
      if (!isValidDate(playedDate)) return;

      const dayKey = Time.ymd(playedDate);
      const day = getDay(byDay, dayKey);
      day.globalSeconds += duration;
      day.entries.push({
        type: 'global',
        videoId,
        timestamp,
        seconds: duration,
        playedEntry: played[videoId]
      });
    });

    selectedProfiles.forEach((profile) => {
      const soloPlayed = Storage.getSoloPlayedMap(profile.id);
      Object.keys(soloPlayed).forEach((videoId) => {
        const video = videoById[videoId];
        if (!video) return;

        const duration = parseDuration(video);
        profileTotalsById[profile.id].profileTotalSeconds += duration;

        const timestamp = soloPlayed[videoId]?.timestamp || '';
        const watchedDate = timestamp ? new Date(timestamp) : null;
        if (isSameLocalDay(watchedDate, today)) {
          profileTotalsById[profile.id].profileTodaySeconds += duration;
        }
        if (!isValidDate(watchedDate)) return;

        const dayKey = Time.ymd(watchedDate);
        const day = getDay(byDay, dayKey);
        addProfileSeconds(day.profileSecondsById, profile.id, duration);
        day.entries.push({
          type: 'profile',
          videoId,
          profileId: profile.id,
          profileName: profile.name,
          timestamp,
          seconds: duration,
          playedEntry: soloPlayed[videoId]
        });
      });
    });

    selectedProfiles.forEach((profile) => {
      const totals = profileTotalsById[profile.id];
      totals.combinedTotalSeconds = totalPlayedSeconds + totals.profileTotalSeconds;
      totals.combinedTodaySeconds = playedTodaySeconds + totals.profileTodaySeconds;
    });

    return {
      played,
      selectedProfiles,
      totalPlayedSeconds,
      playedTodaySeconds,
      profileTotalsById,
      byDay
    };
  }

  function buildProfileStatChip(profile, periodLabel, globalSeconds, profileSeconds, combinedSeconds) {
    const color = getProfileColor(profile.id);
    const chip = document.createElement('span');
    chip.className = 'stat-chip profile-stat-chip';
    chip.style.setProperty('--profile-color', color.solid);
    chip.title = [
      `${profile.name} ${periodLabel}`,
      `Global: ${Time.secondsToHMS(globalSeconds)}`,
      `Profile: ${Time.secondsToHMS(profileSeconds)}`,
      `Combined: ${Time.secondsToHMS(combinedSeconds)}`
    ].join('\n');

    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = periodLabel;

    const value = document.createElement('span');
    value.textContent = Time.secondsToHMS(combinedSeconds);

    chip.appendChild(label);
    chip.appendChild(value);
    return chip;
  }

  function buildProfileStatGroup(profile, totals, aggregate) {
    const color = getProfileColor(profile.id);
    const group = document.createElement('div');
    group.className = 'profile-stat-group';
    group.style.setProperty('--profile-color', color.solid);

    const name = document.createElement('div');
    name.className = 'profile-stat-name';
    name.textContent = profile.name;
    name.title = profile.name;

    const chips = document.createElement('div');
    chips.className = 'profile-stat-chips';
    chips.appendChild(buildProfileStatChip(
      profile,
      'Today',
      aggregate.playedTodaySeconds,
      totals.profileTodaySeconds,
      totals.combinedTodaySeconds
    ));
    chips.appendChild(buildProfileStatChip(
      profile,
      'Total',
      aggregate.totalPlayedSeconds,
      totals.profileTotalSeconds,
      totals.combinedTotalSeconds
    ));

    group.appendChild(name);
    group.appendChild(chips);
    return group;
  }

  function renderProfileStats(aggregate) {
    const root = getEl('profileStatsGroup');
    if (!root) return;
    root.innerHTML = '';

    aggregate.selectedProfiles.forEach((profile) => {
      const totals = aggregate.profileTotalsById[profile.id];
      root.appendChild(buildProfileStatGroup(profile, totals, aggregate));
    });
  }

  function updateTotalsDisplay() {
    const aggregate = computeAggregates();
    const hasStoredPlayed = Object.keys(Storage.getPlayedMap()).length > 0;

    if (hasStoredPlayed && Object.keys(videoById).length === 0) {
      getEl('playedTodayValue').textContent = '0:00:00';
      getEl('playedTotalValue').textContent = 'Saved lists missing';
      renderProfileStats(aggregate);
      return;
    }

    getEl('playedTodayValue').textContent = Time.secondsToHMS(aggregate.playedTodaySeconds);
    getEl('playedTotalValue').textContent = Time.secondsToHMS(aggregate.totalPlayedSeconds);
    renderProfileStats(aggregate);
  }

  function getBucketKey(dayKey, mode) {
    const d = new Date(`${dayKey}T00:00:00`);
    if (mode === 'day') return dayKey;
    if (mode === 'week') return Time.ymd(Time.startOfISOWeek(d));
    if (mode === 'month') return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    return `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`;
  }

  function getAllHistoryMode(dayKeysAll, now) {
    const earliestKey = dayKeysAll.length ? dayKeysAll[0] : Time.ymd(now);
    const latestKey = dayKeysAll.length ? dayKeysAll[dayKeysAll.length - 1] : Time.ymd(now);
    const earliest = new Date(`${earliestKey}T00:00:00`);
    const latest = new Date(`${latestKey}T00:00:00`);
    const spanDays = Math.max(
      1,
      Math.round((Time.startOfDay(latest) - Time.startOfDay(earliest)) / (1000 * 60 * 60 * 24)) + 1
    );

    if (spanDays <= 30) return 'day';
    if (spanDays <= 420) return 'week';
    if (spanDays <= 930) return 'month';
    return 'quarter';
  }

  function buildEmptyProfileSeries(selectedProfiles) {
    return selectedProfiles.reduce((acc, profile) => {
      acc[profile.id] = [];
      return acc;
    }, {});
  }

  function pushProfileValue(seriesById, selectedProfiles, getValue) {
    selectedProfiles.forEach((profile) => {
      seriesById[profile.id].push(getValue(profile));
    });
  }

  function buildCumulativeSeries(aggregate) {
    const now = new Date();
    const dayKeysAll = Object.keys(aggregate.byDay).sort();
    const selectedProfiles = aggregate.selectedProfiles;

    let labels = [];
    let globalDailySeconds = [];
    const profileDailySecondsById = buildEmptyProfileSeries(selectedProfiles);
    let mode = 'day';

    if (!showAllHistory) {
      const start = Time.startOfDay(now);
      start.setDate(start.getDate() - 29);

      for (let i = 0; i < 30; i += 1) {
        const d = new Date(start);
        d.setDate(d.getDate() + i);
        const key = Time.ymd(d);
        const day = aggregate.byDay[key] || makeEmptyDay();
        labels.push(key.slice(5));
        globalDailySeconds.push(day.globalSeconds || 0);
        pushProfileValue(profileDailySecondsById, selectedProfiles, (profile) =>
          day.profileSecondsById[profile.id] || 0
        );
      }
    } else {
      mode = getAllHistoryMode(dayKeysAll, now);
      const bucketSeconds = {};
      const bucketProfileSecondsById = {};
      const bucketOrder = [];

      const addBucket = (key) => {
        if (bucketSeconds[key] != null) return;
        bucketSeconds[key] = 0;
        bucketProfileSecondsById[key] = {};
        bucketOrder.push(key);
      };

      dayKeysAll.forEach((dayKey) => {
        const bucketKey = getBucketKey(dayKey, mode);
        const day = aggregate.byDay[dayKey] || makeEmptyDay();
        addBucket(bucketKey);
        bucketSeconds[bucketKey] += day.globalSeconds || 0;
        selectedProfiles.forEach((profile) => {
          bucketProfileSecondsById[bucketKey][profile.id] =
            (bucketProfileSecondsById[bucketKey][profile.id] || 0) +
            (day.profileSecondsById[profile.id] || 0);
        });
      });

      bucketOrder.sort((a, b) => (a < b ? -1 : 1));
      labels = bucketOrder.map((key) => (mode === 'day' ? key.slice(5) : key));
      globalDailySeconds = bucketOrder.map((key) => bucketSeconds[key] || 0);
      selectedProfiles.forEach((profile) => {
        profileDailySecondsById[profile.id] = bucketOrder.map((key) =>
          bucketProfileSecondsById[key]?.[profile.id] || 0
        );
      });
    }

    return { labels, mode, globalDailySeconds, profileDailySecondsById };
  }

  function buildCumulativeDatasets(aggregate, series) {
    const selectedProfiles = aggregate.selectedProfiles;
    const windowGlobalSeconds = series.globalDailySeconds.reduce((acc, seconds) => acc + seconds, 0);
    const globalStartSeconds = showAllHistory
      ? 0
      : Math.max(0, aggregate.totalPlayedSeconds - windowGlobalSeconds);
    let runningGlobalSeconds = globalStartSeconds;
    const cumulativeGlobalHours = series.globalDailySeconds.map((seconds) => {
      runningGlobalSeconds += seconds;
      return hours(runningGlobalSeconds);
    });

    const datasets = [{
      label: selectedProfiles.length ? 'Global played' : 'Hours (cumulative)',
      data: cumulativeGlobalHours,
      tension: 0.25,
      pointRadius: 2,
      borderColor: GLOBAL_COLOR.solid,
      backgroundColor: GLOBAL_COLOR.fill,
      historyRole: 'global'
    }];

    selectedProfiles.forEach((profile) => {
      const totals = aggregate.profileTotalsById[profile.id];
      const profileDailySeconds = series.profileDailySecondsById[profile.id] || [];
      const windowProfileSeconds = profileDailySeconds.reduce((acc, seconds) => acc + seconds, 0);
      const profileStartSeconds = showAllHistory
        ? 0
        : Math.max(0, totals.profileTotalSeconds - windowProfileSeconds);
      let runningProfileSeconds = profileStartSeconds;

      const profileHours = [];
      const combinedHours = profileDailySeconds.map((seconds, index) => {
        runningProfileSeconds += seconds;
        const profileOnlyHours = hours(runningProfileSeconds);
        profileHours.push(profileOnlyHours);
        return cumulativeGlobalHours[index] + profileOnlyHours;
      });
      const color = getProfileColor(profile.id);

      datasets.push({
        label: `${profile.name} (global + profile)`,
        data: combinedHours,
        tension: 0.25,
        pointRadius: 2,
        borderColor: color.solid,
        backgroundColor: color.fill,
        historyRole: 'profileCumulative',
        profileId: profile.id,
        profileName: profile.name,
        globalHoursByIndex: cumulativeGlobalHours,
        profileHoursByIndex: profileHours
      });
    });

    return datasets;
  }

  function buildWeeklySeries(aggregate) {
    const now = new Date();
    const selectedProfiles = aggregate.selectedProfiles;
    const weekLabels = [];
    const weekGlobalSeconds = [];
    const weekProfileSecondsById = buildEmptyProfileSeries(selectedProfiles);
    const weeklySeconds = {};
    const weeklyProfileSeconds = {};
    const thisWeekStart = Time.startOfISOWeek(now);
    const firstWeekStart = new Date(thisWeekStart);
    firstWeekStart.setDate(firstWeekStart.getDate() - 11 * 7);

    Object.keys(aggregate.byDay).forEach((dayKey) => {
      const day = aggregate.byDay[dayKey] || makeEmptyDay();
      const weekKey = Time.ymd(Time.startOfISOWeek(new Date(`${dayKey}T00:00:00`)));
      weeklySeconds[weekKey] = (weeklySeconds[weekKey] || 0) + (day.globalSeconds || 0);
      if (!weeklyProfileSeconds[weekKey]) weeklyProfileSeconds[weekKey] = {};
      selectedProfiles.forEach((profile) => {
        weeklyProfileSeconds[weekKey][profile.id] =
          (weeklyProfileSeconds[weekKey][profile.id] || 0) +
          (day.profileSecondsById[profile.id] || 0);
      });
    });

    for (let i = 0; i < 12; i += 1) {
      const weekStart = new Date(firstWeekStart);
      weekStart.setDate(weekStart.getDate() + i * 7);
      const weekKey = Time.ymd(weekStart);
      weekLabels.push(weekKey.slice(5));
      weekGlobalSeconds.push(weeklySeconds[weekKey] || 0);
      pushProfileValue(weekProfileSecondsById, selectedProfiles, (profile) =>
        weeklyProfileSeconds[weekKey]?.[profile.id] || 0
      );
    }

    return { weekLabels, weekGlobalSeconds, weekProfileSecondsById };
  }

  function buildWeeklyDatasets(aggregate, series) {
    const selectedProfiles = aggregate.selectedProfiles;
    const globalHours = series.weekGlobalSeconds.map(hours);

    if (!selectedProfiles.length) {
      return [{
        label: 'Hours',
        data: globalHours,
        borderColor: GLOBAL_COLOR.strong,
        backgroundColor: GLOBAL_COLOR.bar,
        historyRole: 'global'
      }];
    }

    const datasets = [];
    selectedProfiles.forEach((profile, index) => {
      const color = getProfileColor(profile.id);
      const profileHours = (series.weekProfileSecondsById[profile.id] || []).map(hours);
      const activeProfileHours = profileHours.map((value) => (value > 0 ? value : null));
      const activeGlobalHours = globalHours.map((value, weekIndex) =>
        profileHours[weekIndex] > 0 ? value : null
      );
      const stack = `profile-${profile.id}`;

      datasets.push({
        label: 'Global played',
        data: activeGlobalHours,
        stack,
        skipNull: true,
        borderColor: GLOBAL_COLOR.strong,
        backgroundColor: GLOBAL_COLOR.bar,
        historyRole: 'globalFloor',
        hideFromLegend: index > 0
      });
      datasets.push({
        label: profile.name,
        data: activeProfileHours,
        stack,
        skipNull: true,
        borderColor: color.solid,
        backgroundColor: color.bar,
        historyRole: 'profileWeekly',
        profileId: profile.id,
        profileName: profile.name,
        globalHoursByIndex: globalHours,
        profileHoursByIndex: profileHours
      });
    });

    datasets.push({
      label: 'Global played',
      data: globalHours.map((value, weekIndex) =>
        selectedProfiles.some((profile) =>
          hours(series.weekProfileSecondsById[profile.id]?.[weekIndex] || 0) > 0
        )
          ? null
          : value
      ),
      skipNull: true,
      borderColor: GLOBAL_COLOR.strong,
      backgroundColor: GLOBAL_COLOR.bar,
      historyRole: 'global',
      hideFromLegend: true
    });

    return datasets;
  }

  function buildCharts() {
    const aggregate = computeAggregates();
    const selectedProfiles = aggregate.selectedProfiles;
    const cumulativeSeries = buildCumulativeSeries(aggregate);
    const cumulativeDatasets = buildCumulativeDatasets(aggregate, cumulativeSeries);
    const maxCumulativeHours = Math.max(
      hours(aggregate.totalPlayedSeconds),
      ...selectedProfiles.map((profile) =>
        hours(aggregate.profileTotalsById[profile.id]?.combinedTotalSeconds || 0)
      )
    );
    const minCumulativeHours = showAllHistory
      ? 0
      : Math.floor(Math.min(...cumulativeDatasets.flatMap((dataset) => dataset.data), maxCumulativeHours));
    const yMax = Math.max(1, Math.ceil(maxCumulativeHours));

    if (!showAllHistory) {
      getEl('cumulativeTitle').textContent = 'Cumulative Study Time (30 Days)';
    } else {
      const labels = { day: 'Daily', week: 'Weekly', month: 'Monthly', quarter: 'Quarterly' };
      getEl('cumulativeTitle').textContent = `Cumulative Study Time (All Time - ${labels[cumulativeSeries.mode]})`;
    }

    const ctx1 = getEl('chartCumulative').getContext('2d');
    if (cumulativeChart) cumulativeChart.destroy();
    cumulativeChart = new Chart(ctx1, {
      type: 'line',
      data: {
        labels: cumulativeSeries.labels,
        datasets: cumulativeDatasets
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: selectedProfiles.length > 0 },
          tooltip: {
            callbacks: {
              label: (context) => {
                const dataset = context.dataset;
                const value = context.parsed?.y || 0;
                if (dataset.historyRole !== 'profileCumulative') {
                  return `${dataset.label}: ${formatHours(value)}`;
                }
                const globalValue = dataset.globalHoursByIndex?.[context.dataIndex] || 0;
                const profileValue = dataset.profileHoursByIndex?.[context.dataIndex] || 0;
                return [
                  `${dataset.profileName}: ${formatHours(value)}`,
                  `Global: ${formatHours(globalValue)}`,
                  `Profile: ${formatHours(profileValue)}`
                ];
              }
            }
          }
        },
        scales: {
          y: {
            title: { display: true, text: 'Hours' },
            min: minCumulativeHours,
            max: yMax
          }
        }
      }
    });

    getEl('lifetime').textContent = `Total lifetime study duration - ${Time.secondsToHMS(aggregate.totalPlayedSeconds)}`;

    const weeklySeries = buildWeeklySeries(aggregate);
    const weeklyDatasets = buildWeeklyDatasets(aggregate, weeklySeries);
    const ctx2 = getEl('chartWeekly').getContext('2d');
    if (weeklyChart) weeklyChart.destroy();
    weeklyChart = new Chart(ctx2, {
      type: 'bar',
      data: {
        labels: weeklySeries.weekLabels,
        datasets: weeklyDatasets
      },
      options: {
        responsive: true,
        plugins: {
          legend: {
            display: selectedProfiles.length > 0,
            labels: {
              filter: (legendItem, data) => !data.datasets[legendItem.datasetIndex].hideFromLegend
            },
            onClick: () => {}
          },
          tooltip: {
            callbacks: {
              label: (context) => {
                const dataset = context.dataset;
                if (dataset.historyRole === 'profileWeekly') {
                  const profileHours = dataset.profileHoursByIndex?.[context.dataIndex] || 0;
                  const globalHours = dataset.globalHoursByIndex?.[context.dataIndex] || 0;
                  return [
                    `${dataset.profileName}: ${formatHours(profileHours)}`,
                    `Global floor: ${formatHours(globalHours)}`,
                    `Combined: ${formatHours(globalHours + profileHours)}`
                  ];
                }
                const rawValue = Array.isArray(context.raw) ? context.raw[1] - context.raw[0] : context.parsed?.y;
                return `${dataset.label}: ${formatHours(rawValue || 0)}`;
              }
            }
          }
        },
        scales: {
          x: { stacked: selectedProfiles.length > 0 },
          y: {
            stacked: selectedProfiles.length > 0,
            title: { display: true, text: 'Hours' }
          }
        }
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

  function createStatusBadge(className, label, color) {
    const badge = document.createElement('span');
    badge.className = `status-badge ${className}`;
    badge.textContent = label;
    badge.style.display = 'inline-flex';
    if (color) badge.style.backgroundColor = color;
    return badge;
  }

  function createVideoCard(entry) {
    const videoId = entry.videoId;
    const video = videoById[videoId];
    const isMissing = !video;
    const isProfileEntry = entry.type === 'profile';
    const color = isProfileEntry ? getProfileColor(entry.profileId) : null;

    const card = document.createElement('article');
    card.className = `video-card history-entry-card ${isProfileEntry ? 'profile-entry' : 'global-entry'}`;
    card.dataset.id = videoId;
    card.dataset.entryType = entry.type;
    if (isProfileEntry) card.style.setProperty('--profile-color', color.solid);

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
    statuses.appendChild(
      isProfileEntry
        ? createStatusBadge('history-profile-badge', entry.profileName || 'Profile', color.solid)
        : createStatusBadge('played', 'Played')
    );

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
    const when = entry.timestamp ? new Date(entry.timestamp) : null;
    const channel = document.createElement('div');
    channel.textContent = isMissing ? '(not found in saved lists)' : (video.channel_id || '');
    const id = document.createElement('code');
    id.textContent = videoId;
    const raw = document.createElement('div');
    raw.textContent = `Raw Score: ${isMissing ? '' : (video.raw_difficulty_score ?? '')}`;
    const playedAt = document.createElement('div');
    playedAt.textContent = `${isProfileEntry ? 'Profile watched' : 'Played'}: ${isValidDate(when) ? when.toLocaleString() : ''}`;
    meta.appendChild(channel);
    meta.appendChild(id);
    meta.appendChild(raw);
    meta.appendChild(playedAt);

    if (isProfileEntry) {
      const profile = document.createElement('div');
      profile.className = 'history-profile-meta';
      profile.textContent = `Profile: ${entry.profileName || entry.profileId}`;
      meta.appendChild(profile);
    }

    const actions = document.createElement('div');
    actions.className = 'card-actions';
    const unmark = document.createElement('button');
    unmark.className = `action-pill ${isProfileEntry ? 'solo history-profile-action' : 'played'} is-active`;
    unmark.type = 'button';
    unmark.textContent = isProfileEntry ? 'Profile watched' : 'Played';
    unmark.setAttribute('aria-pressed', 'true');
    if (isProfileEntry) {
      unmark.style.borderColor = color.solid;
      unmark.style.backgroundColor = color.solid;
    }
    unmark.addEventListener('click', () => {
      if (isProfileEntry) Storage.unmarkSoloPlayed(videoId, entry.profileId);
      else Storage.unmarkPlayed(videoId);
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

  function formatDayTotal(day, selectedProfiles) {
    if (!selectedProfiles.length) return `${Time.secondsToHM(day.globalSeconds)} (hh:mm)`;

    const parts = [`Global ${Time.secondsToHM(day.globalSeconds)}`];
    const title = [`Global: ${Time.secondsToHMS(day.globalSeconds)}`];
    selectedProfiles.forEach((profile) => {
      const profileSeconds = day.profileSecondsById[profile.id] || 0;
      const combined = day.globalSeconds + profileSeconds;
      parts.push(`${getProfileInitial(profile)} ${Time.secondsToHM(combined)}`);
      title.push(`${profile.name}: ${Time.secondsToHMS(combined)} (global ${Time.secondsToHMS(day.globalSeconds)} + profile ${Time.secondsToHMS(profileSeconds)})`);
    });

    return { text: parts.join(' / '), title: title.join('\n') };
  }

  function createDaySection(dayKey, byDay, selectedProfiles) {
    const day = byDay[dayKey];
    const section = document.createElement('section');
    section.className = 'day-section';

    const header = document.createElement('div');
    header.className = 'day-header';

    const h2 = document.createElement('h2');
    h2.textContent = dayKey;

    const total = document.createElement('div');
    total.className = 'day-total';
    const summary = formatDayTotal(day, selectedProfiles);
    if (typeof summary === 'string') total.textContent = summary;
    else {
      total.textContent = summary.text;
      total.title = summary.title;
    }

    header.appendChild(h2);
    header.appendChild(total);

    const grid = document.createElement('div');
    grid.className = 'video-grid';

    const items = (day.entries || []).slice().sort((a, b) => {
      const ta = a.timestamp || '';
      const tb = b.timestamp || '';
      if (ta !== tb) return ta < tb ? 1 : -1;
      if (a.type === b.type) return 0;
      return a.type === 'global' ? -1 : 1;
    });

    items.forEach((entry) => {
      grid.appendChild(createVideoCard(entry));
    });

    section.appendChild(header);
    section.appendChild(grid);
    return section;
  }

  function renderNextDayBatch() {
    const root = getEl('historyRoot');
    const selectedProfiles = getSelectedProfiles();
    const end = Math.min(renderedDayCount + DAYS_BATCH_SIZE, cachedDayKeys.length);

    for (let i = renderedDayCount; i < end; i += 1) {
      root.appendChild(createDaySection(cachedDayKeys[i], cachedByDay, selectedProfiles));
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

  function renderProfileControls() {
    const root = getEl('historyProfileControls');
    if (!root) return;

    const selectedIds = new Set(pruneSelectedProfileIds());
    const profiles = Storage.getSoloProfiles();
    root.innerHTML = '';

    const heading = document.createElement('div');
    heading.className = 'history-profile-menu-title';
    heading.textContent = 'Show profile history';
    root.appendChild(heading);

    profiles.forEach((profile) => {
      const color = getProfileColor(profile.id);
      const row = document.createElement('label');
      row.className = 'form-check history-profile-check';

      const input = document.createElement('input');
      input.className = 'form-check-input history-profile-input';
      input.type = 'checkbox';
      input.value = profile.id;
      input.checked = selectedIds.has(profile.id);
      input.addEventListener('change', () => {
        const nextIds = Array.from(root.querySelectorAll('.history-profile-input:checked'))
          .map((item) => item.value);
        setSelectedProfileIds(nextIds);
        refreshAll();
      });

      const swatch = document.createElement('span');
      swatch.className = 'history-profile-swatch';
      swatch.style.backgroundColor = color.solid;

      const label = document.createElement('span');
      label.className = 'form-check-label';
      label.textContent = profile.name;

      row.appendChild(input);
      row.appendChild(swatch);
      row.appendChild(label);
      root.appendChild(row);
    });
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

    getEl('downloadProfileWatched').addEventListener('click', () => {
      Storage.downloadSoloProfilesWatchedJson('profile_watched_data.json');
    });

    getEl('uploadPlayed').addEventListener('change', (e) => {
      Storage.uploadPlayedJsonFile(e.target.files[0], () => refreshAll());
      e.target.value = '';
    });

    getEl('uploadProfileWatched').addEventListener('change', (e) => {
      Storage.uploadSoloPlayedJsonFile(e.target.files[0], () => {
        renderProfileControls();
        refreshAll();
      });
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
    renderProfileControls();
    wireEvents();
    refreshAll();
  }

  init();
})();
