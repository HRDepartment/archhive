const wb = require('wayback-pagesaver');
const fetch = require('node-fetch');
const archivetoday = require('archivetoday');

module.exports = async function* archive(argv, userAgent) {
  yield 'Saving to archive.org';
  const archiveOrgUrl = await wb(argv.url);
  yield `Creating v.gd shortlink: ${archiveOrgUrl}`;
  let archiveOrgShortUrl = await fetch(
    `https://v.gd/create.php?format=simple&url=${encodeURIComponent(archiveOrgUrl)}${
      argv.shorturl ? `&shorturl=${encodeURIComponent(argv.shorturl)}` : ''
    }`
  ).then((r) => {
    if (r.ok) return r.text();
    // Url already is in use, use it
    if (argv.shorturl) {
      console.warn(`v.gd/${argv.shorturl} already exists`);
      return `https://v.gd/${argv.shorturl}`;
    }
    return r.text().then((e) => {
      throw new Error(e);
    });
  });
  yield 'Saving to archive.today';
  const { url: archiveTodayUrl } = await archivetoday.snapshot({
    url: argv.url,
    userAgent,
    renew:
      argv.force ||
      ((cachedDate) =>
        new Date().getTime() - cachedDate.getTime() > 1000 * 60 * 60 * 24 * 7 * 12),
    complete: false,
  });
  yield { url: argv.url, archiveOrgUrl, archiveOrgShortUrl, archiveTodayUrl };
};
