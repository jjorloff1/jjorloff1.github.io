// js/player-modal.js
// Owns the shared video-player modal UI used by the player and history pages.
(function () {
  const TOAST_DISMISS_MS = 6000;

  let modalId = null;
  let playerContainerId = null;

  function init(opts) {
    modalId = opts.modalId;
    playerContainerId = opts.playerContainerId;
  }

  function buildResumeToast(seconds) {
    const toast = document.createElement('div');
    toast.className = 'resume-toast';

    const label = document.createElement('span');
    label.textContent = `Resumed from ${Time.secondsToTimestamp(seconds)}`;
    toast.appendChild(label);

    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'resume-toast-dismiss';
    dismiss.setAttribute('aria-label', 'Dismiss');
    dismiss.textContent = '×';
    dismiss.addEventListener('click', () => toast.remove());
    toast.appendChild(dismiss);

    setTimeout(() => toast.remove(), TOAST_DISMISS_MS);

    return toast;
  }

  function open(videoId, titleText) {
    if (!modalId || !playerContainerId) {
      throw new Error('PlayerModal.init(...) must be called first.');
    }

    YouTubePlayback.stop();

    const modal = document.getElementById(modalId);
    const container = document.getElementById(playerContainerId);
    container.innerHTML = '';

    const title = document.createElement('div');
    title.style.fontWeight = '700';
    title.style.marginBottom = '10px';
    title.textContent = titleText || videoId;
    container.appendChild(title);

    const playerTarget = document.createElement('div');
    container.appendChild(playerTarget);

    const toastHost = document.createElement('div');
    container.appendChild(toastHost);

    modal.style.display = 'block';

    YouTubePlayback.start({
      target: playerTarget,
      videoId,
      onResume(seconds) {
        toastHost.replaceChildren(buildResumeToast(seconds));
      }
    });
  }

  function close() {
    if (!modalId || !playerContainerId) return;
    YouTubePlayback.stop();
    document.getElementById(modalId).style.display = 'none';
    document.getElementById(playerContainerId).innerHTML = '';
  }

  window.PlayerModal = { init, open, close };
})();
