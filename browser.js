const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer-extra');
const { getViewport } = require('./util');

const AnonymizeUAPlugin = require('puppeteer-extra-plugin-anonymize-ua');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

module.exports = async function launchBrowser(argv) {
  puppeteer.use(AnonymizeUAPlugin());

  // Add stealth plugin and use defaults (all tricks to hide puppeteer usage)
  puppeteer.use(StealthPlugin());

  if (argv.adblock) {
    // Add adblocker plugin to block all ads and trackers (saves bandwidth)
    const AdblockerPlugin = require('puppeteer-extra-plugin-adblocker')({
      blockTrackers: true,
    });
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
      const { parseFilters } = require('@cliqz/adblocker');
      const blocker = await AdblockerPlugin.getBlocker();
      const { cosmeticFilters, networkFilters } = parseFilters(
        customFilters,
        blocker.config
      );
      const filtersUpdated = blocker.update({
        newCosmeticFilters: cosmeticFilters,
        newNetworkFilters: networkFilters,
      });
      if (argv.debug && filtersUpdated) {
        console.log(`Using custom filters file: ${filtersFile}`);
      }
    }
    puppeteer.use(AdblockerPlugin);
  }

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
