const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PLAYER_MODAL_SOURCE = fs.readFileSync(
  path.resolve(__dirname, '../js/player-modal.js'),
  'utf8'
);

class FakeElement {
  constructor() {
    this.children = [];
    this.className = '';
    this.style = {};
    this.textContent = '';
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  replaceChildren(...children) {
    this.children = children;
  }

  setAttribute() {}

  addEventListener() {}

  remove() {}

  set innerHTML(value) {
    if (value === '') this.children = [];
  }
}

function loadPlayerModal() {
  const modal = new FakeElement();
  const container = new FakeElement();
  const elements = {
    videoModal: modal,
    'video-player': container
  };
  const playbackCalls = { start: null, stops: 0 };
  const window = {};
  const context = vm.createContext({
    document: {
      createElement() {
        return new FakeElement();
      },
      getElementById(id) {
        return elements[id];
      }
    },
    setTimeout() {},
    Time: {
      secondsToTimestamp(seconds) {
        return seconds === 65 ? '1:05' : String(seconds);
      }
    },
    YouTubePlayback: {
      start(options) {
        playbackCalls.start = options;
      },
      stop() {
        playbackCalls.stops += 1;
      }
    },
    window
  });

  vm.runInContext(PLAYER_MODAL_SOURCE, context, { filename: 'js/player-modal.js' });
  window.PlayerModal.init({
    modalId: 'videoModal',
    playerContainerId: 'video-player'
  });

  return { container, modal: window.PlayerModal, playbackCalls };
}

test('resume toast stays beneath the player and ahead of page-specific metadata', () => {
  const { container, modal, playbackCalls } = loadPlayerModal();

  modal.open('video-id', 'Video title');
  const toastHost = container.children[2];
  const metadata = new FakeElement();
  container.appendChild(metadata);

  playbackCalls.start.onResume(65);

  assert.equal(playbackCalls.stops, 1);
  assert.equal(container.children.indexOf(toastHost), 2);
  assert.equal(container.children.indexOf(metadata), 3);
  assert.equal(toastHost.children[0].className, 'resume-toast');
  assert.equal(toastHost.children[0].children[0].textContent, 'Resumed from 1:05');
});
