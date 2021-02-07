import retry from 'async-retry';
import { blockResources } from '../browser.js';
import { createShortURL } from '../shorturl.js';
import { wait } from '../util.js';
/**
 *
 * @param {import('../types').TaskContext} ctx
 * @param {import('../types').Task} task
 */
export async function aoArchive(ctx, task) {
  let archiveOrgUrl;
  let archiveOrgShortUrl;

  if (ctx.opts.aoUrl === 'auto') {
    const page = await ctx.browser.newPage();
    await blockResources(page, ['image']);
    task.output = 'Submitting URL to archive.org';
    let savePageLoaded = false;
    while (!savePageLoaded) {
      const saveResponse = await page.goto(`https://web.archive.org/save`, {
        waitUntil: 'load',
      });
      if (saveResponse.status() !== 200) {
        ctx.log?.(
          `Could not load https://web.archive.org/save: ${saveResponse.statusText()}. Retrying in 1s...`
        );
        await wait(1000);
      } else {
        savePageLoaded = true;
      }
    }
    await page.evaluate((url) => {
      /** @type {HTMLInputElement} */
      (document.querySelector('input[name="url"]')).value = url;
      // Don't save error pages
      /** @type {HTMLInputElement} */
      (document.querySelector('#capture_all')).checked = false;
    }, ctx.opts.url);
    await Promise.all([
      page.click('form[action="/save"] input[type="submit"]'),
      page.waitForNavigation({ waitUntil: 'load' }),
    ]);

    task.output = 'Waiting for archive.org to crawl...';
    archiveOrgUrl = await retry(
      async () => {
        await page.waitForSelector('#spn-result a', { timeout: 20000 });
        const aoUrl = await page.evaluate(() => {
          /** @type {HTMLAnchorElement} */
          const result = document.querySelector('#spn-result a');
          return result.href;
        });
        if (aoUrl === 'https://web.archive.org/save') {
          throw new Error();
        }
        return aoUrl;
      },
      {
        retries: 15,
        minTimeout: 1000,
        maxTimeout: 1000,
        onRetry: () => page.reload({ waitUntil: 'load' }),
      }
    );
    await page.close();
  } else if (ctx.opts.aoUrl !== 'none') {
    archiveOrgUrl = ctx.opts.aoUrl;
  }

  if (archiveOrgUrl && ctx.opts.shorturl !== 'none') {
    task.output = `Creating v.gd shorturl: ${archiveOrgUrl}`;
    archiveOrgShortUrl = await createShortURL(archiveOrgUrl, ctx.opts.shorturl);
  }

  return { archiveOrgUrl, archiveOrgShortUrl };
}
