import test from 'node:test';
import assert from 'node:assert/strict';
import { CaptureTimeoutError, runWithCaptureDeadline } from '../src/capture-deadline.js';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const microtasks = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

test('returns successful capture data, closes its browser once, and clears timers', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let closes = 0;
  let signal;
  const result = await runWithCaptureDeadline((scope) => {
    signal = scope.signal;
    const browser = { close: async () => { closes++; } };
    assert.equal(scope.ownBrowser(browser), browser);
    scope.ownBrowser(browser);
    scope.throwIfExpired();
    return { captured: 2 };
  }, { timeoutMs: 100, closeTimeoutMs: 20 });
  assert.deepEqual(result, { captured: 2 });
  assert.equal(closes, 1);
  t.mock.timers.tick(1_000);
  assert.equal(signal.aborted, false, 'successful capture does not leave a deadline behind');
});

test('times out a renderer operation, aborts the scope, and closes its browser', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let closes = 0;
  let scope;
  const pending = deferred();
  const running = runWithCaptureDeadline((value) => {
    scope = value;
    scope.ownBrowser({ close: async () => { closes++; } });
    return pending.promise;
  }, { timeoutMs: 100, closeTimeoutMs: 20 });
  const rejection = assert.rejects(running, (error) => error instanceof CaptureTimeoutError && error.code === 'UI_SHEET_CAPTURE_TIMEOUT' && error.timeoutMs === 100);
  await microtasks();
  t.mock.timers.tick(100);
  await rejection;
  assert.equal(closes, 1);
  assert.equal(scope.signal.aborted, true);
  assert.throws(() => scope.throwIfExpired(), CaptureTimeoutError);
  pending.reject(new Error('late renderer failure'));
  await microtasks();
});

test('closes a browser whose launch resolves after timeout', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let closes = 0;
  const launch = deferred();
  const running = runWithCaptureDeadline(async (scope) => {
    scope.ownBrowser(await launch.promise);
    return 'too late';
  }, { timeoutMs: 100, closeTimeoutMs: 20 });
  const rejection = assert.rejects(running, CaptureTimeoutError);
  await microtasks();
  t.mock.timers.tick(100);
  await rejection;
  launch.resolve({ close: async () => { closes++; } });
  await microtasks();
  assert.equal(closes, 1);
  t.mock.timers.tick(1_000);
  await microtasks();
  assert.equal(closes, 1);
});

test('bounds hung cleanup and observes its eventual rejection', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const close = deferred();
  const running = runWithCaptureDeadline((scope) => {
    scope.ownBrowser({ close: () => close.promise });
    return 'captured';
  }, { timeoutMs: 100, closeTimeoutMs: 20 });
  const rejection = assert.rejects(running, (error) => error.code === 'UI_SHEET_BROWSER_CLOSE_TIMEOUT');
  await microtasks();
  t.mock.timers.tick(20);
  await rejection;
  close.reject(new Error('late close error'));
  await microtasks();
});

test('preserves operation failures and reports simultaneous cleanup failure', async () => {
  const original = new Error('capture failed');
  await assert.rejects(runWithCaptureDeadline(() => { throw original; }), (error) => error === original);
  await assert.rejects(runWithCaptureDeadline((scope) => {
    scope.ownBrowser({ close: async () => { throw new Error('close failed'); } });
    throw original;
  }), (error) => error instanceof AggregateError && error.errors[0] === original && error.errors[1].message === 'close failed');
});

test('validates options before running and rejects invalid or multiple browsers', async () => {
  let ran = false;
  for (const options of [null, [], { timeoutMs: 0 }, { timeoutMs: Infinity }, { timeoutMs: 900_001 }, { closeTimeoutMs: 0 }, { closeTimeoutMs: 30_001 }]) {
    await assert.rejects(runWithCaptureDeadline(() => { ran = true; }, options), TypeError);
  }
  assert.equal(ran, false);
  await assert.rejects(runWithCaptureDeadline(null), TypeError);
  await assert.rejects(runWithCaptureDeadline((scope) => scope.ownBrowser({})), /close function/);
  let closes = 0;
  await assert.rejects(runWithCaptureDeadline((scope) => {
    scope.ownBrowser({ close: async () => { closes++; } });
    scope.ownBrowser({ close: async () => {} });
  }), /only one browser/);
  assert.equal(closes, 1);
});
