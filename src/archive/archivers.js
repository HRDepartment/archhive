import { aoArchive } from './archiveorg.js';
import { atArchive } from './archivetoday.js';

export default {
  'archive.org': aoArchive,
  'archive.today': atArchive,
};

export function isArchiveOrgUrl(urlObject) {
  return urlObject.hostname === 'web.archive.org';
}

export function isArchiveTodayUrl(urlObject) {
  // assume non archive.org domains are archive.today

  const urlParts = urlObject.hostname.split('.');
  return urlParts.length === 2 && urlParts[0] === 'archive' && urlParts[1] !== 'org';
}

export function isArchiveUrl(urlString) {
  const url = new URL(urlString);

  return isArchiveOrgUrl(url) || isArchiveTodayUrl(url);
}
