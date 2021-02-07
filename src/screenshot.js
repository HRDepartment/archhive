import { exec } from 'child_process';
import { rename } from 'fs/promises';
import mozjpeg from 'mozjpeg';
import { join } from 'path';
import fullPageScreenshot from 'puppeteer-full-page-screenshot';
import QRCode from 'qrcode';
import sanitizeFilename from 'sanitize-filename';
import { promisify } from 'util';
import { isArchiveOrgUrl, isArchiveTodayUrl, isArchiveUrl } from './archive/archivers.js';
import { getViewport, wait } from './util.js';

const execAsync = promisify(exec);

/**
 *
 * @param {import('./types').TaskContext} ctx
 * @param {import('./types').Task} task
 */
export default async function screenshot(ctx, task) {
  const [width, height] = getViewport(ctx.opts.width);
  let referer;
  try {
    referer = getReferrer(ctx.opts.referrer);
  } catch (e) {
    ctx.log?.(e.message);
  }

  let page = await ctx.browser.newPage();

  await page._client.send('Emulation.clearDeviceMetricsOverride');
  await page.setViewport({ width, height });
  // Need to bypass csp for the inline QR code image and custom stylesheet
  await page.setBypassCSP(true);
  await page.emulateTimezone('UTC');
  if (ctx.opts.noscript) {
    // page.addStyleTag does not work with noscript, so don't use it
    await page.setJavaScriptEnabled(false);
  }

  task.output = `Going to ${ctx.opts.url} (Viewport: ${width}x${height})`;
  await page.goto(ctx.opts.url, { waitUntil: 'networkidle0', timeout: 60000, referer });
  if (ctx.opts.print) {
    ctx.log?.('Using print media for screenshot');
    await page.emulateMediaType('print');
  }

  const actualUrl = page.url();
  const urlObject = new URL(actualUrl);
  const isAoUrl = isArchiveOrgUrl(urlObject);
  const isAtUrl = isArchiveTodayUrl(urlObject);
  let originalUrl = actualUrl;
  if (actualUrl !== ctx.opts.url) {
    ctx.log?.(`\nRedirect followed: ${actualUrl}`);
  }

  if (isAoUrl) {
    // the URL is after /web/date/...
    originalUrl = urlObject.pathname.split('/').slice(3).join('/');
  } else if (isAtUrl) {
    // Get the URL from the page header. Prefer the 'Original' (readonly input) field if possible
    originalUrl = await page.evaluate(
      () =>
        /** @type {HTMLInputElement} */
        (document.querySelector('#HEADER input[readonly]') ||
          document.querySelector('#HEADER input[name=q]')).value
    );
  }

  task.output = 'Ensuring all images are loaded';
  await loadAllImages(ctx, page);

  task.output = 'Adding header';
  if (!ctx.urls.archiveOrgShortUrl && !ctx.urls.archiveOrgUrl) {
    ctx.log?.(`warn: Missing archive.org link`);
  }
  if (!ctx.urls.archiveTodayUrl) {
    ctx.log?.(`warn: Missing archive.today link`);
  }

  const header = await generateHeader({ urls: ctx.urls, actualUrl, originalUrl, width });
  await page.evaluate(
    ({ header, isAoUrl, isAtUrl, stylesheet }) => {
      function currentDate(date) {
        return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(
          2,
          '0'
        )}-${String(date.getUTCDate()).padStart(2, '0')}`;
      }

      /** @type {number | string} */
      let archiveDate = Date.now(); // Use the current date

      try {
        // For archive.org, get the date time from the URL
        if (isAoUrl) {
          const archiveDatetime = location.pathname
            .split('/')[2]
            .slice(0, '20000101'.length);
          archiveDate = `${archiveDatetime.slice(0, 4)}-${archiveDatetime.slice(
            4,
            6
          )}-${archiveDatetime.slice(6, 8)}`;
        } else if (isAtUrl) {
          // If this is an archive.today snapshot of a web.archive.org link it will have a second original pubdate that we should use instead of the first
          archiveDate = Array.from(document.querySelectorAll('time[itemprop="pubdate"]'))
            .pop()
            .getAttribute('datetime');

          // Remove all of archive.today's HTML and use the original page's HTML
          document.body.innerHTML = document.querySelector('.body').outerHTML;

          // On some sites (blogspots etc.) archive.today's crawler sets absurd 'height' properties with a foregrounds.
          // This is a cheap check to fix this issue
          /** @type any */
          let currentNode = document.body;
          while (
            // the first node that also has children
            (currentNode = Array.from(currentNode.children).find(
              (c) => c.children.length
            ))
          ) {
            if (Number.parseInt(currentNode.style.height) > 4000) {
              currentNode.style.setProperty('height', 'initial', 'important');
              // 'position' also needs to be reset since this bug seems to mostly apply to broken sites with a foreground
              currentNode.style.setProperty('position', 'initial', 'important');
            }
          }
        }
      } catch (e) {
        // Log to browser console for debugging when headless=false
        console.log(e);
      }

      document.head.insertAdjacentHTML('beforebegin', header);
      document.querySelector('archhive-header .archhive-date').textContent = currentDate(
        new Date(archiveDate)
      );
      document.body.innerHTML += `<style>${stylesheet}</style>`;
    },
    {
      header,
      isAoUrl,
      isAtUrl,
      stylesheet: ctx.stylesheet,
    }
  );

  task.output = 'Fixing page layout';
  await applyCompatibilityFixes(ctx, page);

  // Wait for header reflow
  await wait(900);

  task.output = 'Taking full-page screenshot';
  const pageTitle = await page.title();
  const screenshotFile = titleToFilename(pageTitle) + '.jpg';
  const filename = join(ctx.opts.outputDir, screenshotFile);
  const filenameTemp = join(ctx.opts.outputDir, screenshotFile + '.tmp');

  ctx.pageTitle = pageTitle;
  ctx.filename = filename;

  if (ctx.opts.debug !== 'screenshot') {
    const quality = ctx.opts.screenshotQuality;
    const { pageWidth, pageHeight } = await page.evaluate(() => [
      document.documentElement.scrollWidth,
      document.documentElement.scrollHeight,
    ]);
    if (ctx.opts.screenshot === 'fullpage') {
      // Hardcoded limit in Chrome. See https://github.com/puppeteer/puppeteer/issues/359
      if (pageHeight > 16384) {
        ctx.opts.screenshot = 'stitched';
        ctx.log?.(
          `warn: The page's height is ${pageHeight}px which is greater than the 'fullpage' limit of 16384px. --screenshot stitched will be used instead. Remember to manually optimize the resulting .jpg.`
        );
      } else if (pageWidth > width) {
        ctx.log?.(
          `warn: The screenshot will be stretched to a width of ${pageWidth}px (was: ${width}px) as the page is not responsive. Use --screenshot stitched if this is undesirable.`
        );
      }
    }
    if (ctx.opts.screenshot === 'fullpage') {
      await page.screenshot({
        path: filename,
        fullPage: true,
        quality,
      });
    } else if (ctx.opts.screenshot === 'stitched') {
      await fullPageScreenshot(page, { path: filename }, quality);
    }
    task.output = 'Optimizing screenshot...';
    // Give some time to flush the screenshot to disk
    await wait(500);
    await execAsync(
      `"${mozjpeg}" -quality ${ctx.opts.screenshotQuality} -outfile "${filenameTemp}" "${filename}"`,
      { windowsHide: true }
    );
    await rename(filenameTemp, filename);
  }

  if (ctx.opts.debug) {
    task.output = 'Waiting for the browser to be closed manually...';
    await browserDisconnected(ctx.browser);
  } else {
    await page.close();
  }
}

function browserDisconnected(browser) {
  return new Promise((resolve) => {
    browser.on('disconnected', resolve);
  });
}

async function loadAllImages(ctx, page) {
  if (ctx.opts.noscript) {
    await page.evaluate(() => {
      const images = Array.from(document.getElementsByTagName('img'));
      for (const img of images) {
        // data-src etc.
        const lazySrc = img.dataset.lazySrc || img.dataset.src;
        const lazySrcset = img.dataset.lazySrcset || img.dataset.srcset;
        // data attributes used by websites that lazyload images
        if (lazySrc) img.src = lazySrc;
        if (lazySrcset) img.srcset = lazySrcset;
      }
    });
    await wait(ctx.opts.imageLoadTimeout);
  } else {
    await page.evaluate(async (imageLoadTimeout) => {
      // Scroll down to bottom of page to activate lazy loading images
      document.body.scrollIntoView(false);

      // Wait for all remaining lazy loading images to load
      const images = Array.from(document.getElementsByTagName('img'));
      await Promise.race([
        Promise.all(
          images.map((image) => {
            if (image.complete) {
              return Promise.resolve();
            }

            return new Promise((resolve) => {
              image.addEventListener('load', resolve);
              image.addEventListener('error', resolve);
            });
          })
        ),
        new Promise((resolve) => setTimeout(resolve, imageLoadTimeout)), // wait not available here
      ]);
    }, ctx.opts.imageLoadTimeout);
  }
}

async function applyCompatibilityFixes(ctx, page) {
  await page.evaluate(async () => {
    // position:fixed -> position:absolute
    // For websites with sticky headers
    const elems = Array.from(document.body.querySelectorAll('nav, header, div'));

    for (const elem of elems) {
      const computedStyle = window.getComputedStyle(elem, null);
      const position = computedStyle.position;
      // Some pages will set !important rules which we must override with setProperty
      if (position === 'fixed') {
        /** @type {HTMLElement} */ (elem).style.setProperty(
          'position',
          'absolute',
          'important'
        );
        /** @type {HTMLElement} */ (elem).style.setProperty(
          'inset',
          'initial',
          'important'
        );
      }
      // fixes: MediaWiki's header
      else if (position === 'absolute') {
        if (
          computedStyle.top === '0px' &&
          // Add additional conditions to reduce the false positive rate of this heuristic on sites
          elem.tagName === 'DIV' &&
          computedStyle.display === 'block' &&
          computedStyle.zIndex === 'auto'
        ) {
          const headerHeight = /** @type {HTMLElement} */ (document.querySelector(
            'archhive-header'
          )).offsetHeight;
          /** @type {HTMLElement} */ (elem).style.setProperty(
            'top',
            `${headerHeight}px`,
            'important'
          );
        }
      }
    }

    // Disable weird rules present on some pages which are set on the body using style=""
    document.body.style.setProperty('paddingTop', '0', 'important');
    document.body.style.setProperty('marginTop', '0', 'important');
    // Ensure horizontal scrollbar is disabled
    document.body.style.setProperty('overflowX', 'hidden', 'important');
    // Ensure scrollbar is disabled
    document.body.innerHTML += `<style>html::-webkit-scrollbar {width: 0;height: 0;}</style>`;
    // Some sites have a position:absolute element as direct child of body which breaks the header
    document.body.innerHTML += `<style>body>*{inset:initial!important;}</style>`;
    // Without this the header will be empty in screenshots due to lazy rendering
    window.scrollTo(0, 0);
  });
}

async function generateHeader({ urls, actualUrl, originalUrl, width }) {
  /**
   * @param {number} width
   */
  function getGridTemplate(width) {
    if (width >= 1050) {
      return '"qr url ao at"';
    }
    if (width >= 650) {
      return '"qr url url" "qr ao at"';
    }

    if (width >= 560) {
      return '"url qr" "ao qr" "at qr"';
    }

    return '"qr" "url" "ao" "at"';
  }

  /**
   * @param {number} width
   */
  function getGridGap(width) {
    if (width >= 650) return '24px';
    return '8px';
  }

  function removeProtocol(url = '') {
    return url.replace(/^https?:\/\//, '');
  }

  const qrcode = await QRCode.toDataURL(actualUrl, {
    margin: 0,
    color: { light: '#f7f7f7' },
  });
  const gridTemplate = getGridTemplate(width);
  const gridGap = getGridGap(width);

  const urlItems = {
    url: [actualUrl === originalUrl ? 'URL' : 'ORIGINAL', originalUrl],
    ao: ['ARCHIVE.ORG', urls.archiveOrgShortUrl || urls.archiveOrgUrl],
    at: ['ARCHIVE.TODAY', urls.archiveTodayUrl],
  };
  let headerItems = [];

  for (const urlKey in urlItems) {
    const [urlLabel, urlText] = urlItems[urlKey];
    if (!urlText) continue;

    let innerItem;
    if (!headerItems.length) {
      innerItem = `
          <span style="display:block;">
            <span style="color: grey;font-variant: common-ligatures;font-weight: 700;letter-spacing: 0.04em;">${urlLabel}</span>
            <span class="archhive-date"></span>
          </span>
          <span style="display:block;font-family:courier;overflow-wrap: anywhere;">
            ${removeProtocol(urlText)}
          </span>
        </archhive-header-item>`;
    } else {
      innerItem = `
        <span style="display:block;color: grey;font-variant: common-ligatures;font-weight: 700;letter-spacing: 0.04em;">${urlLabel}</span>
        <span style="display:block;font-family:courier">
          ${removeProtocol(urlText)}
        </span>
      `;
    }
    headerItems.push(
      `<archhive-header-item style="display:flex;flex-direction: column;grid-area:${urlKey};">${innerItem}</archhive-header-item>`
    );
  }
  return `
    <archhive-header style="display:block;background-color: #f7f7f7;border-bottom: 1.5px solid #b4c2d0;padding: 20px 2%;line-height: normal;">
      <archhive-header-inner style='display: grid;grid-template:${gridTemplate};gap:${gridGap};font-family: arial;font-size: 20px;'>
        <img src="${qrcode}" alt="" style="grid-area:qr;min-width:140px;max-width:100%">
        ${headerItems.join('\n')}
      </archhive-header-inner>
    </archhive-header>`;
}

/**
 * @param {string} title
 */
function titleToFilename(title) {
  const TITLE_REPLACEMENTS = {
    '"': '”',
    '-': '‐',
    '|': '∣',
    '*': '＊',
    '/': '／',
    '>': '＜',
    '<': '＞',
    ':': '∶',
    '\\': '∖',
    '?': '？',
  };

  for (const char in TITLE_REPLACEMENTS) {
    title = title.replace(new RegExp(`\\${char}`, 'g'), TITLE_REPLACEMENTS[char]);
  }
  return sanitizeFilename(title);
}

/**
 * @param {string} referrer
 */
function getReferrer(referrer) {
  if (!referrer) return;

  const REFERRER_PRESETS = {
    g: 'https://google.com',
    ddg: 'https://duckduckgo.com',
  };
  if (REFERRER_PRESETS.hasOwnProperty(referrer)) {
    return REFERRER_PRESETS[referrer];
  }

  try {
    new URL(referrer);
    return referrer;
  } catch (e) {
    throw new Error(`--referrer (${referrer}) is not a valid URL, ignoring.`);
  }
}
