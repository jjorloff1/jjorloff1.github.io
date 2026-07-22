const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const STORAGE_SOURCE = fs.readFileSync(
  path.resolve(__dirname, '../js/storage.js'),
  'utf8'
);

class FakeLocalStorage {
  constructor(initial = {}) {
    this.values = new Map(
      Object.entries(initial).map(([key, value]) => [key, String(value)])
    );
    this.readCounts = new Map();
    this.writeCounts = new Map();
    this.failedWriteKeys = new Set();
  }

  getItem(key) {
    this.readCounts.set(key, this.readCount(key) + 1);
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    if (this.failedWriteKeys.has(key)) {
      throw new Error(`Simulated storage write failure for ${key}`);
    }
    this.writeCounts.set(key, this.writeCount(key) + 1);
    this.values.set(key, String(value));
  }

  removeItem(key) {
    this.values.delete(key);
  }

  clear() {
    this.values.clear();
  }

  externalSet(key, value) {
    if (value == null) this.values.delete(key);
    else this.values.set(key, String(value));
  }

  failWritesFor(key) {
    this.failedWriteKeys.add(key);
  }

  allowWritesFor(key) {
    this.failedWriteKeys.delete(key);
  }

  readCount(key) {
    return this.readCounts.get(key) || 0;
  }

  writeCount(key) {
    return this.writeCounts.get(key) || 0;
  }

  totalReads() {
    return [...this.readCounts.values()].reduce((sum, count) => sum + count, 0);
  }

  resetMetrics() {
    this.readCounts.clear();
    this.writeCounts.clear();
  }
}

function loadStorage(initial = {}, { includeMigrationMarker = true } = {}) {
  const seeded = { ...initial };
  if (
    includeMigrationMarker &&
    !Object.prototype.hasOwnProperty.call(seeded, 'soloProfilesMigratedFromSoloPlayedVideos')
  ) {
    seeded.soloProfilesMigratedFromSoloPlayedVideos = 'test-complete';
  }

  const localStorage = new FakeLocalStorage(seeded);
  const jsonMetrics = { parseCount: 0, stringifyCount: 0 };
  const trackedJson = {
    parse(text, reviver) {
      jsonMetrics.parseCount += 1;
      return JSON.parse(text, reviver);
    },
    stringify(value, replacer, space) {
      jsonMetrics.stringifyCount += 1;
      return JSON.stringify(value, replacer, space);
    }
  };
  const listeners = new Map();
  const alerts = [];

  const window = {
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    dispatchStorageEvent(event) {
      (listeners.get('storage') || []).forEach((listener) => listener(event));
    }
  };

  class FakeFileReader {
    readAsText(file) {
      const result = typeof file === 'string' ? file : file?.text;
      this.onload?.({ target: { result: String(result ?? '') } });
    }
  }

  const context = vm.createContext({
    window,
    localStorage,
    JSON: trackedJson,
    Date,
    console,
    Blob: globalThis.Blob,
    FileReader: FakeFileReader,
    URL: {
      createObjectURL() {
        return 'blob:test';
      },
      revokeObjectURL() {}
    },
    document: {
      createElement() {
        return { click() {} };
      }
    },
    alert(message) {
      alerts.push(String(message));
    },
    prompt() {
      return null;
    }
  });

  vm.runInContext(STORAGE_SOURCE, context, { filename: 'js/storage.js' });

  return {
    Storage: window.Storage,
    window,
    localStorage,
    jsonMetrics,
    alerts,
    resetMetrics() {
      localStorage.resetMetrics();
      jsonMetrics.parseCount = 0;
      jsonMetrics.stringifyCount = 0;
    }
  };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

module.exports = {
  FakeLocalStorage,
  loadStorage,
  plain
};
