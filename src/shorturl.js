import fetch from 'node-fetch';

/**
 *
 * @param {string} url
 * @param {string} shorturl
 */
export function createShortURL(url, shorturl) {
  return fetch(
    `https://v.gd/create.php?format=simple&url=${encodeURIComponent(url)}${
      shorturl ? `&shorturl=${encodeURIComponent(shorturl)}` : ''
    }`
  ).then((r) => {
    if (r.ok) return r.text();
    // Url already is in use, use it
    if (shorturl) {
      return `https://v.gd/${shorturl}`;
    }
    return r.text().then((e) => {
      throw new Error(e);
    });
  });
}
