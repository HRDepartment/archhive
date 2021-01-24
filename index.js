#!/usr/bin/env node
const path = require('path');
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
  aoUrl: {
    type: 'string',
    describe:
      'Pre-defined archive.org URL, useful when selecting a historical snapshot. "auto" (default) attempts to archive the URL. You may be prompted if the link is invalid to select a historic snapshot. "none" skips archive.org archiving.',
    default: 'auto',
  },
  atUrl: {
    type: 'string',
    describe:
      'Pre-defined archive.today URL, useful when selecting a historical snapshot. "auto" (default) attempts to archive the URL. "none" skips archive.today archiving.',
    default: 'auto',
  },
  stylesheet: {
    type: 'string',
    describe:
      'File containing the stylesheet to be used for the screenshot process. Overrides --stylesheets-dir. @import rules are supported.',
  },
  stylesheetsDir: {
    type: 'string',
    describe:
      'Directory containing stylesheets (files named origin.css, e.g. www.example.com.css) for the screenshot process. @import rules are supported',
    default: path.join(process.cwd(), 'stylesheets'),
  },
  filters: {
    type: 'string',
    describe:
      'File containing a list of Adblock filters to apply. Almost all filters (cosmetic and network) are supported. Defaults to <stylesheet-dir/filters.txt>',
  },
  shorturl: {
    type: 'string',
    describe:
      '5-30 characters that will be used as v.gd shorturl of the archive.org link',
  },
  exifComment: {
    type: 'string',
    describe: 'Custom text to add at the end of the EXIF description',
  },
  exifKeywords: {
    type: 'string',
    describe: 'List of keywords to add to the EXIF data, separated by commas (no spaces)',
  },
  renew: {
    type: 'string',
    describe:
      '"manual" to manually determine whether to rearchive the link. "auto" (default) automatically determines whether the link is outdated. "never" to never renew',
    default: 'auto',
  },
  outputDir: { type: 'string', default: process.cwd() },
  adblock: { type: 'boolean', default: true },
  debug: { type: 'boolean', default: false },
});

argv.url = argv.url || argv._.join(' ');

const ora = require('ora');
const screenshot = require('./screenshot');
const archiveMethods = require('./archive');
const resolveStylesheet = require('./stylesheet');
const addExifMetadata = require('./exif');
const launchBrowser = require('./browser');
const open = require('open');
const { prompt } = require('enquirer');

async function main() {
  if (!argv.url) {
    argv.url = await prompt({ type: 'input', message: 'URL:' });
  }

  try {
    new URL(argv.url);
  } catch (e) {
    console.error('Invalid URL specified:', argv.url);
    process.exit(1);
  }
  const { cssFilename, stylesheet } = await resolveStylesheet(argv);
  if (argv.debug) {
    console.info(
      stylesheet
        ? `Using stylesheet: ${cssFilename}`
        : `Could not find stylesheet: ${cssFilename}`
    );
  }

  let progress = ora().start(`Starting browser`);
  const browser = await launchBrowser(argv);

  progress.prefixText = 'Archiving URL';
  try {
    let archiveUrls = { url: argv.url };
    const activeArchiveMethods = [];
    for (const { site, exec } of archiveMethods) {
      activeArchiveMethods.push(reportProgress(exec({ argv, browser }), progress));
    }

    const archiveResults = (await Promise.allSettled(activeArchiveMethods))
      .filter(({ status }) => status === 'fulfilled')
      .map(({ value }) => value);
    for (const result of archiveResults) archiveUrls = { ...archiveUrls, ...result };

    progress.prefixText = '';
    progress.succeed(`Archiving URL`);
    progress = ora().start('Screenshot');
    const { pageTitle, filename } = await reportProgress(
      screenshot({ argv, browser, archiveUrls, stylesheet }),
      progress
    );
    await reportProgress(
      addExifMetadata({ argv, pageTitle, filename, archiveUrls }),
      progress
    );

    progress.succeed('Screenshot');
    console.log(filename);
    await open(`file://${filename}`);
  } catch (e) {
    if (argv.debug) console.error(e);
    progress.fail(e.message);
  }

  await browser.close();
}

main();

async function reportProgress(iterator, progress) {
  // This emulates for await of, but allows us to pass back the results of {prompt: ...} to yield
  let item = await iterator.next();
  while (!item.done) {
    if (typeof item.value === 'string') {
      progress.text = item.value;
      item = await iterator.next();
    } else {
      if (item.value?.prompt) {
        item = await iterator.next(await prompt(item.value.prompt));
      } else {
        return item.value;
      }
    }
  }

  return item.value;
}
