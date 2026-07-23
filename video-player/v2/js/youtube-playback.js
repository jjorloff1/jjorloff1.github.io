// js/youtube-playback.js
// Owns YouTube player lifecycle and persisted resume-position tracking.
(function () {
  const RESUME_MIN_WATCHED_SECONDS = 30;
  const RESUME_MIN_WATCHED_FRACTION = 0.1;
  const RESUME_MIN_WATCHED_FLOOR_SECONDS = 5;
  const RESUME_NEAR_END_SECONDS = 15;
  const RESUME_NEAR_END_FRACTION = 0.95;
  const SAVE_INTERVAL_MS = 5000;

  let apiReadyPromise = null;
  let ytPlayer = null;
  let openToken = 0;
  let saveIntervalId = null;
  let currentVideoId = null;

  function loadApi() {
    if (apiReadyPromise) return apiReadyPromise;

    apiReadyPromise = new Promise((resolve) => {
      if (window.YT && window.YT.Player) {
        resolve(window.YT);
        return;
      }

      const previousCallback = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        if (typeof previousCallback === 'function') previousCallback();
        resolve(window.YT);
      };

      if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
        const script = document.createElement('script');
        script.src = 'https://www.youtube.com/iframe_api';
        document.head.appendChild(script);
      }
    });

    return apiReadyPromise;
  }

  function minWatchedSecondsFor(duration) {
    if (!duration) return RESUME_MIN_WATCHED_SECONDS;
    const scaled = duration * RESUME_MIN_WATCHED_FRACTION;
    return Math.max(
      RESUME_MIN_WATCHED_FLOOR_SECONDS,
      Math.min(RESUME_MIN_WATCHED_SECONDS, scaled)
    );
  }

  function shouldSaveResumePosition(currentTime, duration) {
    if (!duration || currentTime <= 0) return false;
    return currentTime >= minWatchedSecondsFor(duration);
  }

  function isFinished(currentTime, duration) {
    if (!duration) return false;
    return (duration - currentTime) <= RESUME_NEAR_END_SECONDS ||
      (currentTime / duration) >= RESUME_NEAR_END_FRACTION;
  }

  function getResumeSeconds(videoId) {
    const record = Storage.getResumePosition(videoId);
    if (!record) return null;
    const duration = record.duration || record.seconds;
    return shouldSaveResumePosition(record.seconds, duration) ? record.seconds : null;
  }

  function saveCurrentPositionIfQualifying() {
    if (!ytPlayer || !currentVideoId) return;

    let currentTime;
    let duration;
    try {
      currentTime = ytPlayer.getCurrentTime();
      duration = ytPlayer.getDuration();
    } catch {
      return;
    }

    if (typeof currentTime !== 'number' || typeof duration !== 'number') return;

    if (isFinished(currentTime, duration)) {
      Storage.clearResumePosition(currentVideoId);
    } else if (shouldSaveResumePosition(currentTime, duration)) {
      Storage.setResumePosition(currentVideoId, currentTime, duration);
    }
  }

  function stopSaveInterval() {
    if (saveIntervalId == null) return;
    clearInterval(saveIntervalId);
    saveIntervalId = null;
  }

  function startSaveInterval() {
    stopSaveInterval();
    saveIntervalId = setInterval(saveCurrentPositionIfQualifying, SAVE_INTERVAL_MS);
  }

  function teardownPlayer() {
    saveCurrentPositionIfQualifying();
    stopSaveInterval();

    if (ytPlayer) {
      try {
        ytPlayer.destroy();
      } catch {
        // The player may already be gone if its container was cleared.
      }
    }

    ytPlayer = null;
    currentVideoId = null;
  }

  function handleStateChange(event) {
    if (!window.YT) return;

    if (event.data === window.YT.PlayerState.PLAYING) {
      startSaveInterval();
    } else if (event.data === window.YT.PlayerState.PAUSED) {
      stopSaveInterval();
      saveCurrentPositionIfQualifying();
    } else if (event.data === window.YT.PlayerState.ENDED) {
      stopSaveInterval();
      if (currentVideoId) Storage.clearResumePosition(currentVideoId);
    }
  }

  function start({ target, videoId, onResume }) {
    openToken += 1;
    const token = openToken;
    teardownPlayer();

    const resumeSeconds = getResumeSeconds(videoId);
    const origin = window.location.protocol === 'file:'
      ? undefined
      : window.location.origin;

    loadApi().then((YT) => {
      if (token !== openToken) return;

      currentVideoId = videoId;
      ytPlayer = new YT.Player(target, {
        videoId,
        playerVars: {
          autoplay: 1,
          enablejsapi: 1,
          origin
        },
        events: {
          onReady(event) {
            if (token !== openToken) return;
            startSaveInterval();
            if (resumeSeconds != null) {
              event.target.seekTo(resumeSeconds, true);
              if (typeof onResume === 'function') onResume(resumeSeconds);
            }
          },
          onStateChange(event) {
            if (token === openToken) handleStateChange(event);
          }
        }
      });
    });
  }

  function stop() {
    openToken += 1;
    teardownPlayer();
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveCurrentPositionIfQualifying();
  });
  window.addEventListener('pagehide', saveCurrentPositionIfQualifying);

  window.YouTubePlayback = {
    start,
    stop,
    _internal: { shouldSaveResumePosition, isFinished }
  };
})();
