const path = require('path');
const sanitizeFilename = require('sanitize-filename');
const QRCode = require('qrcode');
const { default: fullPageScreenshot } = require('puppeteer-full-page-screenshot');

const { getViewport, wait } = require('./util');
const { promisify } = require('util');
const { exec } = require('child_process');
const execAsync = promisify(exec);
const mozjpeg = require('mozjpeg');
const { rename } = require('fs/promises');

module.exports = async function* screenshot({ argv, browser, archiveUrls, stylesheet }) {
  const [width, height] = getViewport(argv.width);
  const referer = getReferrer(argv.referrer);
  let page = await browser.newPage();
  await page._client.send('Emulation.clearDeviceMetricsOverride');
  await page.setViewport({ width, height });
  // Need to bypass csp for the inline QR code image and custom stylesheet
  await page.setBypassCSP(true);
  if (argv.noscript) {
    await page.setJavaScriptEnabled(false);
  }

  yield `Going to ${argv.url} (Viewport: ${width}x${height})`;
  await page.goto(argv.url, { waitUntil: 'networkidle0', timeout: 60000, referer });
  if (argv.print) {
    console.info('Using print media for screenshot');
    await page.emulateMediaType('print');
  }

  const actualUrl = page.url();
  if (actualUrl !== argv.url) {
    console.warn(`\nRedirect followed: ${actualUrl}`);
  }

  yield `Generating QR Code for ${actualUrl}`;
  const qrcode = await QRCode.toDataURL(actualUrl, {
    margin: 0,
    color: { light: '#f7f7f7' },
  });

  yield 'Ensuring all images are loaded';
  if (argv.noscript) {
    await wait(argv.imageLoadTimeout);
  } else {
    await page.evaluate(async () => {
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
        wait(argv.imageLoadTimeout),
      ]);
    });
  }

  yield 'Fixing page layout';
  // Various compatibility fixes
  await page.evaluate(async () => {
    // position:fixed -> position:absolute
    // For websites with sticky headers
    const elems = Array.from(document.body.querySelectorAll('nav, header, div'));
    for (const elem of elems) {
      const position = window.getComputedStyle(elem, null).getPropertyValue('position');
      // Some pages will set !important rules which we must override with setProperty
      if (position === 'fixed') {
        elem.style.setProperty('position', 'absolute', 'important');
        elem.style.setProperty('inset', 'initial', 'important');
      }
    }

    // Disable weird rules present on some pages
    document.body.style.setProperty('paddingTop', '0', 'important');
    document.body.style.setProperty('marginTop', '0', 'important');
    // Ensure scrollbar is disabled
    document.body.innerHTML += `<style>html::-webkit-scrollbar {width: 0;height: 0;}</style>`;
    // Some sites have a position:absolute element as direct child of body which breaks the header
    document.body.innerHTML += `<style>body>*{inset:initial!important;}</style>`;
    // Without this the header will be empty in screenshots due to lazy rendering
    window.scrollTo(0, 0);
  });

  yield 'Adding header';
  const grid = { template: getGridTemplate(width), gap: getGridGap(width) };

  if (!archiveUrls.archiveOrgShortUrl && !archiveUrls.archiveOrgUrl) {
    console.warn(`warn: Missing archive.org link`);
  }
  if (!archiveUrls.archiveTodayUrl) {
    console.warn(`warn: Missing archive.today link`);
  }

  // Add archive urls header. Should be done after image load
  await page.evaluate(
    async (
      { url, archiveOrgUrl, archiveOrgShortUrl, archiveTodayUrl },
      grid,
      nowDate,
      stylesheet,
      qrcode
    ) => {
      const header = `
    <archhive-header style="display:block;background-color: #f7f7f7;border-bottom: 1.5px solid #b4c2d0;padding: 20px 2%;line-height: normal;">
      <archhive-header-inner style='display: grid;grid-template:${grid.template};gap:${
        grid.gap
      };font-family: arial;font-size: 20px;'>
        <img src="${qrcode}" alt="" style="grid-area:qr;min-width:140px;max-width:100%">
        <archhive-header-item style="display:flex;flex-direction: column;grid-area:url;">
          <span style="display:block;">
            <span style="color: grey;font-variant: common-ligatures;font-weight: 700;letter-spacing: 0.04em;">URL</span>
            ${nowDate}
          </span>
          <span style="display:block;font-family:courier;overflow-wrap: anywhere;">
            ${removeProtocol(url)}
          </span>
        </archhive-header-item>
        <archhive-header-item style="display:flex;flex-direction: column;grid-area:ao;">
          <span style="display:block;color: grey;font-variant: common-ligatures;font-weight: 700;letter-spacing: 0.04em;">ARCHIVE.ORG</span>
          <span style="display:block;font-family:courier">
            ${removeProtocol(archiveOrgShortUrl || archiveOrgUrl)}
          </span>
        </archhive-header-item>
        <archhive-header-item style="display:flex;flex-direction: column;grid-area: at;">
          <span style="display:block;color: grey;font-variant: common-ligatures;font-weight: 700;letter-spacing: 0.04em;">ARCHIVE.TODAY</span>
          <span style="display:block;font-family:courier">
            ${removeProtocol(archiveTodayUrl)}
          </span>
        </archhive-header-item>
      </archhive-header-inner>
    </archhive-header>`;
      document.head.insertAdjacentHTML('beforebegin', header);
      document.body.innerHTML += `<style>${stylesheet}</style>`;
      function removeProtocol(url = '') {
        return url.replace(/^https?:\/\//, '');
      }
    },
    archiveUrls,
    grid,
    currentDate(),
    stylesheet,
    qrcode
  );

  // Wait for header reflow
  await wait(1000);

  yield 'Taking full-page screenshot';
  const pageTitle = await page.title();
  const screenshotFile = titleToFilename(pageTitle) + '.jpg';
  const filename = path.join(argv.outputDir, screenshotFile);
  const filenameTemp = path.join(argv.outputDir, screenshotFile + '.tmp');

  if (argv.debug !== 'screenshot') {
    const quality = argv.screenshotQuality;
    const { pageWidth, pageHeight } = await page.evaluate(() => [
      document.documentElement.scrollWidth,
      document.documentElement.scrollHeight,
    ]);
    if (argv.screenshot === 'fullpage') {
      // Hardcoded limit in Chrome. See https://github.com/puppeteer/puppeteer/issues/359
      if (pageHeight > 16384) {
        argv.screenshot = 'stitched';
        console.warn(
          `warn: The page's height is ${pageHeight}px which is greater than the 'fullpage' limit of 16384px. --screenshot stitched will be used instead. Remember to manually optimize the resulting .jpg.`
        );
      } else if (pageWidth > width) {
        console.warn(
          `warn: The screenshot will be stretched to a width of ${pageWidth}px (was: ${width}px) as the page is not responsive. Use --screenshot stitched if this is undesirable.`
        );
      }
    }
    if (argv.screenshot === 'fullpage') {
      await page.screenshot({
        path: filename,
        fullPage: true,
        quality,
      });
    } else if (argv.screenshot === 'stitched') {
      await fullPageScreenshot(page, { path: filename }, quality);
    }

    yield 'Optimizing screenshot...';
    // Give some time to flush the screenshot to disk
    await wait(500);
    await execAsync(
      `"${mozjpeg}" -quality ${argv.screenshotQuality} -outfile "${filenameTemp}" "${filename}"`,
      { windowsHide: true }
    );
    await rename(filenameTemp, filename);
  }

  if (argv.debug) {
    yield 'Waiting for the browser to be closed manually...';
    await browserDisconnected(browser);
  } else {
    await page.close();
    await browser.close();
  }

  return { pageTitle, filename };
};

function browserDisconnected(browser) {
  return new Promise((resolve) => {
    browser.on('disconnected', resolve);
  });
}

function currentDate() {
  const date = new Date();

  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(
    2,
    '0'
  )}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

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

function getGridGap(width) {
  if (width >= 650) return '24px';
  return '8px';
}

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
    console.error(`--referrer (${referrer}) is not a valid URL, ignoring.`);
  }
}
