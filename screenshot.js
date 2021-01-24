const path = require('path');
const sanitizeFilename = require('sanitize-filename');
const fs = require('fs');
const QRCode = require('qrcode');

const { getViewport } = require('./util');

module.exports = async function* screenshot({ argv, browser, archiveUrls, stylesheet }) {
  const [width, height] = getViewport(argv.width);
  let page = await browser.newPage();
  await page._client.send('Emulation.clearDeviceMetricsOverride');
  await page.setViewport({ width, height });
  await page.setBypassCSP(true);

  yield `Going to ${argv.url} (Viewport: ${width}x${height})`;
  await page.goto(argv.url, { waitUntil: 'networkidle0' });
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

  yield 'Adding header';
  const grid = { template: getGridTemplate(width), gap: getGridGap(width) };

  if (!archiveUrls.archiveOrgShortUrl && !archiveUrls.archiveOrgUrl) {
    console.warn(`warn: Missing archive.org link`);
  }
  if (!archiveUrls.archiveTodayUrl) {
    console.warn(`warn: Missing archive.today link`);
  }

  // Add archive urls header
  await page.evaluate(
    (
      { url, archiveOrgUrl, archiveOrgShortUrl, archiveTodayUrl },
      grid,
      nowDate,
      stylesheet,
      qrcode
    ) => {
      const header = `
    <archhive-header style="display:block;background-color: #f7f7f7;border-bottom: 1.5px solid #b4c2d0;padding: 20px 2%;">
      <archhive-header-inner style='display: grid;grid-template:${grid.template};gap:${
        grid.gap
      };font-family: arial;font-size: 20px;'>
        <img src="${qrcode}" alt="" style="grid-area:qr;">
        <archhive-header-item style="display:flex;flex-direction: column;grid-area:url;">
          <span style="display:block;">
            <span style="color: grey;font-variant: common-ligatures;font-weight: 700;letter-spacing: 0.04em;">URL</span>
            ${nowDate}
          </span>
          <span style="display:block;font-family:courier">
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

  yield 'Ensuring all images are loaded';

  try {
    // Load all lazy loading images
    await Promise.race(
      await page.evaluate(async () => {
        // Scroll down to bottom of page to activate lazy loading images
        document.body.scrollIntoView(false);

        // Wait for all remaining lazy loading images to load
        await Promise.all(
          Array.from(document.getElementsByTagName('img'), (image) => {
            if (image.complete) {
              return;
            }

            return new Promise((resolve, reject) => {
              image.addEventListener('load', resolve);
              image.addEventListener('error', reject);
            });
          })
        );

        document.body.scrollTo(0, 0);
      }),
      new Promise((resolve) => setTimeout(resolve, 10000))
    );
  } catch (e) {}

  yield 'Taking full-page screenshot';
  const pageTitle = await page.title();
  const filename = path.join(
    argv.outputDir,
    sanitizeFilename(pageTitle, { replacement: '_' }) + '.jpg'
  );

  if (argv.debug !== 'screenshot') {
    await page.screenshot({
      path: filename,
      fullPage: true,
      quality: argv.quality,
    });
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
