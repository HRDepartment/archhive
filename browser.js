const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer-extra');
const { getViewport } = require('./util');

const AnonymizeUAPlugin = require('puppeteer-extra-plugin-anonymize-ua');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
// Adblocker plugin prevents the use of request interception. Use the filter below
// if you need to block content types
const AdblockerPlugin = require('puppeteer-extra-plugin-adblocker');
const { parseFilters } = require('@cliqz/adblocker');

// Required filters
const ARCHHIVE_FILTERS = `
! Block all video and audio when taking screenshots
||^$media`;

module.exports = async function launchBrowser(argv) {
  puppeteer.use(AnonymizeUAPlugin());

  // Add stealth plugin and use defaults (all tricks to hide puppeteer usage)
  puppeteer.use(StealthPlugin());

  // Add adblocker plugin to block all ads and trackers (saves bandwidth)
  const adblocker = AdblockerPlugin({
    blockTrackers: true,
  });
  const blocker = await adblocker.getBlocker();
  addFiltersToAdblocker(blocker, ARCHHIVE_FILTERS);

  const filtersFile = argv.filters
    ? path.resolve(argv.filters)
    : path.join(argv.stylesheetsDir, 'filters.txt');

  let customFilters;
  try {
    customFilters = fs.readFileSync(filtersFile, 'utf8');
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
  puppeteer.use(adblocker);

  const [width, height] = getViewport(argv.width);
  if (!width) {
    console.error(`Invalid width specified: ${argv.width}`);
    process.exit(1);
  }

  const browser = await puppeteer.launch({
    headless: !argv.debug,
    args: [`--window-size=${width},${height}`],
  });
  return browser;
};

function addFiltersToAdblocker(blocker, filters) {
  const { cosmeticFilters, networkFilters } = parseFilters(filters, blocker.config);
  const filtersUpdated = blocker.update({
    newCosmeticFilters: cosmeticFilters,
    newNetworkFilters: networkFilters,
  });
  return filtersUpdated;
}
