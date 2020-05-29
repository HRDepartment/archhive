#!/usr/bin/env node
const { argv } = require('yargs').options({
  print: {
    type: 'boolean',
    default: false,
  },
  width: {
    type: 'number',
    default: 1280,
  },
  height: {
    type: 'number',
    default: 720,
  },
  quality: {
    type: 'number',
    default: 90,
  },
  shorturl: {
    type: 'string',
    describe:
      '5-30 characters that will be used as v.gd shorturl of the archive.org link',
  },
  force: {
    type: 'boolean',
    describe: 'Force re-archiving',
  },
  output: { type: 'string', default: './image.jpg' },
  adblock: { type: 'boolean', default: true },
});

argv.url = argv.url || argv._.join(' ');

const ora = require('ora');
const screenshot = require('./screenshot');
const archive = require('./archive');
const puppeteer = require('puppeteer-extra');
const path = require('path');
const open = require('open');

// Add stealth plugin and use defaults (all tricks to hide puppeteer usage)
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

if (argv.adblock) {
  // Add adblocker plugin to block all ads and trackers (saves bandwidth)
  const AdblockerPlugin = require('puppeteer-extra-plugin-adblocker');
  puppeteer.use(AdblockerPlugin({ blockTrackers: true }));
}

async function main() {
  const progress = ora(`Archhiving ${argv.url}`).start();
  const browser = await puppeteer.launch({
    headless: true,
    args: [`--window-size=${argv.width},${argv.height}`],
  });

  const userAgent = (await browser.userAgent()).replace('HeadlessChrome/', 'Chrome/');

  const archiveUrls = await reportProgress(archive(argv, userAgent), progress);
  console.log(archiveUrls);

  await reportProgress(screenshot(argv, browser, archiveUrls), progress);
  const output = path.isAbsolute(argv.output)
    ? argv.output
    : path.join(process.cwd(), argv.output);
  progress.succeed(output);
  await open(`file://${output}`);
}

main();

async function reportProgress(asyncGen, progress) {
  for await (const line of asyncGen) {
    if (typeof line === 'string') {
      progress.text = line;
    } else {
      return line;
    }
  }
}
