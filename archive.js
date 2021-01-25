const fetch = require('node-fetch');

async function* aoArchive({ argv, browser }) {
  let archiveOrgUrl;
  let archiveOrgShortUrl;

  if (argv.aoUrl === 'auto') {
    const page = await browser.newPage();
    yield 'Submitting URL to archive.org';
    await page.goto(`https://web.archive.org/save`, {
      waitUntil: 'domcontentloaded',
    });
    await page.evaluate((url) => {
      document.querySelector('input[name="url"]').value = url;
      // Don't save error pages
      document.querySelector('#capture_all').checked = false;
    }, argv.url);
    await Promise.all([
      page.click('form[action="/save"] input[type="submit"]'),
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
    ]);
    yield 'Waiting for archive.org to crawl...';
    await page.waitForSelector('#spn-result a', { timeout: 70000 });
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
    await page.setJavaScriptEnabled(false);
    await page.goto('https://archive.today', { waitUntil: 'domcontentloaded' });
    await page.evaluate((url) => {
      document.querySelector('#url').value = url;
    }, argv.url);
    await Promise.all([
      page.click('input[type="submit"][value="save"]'),
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
    ]);
    const already = await page.$('#DIVALREADY');
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
        // const urlBefore = page.url(); TODO: captcha
        await Promise.all([
          page.click('input[type="submit"][value="save"]'),
          page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
        ]);
        // Redirect page or captcha
        if (page.url().includes('/submit')) {
          const pageHTML = (await page.evaluate(() => document.body.innerHTML)) || '';
          const wipUrlMatch = pageHTML.match(/document\.location\.replace\("(.*?)"\)/);
          if (wipUrlMatch?.[1]) {
            archiveTodayUrl = wipUrlMatch[1];
          }
        }
      }
    }

    if (!archiveTodayUrl) {
      archiveTodayUrl = page.url();
      if (archiveTodayUrl.includes('/submit')) {
        throw new Error();
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
