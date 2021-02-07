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

    const date = new Date();
    const dateid = `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(
      2,
      '0'
    )}${String(date.getUTCDate()).padStart(2, '0')}`;
    archiveOrgUrl = `https://web.archive.org/web/${dateid}/${ctx.opts.url}`;
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
