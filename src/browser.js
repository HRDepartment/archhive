import cliqzAdblocker from '@cliqz/adblocker';
import { readFileSync } from 'fs';
import { join, resolve } from 'path';
import puppeteerExtra from 'puppeteer-extra';
// Adblocker plugin prevents the use of request interception. Use the filter below
// if you need to block content types
import AdblockerPlugin from 'puppeteer-extra-plugin-adblocker';
import AnonymizeUAPlugin from 'puppeteer-extra-plugin-anonymize-ua';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { getViewport } from './util.js';

// Required filters
const ARCHHIVE_FILTERS = `
! Block all video and audio when taking screenshots
||^$media`;

export default async function launchBrowser(argv) {
  puppeteerExtra.use(AnonymizeUAPlugin());

  // Add stealth plugin and use defaults (all tricks to hide puppeteer usage)
  puppeteerExtra.use(StealthPlugin());

  // Add adblocker plugin to block all ads and trackers (saves bandwidth)
  const adblocker = AdblockerPlugin({
    blockTrackers: true,
  });
  const blocker = await adblocker.getBlocker();
  addFiltersToAdblocker(blocker, ARCHHIVE_FILTERS);

  const filtersFile = argv.filters
    ? resolve(argv.filters)
    : join(argv.stylesheetsDir, 'filters.txt');

  let customFilters;
  try {
    customFilters = readFileSync(filtersFile, 'utf8');
  } catch (e) {
    if (argv.filters) {
      console.error(`Could not read filters file: ${filtersFile} (${e.message})`);
      process.exit(1);
    }
  }

  if (customFilters) {
    const filtersUpdated = addFiltersToAdblocker(blocker, customFilters);
    if (argv.debug && filtersUpdated) {
      console.log(`Using custom filters file: ${filtersFile}`);
    }
  }
  puppeteerExtra.use(adblocker);

  const [width, height] = getViewport(argv.width);
  if (!width) {
    console.error(`Invalid width specified: ${argv.width}`);
    process.exit(1);
  }

  const browser = await puppeteerExtra.launch({
    headless: !argv.debug,
    args: [`--window-size=${width},${height}`],
  });
  return browser;
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
