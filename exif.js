const ChildProcess = require('child_process');

module.exports = async function* addExifMetadata({
  argv,
  pageTitle,
  filename,
  archiveUrls,
}) {
  yield 'Adding exif metadata';
  const date = new Date();
  try {
    ChildProcess.spawnSync('exiftool', [
      // Enable newlines and interpret " literally
      '-ec',
      // Remove exif tags from Chrome's screenshotting process
      '-all=',
      // Remove exiftool version number
      '-XMPToolkit=',
      // Escape backslashes
      `-Description=${pageTitle.replace(/\\/g, '\\\\')} \\n ${Object.values(
        archiveUrls
      ).join(' \\n ')}${argv.exifComment ? ` \n ${argv.exifComment}` : ``}`,
      ...(argv.exifKeywords || '')
        .split(',')
        .filter(Boolean)
        .map((keyword) => `-keywords=${keyword}`),
      `-CreatorWorkURL=${archiveUrls.url}`,
      `-DateTimeOriginal=${date.getUTCFullYear()}:${
        date.getUTCMonth() + 1
      }:${date.getUTCDate()} 00:00:00`,
      '-overwrite_original',
      filename,
      // Creator?
      // Author?
    ]);
  } catch (e) {
    console.log('exiftool not installed, skipping', e);
  }
};
