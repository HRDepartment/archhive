import cliqzAdblocker from '@cliqz/adblocker';
import { readFileSync } from 'fs';
import { join, resolve } from 'path';
import puppeteerExtra from 'puppeteer-extra';
// Adblocker plugin prevents the use of request interception. Use the filter below
// if you need to block content types
import AdblockerPlugin from 'puppeteer-extra-plugin-adblocker';
import AnonymizeUAPlugin from 'puppeteer-extra-plugin-anonymize-ua';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { getViewport, wait } from './util.js';

// Required filters
const ARCHHIVE_FILTERS = `
! Block all video and audio when taking screenshots
||^$media`;

/**
 *
 * @param {import('./types').TaskContext} ctx
 * @param {import('./types').Task} task
 */
export default async function launchBrowser(ctx, task) {
  puppeteerExtra.use(AnonymizeUAPlugin());

  // Add stealth plugin and use defaults (all tricks to hide puppeteer usage)
  puppeteerExtra.use(StealthPlugin());

  // Add adblocker plugin to block all ads and trackers (saves bandwidth)
  const adblocker = AdblockerPlugin({
    blockTrackers: true,
  });
  const blocker = await adblocker.getBlocker();
  addFiltersToAdblocker(blocker, ARCHHIVE_FILTERS);

  const filtersFile = ctx.opts.filters
    ? resolve(ctx.opts.filters)
    : join(ctx.opts.stylesheetsDir, 'filters.txt');

  let customFilters;
  try {
    customFilters = readFileSync(filtersFile, 'utf8');
  } catch (e) {
    if (ctx.opts.filters) {
      throw new Error(`Could not read filters file: ${filtersFile} (${e.message})`);
    }
  }

  if (customFilters) {
    const filtersUpdated = addFiltersToAdblocker(blocker, customFilters);
    if (ctx.opts.debug && filtersUpdated) {
      ctx.log?.(`Using custom filters file: ${filtersFile}`);
    }
  }
  puppeteerExtra.use(adblocker);

  const [width, height] = getViewport(ctx.opts.width);
  if (!width) {
    throw new TypeError(`Invalid width specified: ${ctx.opts.width}`);
  }

  const browser = await puppeteerExtra.launch({
    headless: !ctx.opts.debug,
    args: [`--window-size=${width},${height}`],
  });
  return (ctx.browser = browser);
}

function addFiltersToAdblocker(blocker, filters) {
  const { cosmeticFilters, networkFilters } = cliqzAdblocker.parseFilters(
    filters,
    blocker.config
  );
  const filtersUpdated = blocker.update({
    newCosmeticFilters: cosmeticFilters,
    newNetworkFilters: networkFilters,
  });
  return filtersUpdated;
}

export async function blockResources(page, blocked) {
  // Give the listener some time to register
  await wait(100);
  // Remove adblocker request handler
  // https://github.com/cliqz-oss/adblocker/blob/master/packages/adblocker-puppeteer/adblocker.ts
  page.removeAllListeners('request');
  page.on('request', async (request) => {
    if (blocked.includes(request.resourceType())) request.abort();
    else request.continue();
  });
}
