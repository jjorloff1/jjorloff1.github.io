const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const TIME_SOURCE = fs.readFileSync(
  path.resolve(__dirname, '../js/time.js'),
  'utf8'
);

function loadTime() {
  const window = {};
  const context = vm.createContext({ window });
  vm.runInContext(TIME_SOURCE, context, { filename: 'js/time.js' });
  return window.Time;
}

test('secondsToTimestamp renders m:ss and h:mm:ss', () => {
  const { secondsToTimestamp } = loadTime();

  assert.equal(secondsToTimestamp(5), '0:05');
  assert.equal(secondsToTimestamp(65), '1:05');
  assert.equal(secondsToTimestamp(3661), '1:01:01');
});
