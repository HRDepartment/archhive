const fetch = require('node-fetch');
const { wait } = require('./util');

async function* aoArchive({ argv, browser }) {
  let archiveOrgUrl;
  let archiveOrgShortUrl;

  if (argv.aoUrl === 'auto') {
    const page = await browser.newPage();
    await blockResources(page, ['image']);
    yield 'Submitting URL to archive.org';
    let savePageLoaded = false;
    while (!savePageLoaded) {
      const saveResponse = await page.goto(`https://web.archive.org/save`, {
        waitUntil: 'load',
      });
      if (saveResponse.status() !== 200) {
        console.error(
          `Could not load https://web.archive.org/save: ${saveResponse.statusText()}. Retrying in 1s...`
        );
        await wait(1000);
      } else {
        savePageLoaded = true;
      }
    }
    await page.evaluate((url) => {
      document.querySelector('input[name="url"]').value = url;
      // Don't save error pages
      document.querySelector('#capture_all').checked = false;
    }, argv.url);
    await Promise.all([
      page.click('form[action="/save"] input[type="submit"]'),
      page.waitForNavigation({ waitUntil: 'load' }),
    ]);
    yield 'Waiting for archive.org to crawl...';
    await page.waitForSelector('#spn-result a', { timeout: 120000 });
    archiveOrgUrl = await page.evaluate(
      () => document.querySelector('#spn-result a').href
    );
    if (archiveOrgUrl === 'https://web.archive.org/save') {
      await new Promise((resolve) => setTimeout(resolve, 10000));
      throw new Error();
    }
    await page.close();
  } else if (argv.aoUrl !== 'none') {
    archiveOrgUrl = argv.aoUrl;
  }

  if (archiveOrgUrl && argv.shorturl !== 'none') {
    yield `Creating v.gd shorturl: ${archiveOrgUrl}`;
    archiveOrgShortUrl = await createShortURL(archiveOrgUrl, argv.shorturl);
    yield 'archive.org';
  }

  return { archiveOrgUrl, archiveOrgShortUrl };
}

async function* atArchive({ argv, browser }) {
  let archiveTodayUrl;
  if (argv.atUrl === 'auto') {
    page = await browser.newPage();
    // Disable image loading so the browser doesn't crash when loading a snapshot
    await blockResources(page, ['image']);
    await page.setJavaScriptEnabled(false);
    await page.goto('https://archive.today', { waitUntil: 'domcontentloaded' });
    await page.evaluate((url) => {
      document.querySelector('#url').value = url;
    }, argv.url);
    try {
      await Promise.all([
        page.click('input[type="submit"][value="save"]'),
        page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
      ]);
    } catch (e) {
      const currentUrl = page.url();
      if (argv.debug) console.error(e);
      const useArchived = (yield {
        prompt: {
          type: 'confirm',
          message: `A crash occurred while loading archive.today, but an archived copy already exists which can be used (${currentUrl}). Would you like to use it?`,
          name: 'continue',
          initial: true,
        },
      }).continue;
      if (useArchived) {
        await page.close();
        return { archiveTodayUrl: currentUrl };
      }
      throw e;
    }

    const originalUrl = page.url();
    // Due to a race condition the archiver will crash (because of archive.today's navigation) while we are still on the /submit page
    // A timeout fixes this and gives time to navigate to the /wip/ page
    if (originalUrl.includes('/submit')) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    const already = await page.evaluate(() => !!document.getElementById('DIVALREADY'));
    if (already) {
      const archivedText = await page.evaluate(
        () => document.querySelector('span[itemprop="description"]').textContent
      );
      const archivedDate = new Date(archivedText.replace('archived ', ''));
      let rearchive = false;
      // Check if archivedDate parsed correctly
      if (archivedDate.getTime()) {
        if (argv.renew === 'auto') {
          const ONE_YEAR = 31556952000;
          if (new Date().getTime() - archivedDate.getTime() > ONE_YEAR) {
            rearchive = true;
          }
        } else if (argv.renew === 'manual') {
          // TODO: keyboard input
        }
      } else {
        console.error('Could not parse date on archive.today page', { archivedText });
      }

      if (rearchive) {
        if (argv.debug) console.log('Rearchiving on archive.today');
        try {
          await Promise.all([
            page.click('input[type="submit"][value="save"]'),
            page.waitForNavigation({ waitUntil: 'domcontentloaded' }, { timeout: 10000 }),
          ]);
        } catch (e) {
          if (argv.debug) console.error(e);
          const useArchived = (yield {
            prompt: {
              type: 'confirm',
              message: `Could not rearchive on archive.today, but an archived copy already exists (${originalUrl}). Would you like to use it?`,
              name: 'continue',
              initial: true,
            },
          }).continue;
          if (useArchived) archiveTodayUrl = originalUrl;
          else throw e;
        }
      }
    }

    if (!archiveTodayUrl) {
      archiveTodayUrl = page.url();
      if (archiveTodayUrl.includes('/submit')) {
        const pageTitle = await page.title();
        // CAPTCHA
        if (pageTitle === 'Attention Required!') {
          if (originalUrl.includes('/submit')) {
            throw new Error('archive.today is throwing a CAPTCHA when archiving links');
          } else {
            const useArchived = (yield {
              prompt: {
                type: 'confirm',
                message: `archive.today is throwing a CAPTCHA, but an archived copy already exists (${originalUrl}). Would you like to use it?`,
                name: 'continue',
                initial: true,
              },
            }).continue;
            if (useArchived) {
              await page.close();
              return { archiveTodayUrl: originalUrl };
            }
          }
        }

        // Redirect page or captcha
        const pageHTML = (await page.evaluate(() => document.body.innerHTML)) || '';
        const wipUrlMatch = pageHTML.match(/document\.location\.replace\("(.*?)"\)/);
        if (wipUrlMatch?.[1]) {
          archiveTodayUrl = wipUrlMatch[1];
        } else {
          if (argv.debug) await new Promise((resolve) => setTimeout(resolve, 10000));
          throw new Error();
        }
      }
    }

    archiveTodayUrl = archiveTodayUrl.replace('wip/', '');
    await page.close();
    yield 'archive.today';
  } else if (argv.atUrl !== 'none') {
    archiveTodayUrl = argv.atUrl;
  }

  return { archiveTodayUrl };
}

module.exports = [
  { site: 'archive.org', exec: aoArchive },
  { site: 'archive.today', exec: atArchive },
];

function createShortURL(url, shorturl) {
  return fetch(
    `https://v.gd/create.php?format=simple&url=${encodeURIComponent(url)}${
      shorturl ? `&shorturl=${encodeURIComponent(shorturl)}` : ''
    }`
  ).then((r) => {
    if (r.ok) return r.text();
    // Url already is in use, use it
    if (shorturl) {
      console.warn(`v.gd/${shorturl} already exists`);
      return `https://v.gd/${shorturl}`;
    }
    return r.text().then((e) => {
      throw new Error(e);
    });
  });
}

async function blockResources(page, blocked) {
  // Give the listener some time to register
  await new Promise((resolve) => setTimeout(resolve, 100));
  // Remove adblocker request handler
  // https://github.com/cliqz-oss/adblocker/blob/master/packages/adblocker-puppeteer/adblocker.ts
  page.removeAllListeners('request');
  page.on('request', async (request) => {
    if (blocked.includes(request.resourceType())) request.abort();
    else request.continue();
  });
}
