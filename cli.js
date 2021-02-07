#!/usr/bin/env node
import { join } from 'path';
import yargs from 'yargs';
import Listr from 'listr';
import open from 'open';
import { appendFileSync } from 'fs';
import enquirer from 'enquirer';
import screenshot from './src/screenshot.js';
import archivers from './src/archive/archivers.js';
import resolveStylesheet from './src/stylesheet.js';
import addExifMetadata from './src/exif.js';
import launchBrowser from './src/browser.js';
import { VIEWPORT_WIDTH } from './src/util.js';

const log = console.log;
// @ts-ignore
const { argv: yargsArgv } = yargs(process.argv.slice(2)).options({
  print: {
    type: 'boolean',
    describe: "Whether to use the page's print stylesheet",
    default: false,
  },
  width: {
    type: 'string',
    describe:
      'Screenshot viewport width (e.g. 1920) or one of: mini (492), mobile (576), tablet (768), notebook (1200), laptop (1400, default), desktop (1920)',
  },
  screenshot: {
    type: 'string',
    choice: ['fullpage', 'stitched', 'none'],
    describe:
      "Screenshot method to use.\nfullpage (default): Take a screenshot of the page in one go. Does not work with very tall pages. Unresponsive pages with a horizontal scrollbar will override the viewport's width for the screenshot.\nstitched: Stitch together screenshots of the page by scrolling down the height of the viewport. Certain sticky elements may cause issues, especially when scripting is enabled, which must be fixed manually with a stylesheet.\nnone: Do not take a screenshot.",
    default: 'fullpage',
  },
  screenshotQuality: {
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
    default: join(process.cwd(), 'stylesheets'),
  },
  filters: {
    type: 'string',
    describe:
      'File containing a list of Adblock filters to apply. Almost all filters (cosmetic and network) are supported. Defaults to <stylesheet-dir/filters.txt>',
  },
  shorturl: {
    type: 'string',
    describe:
      '5-30 characters that will be used as v.gd shorturl of the archive.org link, or "none" to disable',
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
    choices: ['auto', 'manual', 'no'],
    describe:
      '"no" to always use the latest existing snapshot when possible. "manual" to manually determine whether to rearchive the link. "auto" (default) automatically determines whether the link is outdated. "never" to never renew',
    default: 'auto',
  },
  referrer: {
    type: 'string',
    describe:
      'Referrer site to use when visiting the site when taking a screenshot. Useful for paywalls. Presets: g: https://google.com, ddg: https://duckduckgo.com',
  },
  outputDir: { type: 'string', default: process.cwd() },
  noscript: {
    type: 'boolean',
    describe:
      'If passed, JavaScript will be disabled when taking a screenshot. Useful especially for paywall websites and obnoxious popups.',
    default: false,
  },
  imageLoadTimeout: {
    type: 'number',
    describe:
      'Timeout in milliseconds for images to load. In noscript mode, this amount of time is always elapsed to let images load.',
    default: 15000,
  },
  debug: {
    type: 'string',
    choices: ['all', 'screenshot'],
    describe:
      'screenshot: Debug the screenshotting process without saving files or archiving a URL.',
  },
  url: { type: 'string', describe: 'URL to archive' },
});

/**
 * @type {import('./src/types').ArchhiveOptions}
 */
// @ts-ignore
const opts = yargsArgv;

async function main() {
  const originalArgv = { ...opts };
  if (!opts.url) {
    // @ts-ignore
    const extraArgs = opts._.join(' ');
    if (extraArgs) {
      opts.url = extraArgs;
    } else {
      opts.url = /** @type {any} */ (await enquirer.prompt({
        type: 'input',
        message: 'URL:',
        name: 'url',
      })).url;
      if (!opts.width) {
        opts.width = /** @type {any} */ (await enquirer.prompt({
          type: 'select',
          message: 'Viewport:',
          name: 'width',
          choices: Object.keys(VIEWPORT_WIDTH),
        })).width;
      }
    }
  }

  if (!opts.width) opts.width = 'laptop';

  if (opts.debug === 'screenshot') {
    if (opts.aoUrl === 'auto') {
      opts.aoUrl = 'archive.org/debug';
      opts.shorturl = 'none';
    }
    if (opts.atUrl === 'auto') opts.atUrl = 'archive.today/debug';
  }

  try {
    new URL(opts.url);
  } catch (e) {
    throw new Error(`Invalid URL specified: ${opts.url}`);
  }

  const { cssFilename, stylesheet } = await resolveStylesheet(opts);
  if (opts.debug) {
    log(
      stylesheet
        ? `Using stylesheet: ${cssFilename}`
        : `Could not find stylesheet: ${cssFilename}`
    );
  }

  /** @type {Listr<import('./src/types').TaskContext>}> */
  const tasks = new Listr(
    [
      {
        title: 'Start browser',
        task: launchBrowser,
      },
      {
        title: 'Archiving URL',
        task(ctx, task) {
          const archivingTasks = [];
          for (const site in archivers) {
            function retryableTask(...args) {
              return archivers[site](...args)
                .then((res) => {
                  ctx.urls = { ...ctx.urls, ...res };
                })
                .catch(async (e) => {
                  log(e);
                  const retry = /** @type {any} */ (await enquirer.prompt({
                    type: 'confirm',
                    message: `${site} failed to archive ${opts.url}. Retry?`,
                    name: 'retry',
                    initial: true,
                  })).retry;
                  if (retry) {
                    return retryableTask(...args);
                  }
                  throw e;
                });
            }
            archivingTasks.push({
              title: site,
              task: retryableTask,
            });
          }

          return new Listr(archivingTasks, { concurrent: true, exitOnError: true });
        },
      },
      {
        title: 'Screenshot',
        task: screenshot,
      },
      {
        title: 'EXIF Metadata',
        skip() {
          if (opts.debug === 'screenshot') {
            return 'Debugging screenshot';
          }
        },
        task: addExifMetadata,
      },
    ],
    { exitOnError: true }
  );

  // @ts-ignore Partial context
  const ctx = await tasks.run({
    prompt: enquirer.prompt,
    log,
    opts,
    stylesheet,
    urls: { url: opts.url },
  });
  await ctx.browser.close();

  log(`File: ${ctx.filename}`);
  log(
    `archive.org: ${ctx.urls.archiveOrgUrl}${
      ctx.urls.archiveOrgShortUrl ? ` (${ctx.urls.archiveOrgShortUrl})` : ''
    }`
  );
  log(`archive.today: ${ctx.urls.archiveTodayUrl}`);
  if (opts.debug !== 'screenshot') {
    await open(`file://${ctx.filename}`);
    const launchArgv = process.argv.slice(2);
    // Add --width and --url if they are specified via the CLI
    if (!originalArgv.width) launchArgv.push('--width', opts.width);
    if (!originalArgv.url) launchArgv.push(`"${opts.url}"`);
    appendFileSync(
      join(opts.outputDir, '.archhive_history'),
      `${launchArgv.join(' ')} # ${new Date()}\n`
    );
  }
}
main().catch((e) => {
  log(e);
  process.exit(1);
});
