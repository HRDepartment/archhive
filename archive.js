const wb = require('wayback-pagesaver');
const fetch = require('node-fetch');
const cheerio = require('cheerio');

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
  const archiveTodayUrl = await archivetoday({
    url: argv.url,
    userAgent,
    anyway: argv.force,
  });
  yield { url: argv.url, archiveOrgUrl, archiveOrgShortUrl, archiveTodayUrl };
};

async function archivetoday({
  url,
  userAgent,
  archiveDomain = 'https://archive.today',
  anyway = false,
}) {
  return fetch(archiveDomain)
    .then((response) => response.text())
    .then(async (text) => {
      let $ = cheerio.load(text);
      let submitid = $(`input[name="submitid"]`).val();

      let response = await fetch(`${archiveDomain}/submit/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': userAgent,
        },
        body:
          'url=' +
          encodeURIComponent(url) +
          '&submitid=' +
          encodeURIComponent(submitid) +
          '&anyway=' +
          Number(anyway),
      });
      let link;
      if (response.url.includes('/submit')) {
        let text = await response.text();
        let re = /"(https?:\/\/archive\..+?\/.+?)"/;
        link = text.match(re)[1];
      } else {
        link = response.url;
      }
      // Because we're creating a screenshot, we don't have to wait; just remove the wip page redirect.
      return link.replace('/wip/', '/');
    });
}
