// js/player-modal.js
(function () {
  let modalId = null;
  let playerContainerId = null;

  function init(opts) {
    modalId = opts.modalId;
    playerContainerId = opts.playerContainerId;
  }

  function open(videoId, titleText) {
    if (!modalId || !playerContainerId) {
      throw new Error('PlayerModal.init(...) must be called first.');
    }

    const modal = document.getElementById(modalId);
    const container = document.getElementById(playerContainerId);
    container.innerHTML = '';

    const title = document.createElement('div');
    title.style.fontWeight = '700';
    title.style.marginBottom = '10px';
    title.textContent = titleText || videoId;

    const iframe = document.createElement('iframe');
    const origin = window.location.protocol === 'file:'
      ? 'https://localhost'
      : encodeURIComponent(window.location.origin);

    iframe.src = `https://www.youtube.com/embed/${videoId}?autoplay=1&enablejsapi=1&origin=${origin}`;
    iframe.setAttribute('allowfullscreen', '');
    iframe.setAttribute('allow', 'autoplay; encrypted-media');

    container.appendChild(title);
    container.appendChild(iframe);
    modal.style.display = 'block';
  }

  function close() {
    if (!modalId || !playerContainerId) return;
    document.getElementById(modalId).style.display = 'none';
    document.getElementById(playerContainerId).innerHTML = '';
  }

  window.PlayerModal = { init, open, close };
})();