export const DEFAULT_CAPTURE_TIMEOUT_MS = 120_000;
export const DEFAULT_BROWSER_CLOSE_TIMEOUT_MS = 15_000;

export class CaptureTimeoutError extends Error {
  constructor(timeoutMs) {
    super(`Page capture exceeded its ${timeoutMs} ms deadline. Browser cleanup was requested; the scan did not complete.`);
    this.name = 'CaptureTimeoutError';
    this.code = 'UI_SHEET_CAPTURE_TIMEOUT';
    this.timeoutMs = timeoutMs;
  }
}

function duration(value, name, maximum) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new TypeError(`${name} must be an integer from 1 to ${maximum} milliseconds.`);
  return value;
}

/**
 * Bound an entire capture, including renderer evaluations, and own its browser.
 * The operation must await launch, register its browser immediately, and check
 * throwIfExpired before publishing data. A timed-out operation can still settle
 * later; its rejection is observed and a late browser is also asked to close.
 * Browser closure is bounded and cannot guarantee termination of a hung process.
 */
export async function runWithCaptureDeadline(operation, options = {}) {
  if (typeof operation !== 'function') throw new TypeError('Capture operation must be a function.');
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('Capture deadline options must be an object.');
  const timeoutMs = duration(options.timeoutMs ?? DEFAULT_CAPTURE_TIMEOUT_MS, 'timeoutMs', 900_000);
  const closeTimeoutMs = duration(options.closeTimeoutMs ?? DEFAULT_BROWSER_CLOSE_TIMEOUT_MS, 'closeTimeoutMs', 30_000);
  const controller = new AbortController();
  let browser;
  let closing;
  let ended = false;
  let deadlineTimer;

  function closeBrowser() {
    if (!browser) return Promise.resolve();
    if (closing) return closing;
    let closeTimer;
    const closeAttempt = Promise.resolve().then(() => browser.close());
    const closeDeadline = new Promise((_, reject) => {
      closeTimer = setTimeout(() => {
        const error = new Error(`Capture browser did not close within ${closeTimeoutMs} ms. Check task-owned browser processes before starting another capture.`);
        error.code = 'UI_SHEET_BROWSER_CLOSE_TIMEOUT';
        reject(error);
      }, closeTimeoutMs);
    });
    closing = Promise.race([closeAttempt, closeDeadline]).finally(() => clearTimeout(closeTimer));
    // Late browser registration can occur after the caller received a timeout.
    // Keep that cleanup rejection observed as well.
    closing.catch(() => {});
    return closing;
  }

  const scope = {
    signal: controller.signal,
    ownBrowser(value) {
      if (!value || typeof value.close !== 'function') throw new TypeError('Capture browser must provide a close function.');
      if (browser && browser !== value) throw new Error('A capture deadline can own only one browser.');
      browser = value;
      if (ended || controller.signal.aborted) {
        void closeBrowser();
        throw controller.signal.reason || new Error('Capture operation has already ended.');
      }
      return value;
    },
    throwIfExpired() {
      if (controller.signal.aborted) throw controller.signal.reason;
      if (ended) throw new Error('Capture operation has already ended.');
    },
  };

  const deadline = new Promise((_, reject) => {
    deadlineTimer = setTimeout(() => {
      const error = new CaptureTimeoutError(timeoutMs);
      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });
  let result;
  let failure;
  let failed = false;
  try {
    // Promise.race observes operation rejection even after the deadline wins.
    result = await Promise.race([Promise.resolve().then(() => operation(scope)), deadline]);
  } catch (error) {
    failed = true;
    failure = error;
  } finally {
    ended = true;
    clearTimeout(deadlineTimer);
  }
  try {
    await closeBrowser();
  } catch (error) {
    if (!failed) throw error;
    throw new AggregateError([failure, error], 'Page capture failed and browser cleanup did not complete.');
  }
  if (failed) throw failure;
  return result;
}
