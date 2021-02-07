import retry from 'async-retry';
import { blockResources } from '../browser.js';
/**
 *
 * @param {import('../types').TaskContext} ctx
 * @param {import('../types').Task} task
 */
export async function atArchive(ctx, task) {
  let archiveTodayUrl;
  if (ctx.opts.atUrl === 'auto') {
    task.output = 'Submitting URL to archive.today';
    const page = await ctx.browser.newPage();
    // Disable image loading so the browser doesn't crash when loading a snapshot
    await blockResources(page, ['image']);
    await page.setJavaScriptEnabled(false);
    await page.goto('https://archive.today', { waitUntil: 'domcontentloaded' });
    const atDomain = new URL(page.url()).hostname;
    task.title = atDomain;
    task.output = `Submitting URL to ${atDomain}`;
    await page.evaluate((url) => {
      /** @type {HTMLInputElement} */ (document.querySelector('#url')).value = url;
    }, ctx.opts.url);
    try {
      await Promise.all([
        page.click('input[type="submit"][value="save"]'),
        page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
      ]);
    } catch (e) {
      const currentUrl = page.url();
      if (ctx.opts.debug) ctx.log?.(e);
      const useArchived = /** @type {any} */ (await ctx.prompt?.({
        type: 'confirm',
        message: `A crash occurred while loading archive.today, but an archived copy already exists which can be used (${currentUrl}). Would you like to use it?`,
        name: 'continue',
        initial: true,
      }))?.continue;
      if (useArchived) {
        await page.close();
        return { archiveTodayUrl: currentUrl };
      }
      throw e;
    }

    const originalUrl = page.url();
    const already = await retry(
      () => page.evaluate(() => !!document.getElementById('DIVALREADY')),
      { minTimeout: 100, maxTimeout: 500 }
    );
    if (already) {
      const archivedText = await page.evaluate(
        () => document.querySelector('span[itemprop="description"]').textContent
      );
      const archivedDate = new Date(archivedText.replace('archived ', ''));
      let rearchive = false;
      // Check if archivedDate parsed correctly
      if (archivedDate.getTime()) {
        if (ctx.opts.renew === 'auto') {
          const ONE_YEAR = 31556952000;
          if (new Date().getTime() - archivedDate.getTime() > ONE_YEAR) {
            rearchive = true;
          }
        } else if (ctx.opts.renew === 'manual') {
          // TODO: keyboard input
        }
      } else {
        ctx.log?.('Could not parse date on archive.today page:', { archivedText });
      }

      if (rearchive) {
        task.output = `Rearchiving on ${atDomain}`;
        try {
          await Promise.all([
            page.click('input[type="submit"][value="save"]'),
            page.waitForNavigation({ waitUntil: 'domcontentloaded' }, { timeout: 10000 }),
          ]);
        } catch (e) {
          if (ctx.opts.debug) ctx.log?.(e);
          const useArchived = /** @type {any} */ (await ctx.prompt?.({
            type: 'confirm',
            message: `Could not rearchive on archive.today, but an archived copy already exists (${originalUrl}). Would you like to use it?`,
            name: 'continue',
            initial: true,
          }))?.continue;
          if (useArchived) archiveTodayUrl = originalUrl;
          else throw e;
        }
      }
    }

    if (!archiveTodayUrl) {
      archiveTodayUrl = page.url();
      if (archiveTodayUrl.includes('/submit')) {
        const pageTitle = await retry(() => page.title(), {
          minTimeout: 100,
          maxTimeout: 500,
        });
        // CAPTCHA
        if (pageTitle === 'Attention Required!') {
          if (originalUrl.includes('/submit')) {
            throw new Error('archive.today is throwing a CAPTCHA when archiving links');
          } else {
            const useArchived = /** @type {any} */ (await ctx.prompt?.({
              type: 'confirm',
              message: `archive.today is throwing a CAPTCHA, but an archived copy already exists (${originalUrl}). Would you like to use it?`,
              name: 'continue',
              initial: true,
            }))?.continue;
            if (useArchived) {
              await page.close();
              return { archiveTodayUrl: originalUrl };
            }
          }
        }

        // Redirect page or captcha
        const pageHTML =
          (await retry(() => page.evaluate(() => document.body.innerHTML), {
            minTimeout: 100,
            maxTimeout: 500,
          })) || '';

        const wipUrlMatch = pageHTML.match(/document\.location\.replace\("(.*?)"\)/);
        if (wipUrlMatch?.[1]) {
          archiveTodayUrl = wipUrlMatch[1];
        } else {
          // WIP page most likely
          archiveTodayUrl = page.url();
          if (archiveTodayUrl.includes('/submit')) {
            if (ctx.opts.debug)
              await new Promise((resolve) => setTimeout(resolve, 10000));
            throw new Error();
          }
        }
      }
    }

    archiveTodayUrl = archiveTodayUrl.replace('wip/', '');
    await page.close();
  } else if (ctx.opts.atUrl !== 'none') {
    archiveTodayUrl = ctx.opts.atUrl;
  }

  return { archiveTodayUrl };
}
