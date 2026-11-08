import { runWithCaptureDeadline } from './capture-deadline.js';

export const MAX_SITE_PAGES = 500;
export const MAX_SITE_PREVIEW_BYTES = 64 * 1024 * 1024;
const MAX_QUEUED_LINKS = 5000;
const FILE_EXTENSIONS = /\.(?:7z|avi|css|csv|docx?|eot|gif|ico|jpe?g|js|json|map|mjs|mov|mp3|mp4|otf|pdf|png|pptx?|svg|tar|tgz|ttf|webm|webp|woff2?|xlsx?|xml|zip)$/i;
const UNSAFE_WORDS = /(?:^|[\/._?&#=;\-])(?:log[\-_]?out|sign[\-_]?out|delete|remove|destroy|revoke|disable|deactivate|unsubscribe|reset|submit|save|update|create|add|edit|assign|archive|restore|enable|approve|invite|send|export|download|finalize|publish)(?=$|[\/._?&#=;\-])/i;
const SECRET_PARAMETER = /^(?:access[_-]?token|auth(?:orization)?|code|csrf|jwt|key|otp|password|secret|session(?:id)?|token)$/i;

export function reserveSitePreview(budget, bytes) {
  if (!budget) return true;
  if (bytes > budget.remaining) { budget.omitted++; return false; }
  budget.remaining -= bytes;
  return true;
}

function parsed(input) {
  let url;
  try { url = new URL(input); } catch { return null; }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.href.length > 4096) return null;
  return url;
}

function decoded(value) {
  try {
    let current = value;
    for (let i = 0; i < 3; i++) {
      const next = decodeURIComponent(current);
      if (next === current) break;
      current = next;
    }
    return current;
  } catch { return null; }
}

/** Keep links on the selected site and avoid actions, downloads and sensitive link tokens. */
export function safeSiteUrl(input, origin) {
  const url = parsed(input);
  if (!url || url.origin !== origin) return null;
  const inspect = decoded(`${url.pathname}${url.search}${url.hash}`);
  if (inspect === null) return null;
  if (UNSAFE_WORDS.test(inspect) || FILE_EXTENSIONS.test(url.pathname)) return null;
  for (const key of url.searchParams.keys()) if (SECRET_PARAMETER.test(key)) return null;
  if (/(?:^|[?#&;])(?:access[_-]?token|auth|code|csrf|jwt|otp|password|secret|session|token)=/i.test(inspect)) return null;
  return url.href;
}

function isActionRequest(input, origin) {
  const url = parsed(input);
  if (!url || url.origin !== origin) return false;
  const inspect = decoded(`${url.pathname}${url.search}`);
  return inspect === null || UNSAFE_WORDS.test(inspect);
}

/** URLs are private input: reports omit every query and fragment value. */
export function displaySiteUrl(input) {
  const url = parsed(input);
  if (!url) return 'Unknown page';
  return `${url.origin}${url.pathname}${url.search ? ' ?[parameters hidden]' : ''}${url.hash ? ' #[state hidden]' : ''}`;
}

/** Block mutation requests and navigation away from the authorized site. */
export async function guardSiteContext(context, origin, counts) {
  await context.route('**/*', async (route) => {
    const request = route.request();
    const method = request.method().toUpperCase();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      counts.blockedWrites++;
      await route.abort('blockedbyclient');
      return;
    }
    if (isActionRequest(request.url(), origin)) {
      counts.blockedNavigation++;
      await route.abort('blockedbyclient');
      return;
    }
    if (request.isNavigationRequest() && !safeSiteUrl(request.url(), origin)) {
      counts.blockedNavigation++;
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });
}

/** Discover reachable same-origin links and frame URLs without clicking or submitting forms. */
export async function discoverSite(seed, { seeds = [], browserPath, browserType, storageState, maxPages = MAX_SITE_PAGES, timeoutMs = 900000, onProgress } = {}) {
  const start = parsed(seed);
  if (!start || !safeSiteUrl(start.href, start.origin)) throw new Error('Use an authorized HTTP(S) start page that is not an action or download.');
  if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > MAX_SITE_PAGES) throw new Error(`The site page limit must be from 1 to ${MAX_SITE_PAGES}.`);
  if (!Array.isArray(seeds) || seeds.some((value) => !safeSiteUrl(value, start.origin))) throw new Error('Additional site pages must be safe HTTP(S) URLs on the same origin.');
  const chromium = browserType || (await import('playwright')).chromium;
  return runWithCaptureDeadline(async (deadline) => {
      const browser = deadline.ownBrowser(await chromium.launch({ headless: true, ...(browserPath ? { executablePath: browserPath } : {}) }));
      const context = await browser.newContext({ ...(storageState ? { storageState } : {}), serviceWorkers: 'block' });
      const counters = { blockedWrites: 0, blockedNavigation: 0 };
      await guardSiteContext(context, start.origin, counters);
      const queue = [...new Set([start.href, ...seeds.map((value) => safeSiteUrl(value, start.origin))])], seen = new Set(queue), processed = new Set(), pages = [], failed = [], excluded = [], excludedSeen = new Set();
      let ignoredLinks = 0, queueLimited = false, timeLimited = false, excludedTruncated = false;
      const stopAt = Date.now() + Math.max(Math.floor(timeoutMs / 2), timeoutMs - 30000);
      while (queue.length && pages.length + failed.length < maxPages) {
        deadline.throwIfExpired();
        if (Date.now() >= stopAt) { timeLimited = true; break; }
        const url = queue.shift();
        if (processed.has(url)) continue;
        processed.add(url);
        onProgress?.(pages.length + failed.length + 1);
        const page = await context.newPage();
        try {
          const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
          if (!response?.ok()) throw new Error('http');
          await page.waitForLoadState('networkidle', { timeout: 2000 }).catch(() => {});
          const final = safeSiteUrl(page.url(), start.origin);
          if (!final) throw new Error('redirect');
          const loginPage = await page.locator('input[type=password]:visible').count().catch(() => 0);
          if (loginPage && !/(?:^|[\/._-])(?:log[\-_]?in|sign[\-_]?in)(?:$|[\/._-])/i.test(new URL(url).pathname)) throw new Error('signin');
          const finalUrl = new URL(final);
          const requested = new URL(url);
          const captureUrl = finalUrl.pathname === requested.pathname ? url : final;
          if (captureUrl !== url && processed.has(captureUrl)) continue;
          processed.add(captureUrl); seen.add(captureUrl);
          pages.push(captureUrl);
          for (const frame of page.frames()) {
            let frameUrl;
            try { frameUrl = new URL(frame.url()); } catch { continue; }
            if (frameUrl.origin !== start.origin) continue;
            const links = await frame.evaluate(() => [...document.querySelectorAll('a[href], iframe[src]')].slice(0, 2000).flatMap((node) => {
              if (node.hasAttribute('download') || /^(post|put|patch|delete)$/i.test(node.getAttribute('data-method') || '')) return [];
              if (node.localName === 'a') {
                try {
                  const target = new URL(node.href), here = new URL(document.URL);
                  const hash = target.hash.slice(1);
                  if (hash && target.origin === here.origin && target.pathname === here.pathname && target.search === here.search && document.getElementById(decodeURIComponent(hash))) return [];
                } catch { /* Keep unknown routes for normal URL validation. */ }
              }
              return [node.href || node.src].filter(Boolean);
            })).catch(() => []);
            if (frame !== page.mainFrame()) links.push(frame.url());
            for (const link of links) {
              const candidate = safeSiteUrl(link, start.origin);
              if (!candidate) {
                ignoredLinks++;
                const rejected = parsed(link);
                if (rejected?.origin === start.origin && !FILE_EXTENSIONS.test(rejected.pathname)) {
                  const label = displaySiteUrl(link);
                  if (!excludedSeen.has(label)) {
                    excludedSeen.add(label);
                    if (excluded.length < 500) excluded.push({ url: label, reason: 'Action or sensitive link was not followed.' });
                    else excludedTruncated = true;
                  }
                }
                continue;
              }
              if (seen.has(candidate)) continue;
              if (seen.size >= MAX_QUEUED_LINKS) { queueLimited = true; continue; }
              seen.add(candidate); queue.push(candidate);
            }
          }
        } catch (error) {
          failed.push({ url: displaySiteUrl(url), reason: error.message === 'signin' ? 'Sign-in is required or the saved test session expired.' : error.message === 'redirect' ? 'The page redirected outside the allowed site or to an action.' : 'The page could not be opened.' });
        } finally { await page.close().catch(() => {}); }
      }
      await context.close();
      return { pages, failed, excluded, excludedTruncated, ignoredLinks, blockedWrites: counters.blockedWrites, blockedNavigation: counters.blockedNavigation, truncated: queue.length > 0 || queueLimited, timeLimited, remaining: queue.length, maxPages };
  }, { timeoutMs });
}
