import { spawnSync } from 'child_process';
/**
 *
 * @param {import('./types').TaskContext} ctx
 * @param {import('./types').Task} task
 */
export default async function addExifMetadata(ctx, task) {
  task.output = 'Adding exif metadata';
  const date = new Date();
  try {
    spawnSync('exiftool', [
      // Enable newlines and interpret " literally
      '-ec',
      // Remove exif tags from Chrome's screenshotting process
      '-all=',
      // Remove exiftool version number
      '-XMPToolkit=',
      // Escape backslashes
      `-Description=${ctx.pageTitle.replace(/\\/g, '\\\\')} \\n ${Object.values(
        ctx.urls
      ).join(' \\n ')}${ctx.opts.exifComment ? ` \n ${ctx.opts.exifComment}` : ``}`,
      ...(ctx.opts.exifKeywords || '')
        .split(',')
        .filter(Boolean)
        .map((keyword) => `-keywords=${keyword}`),
      `-CreatorWorkURL=${ctx.urls.url}`,
      `-DateTimeOriginal=${date.getUTCFullYear()}:${String(
        date.getUTCMonth() + 1
      ).padStart(2, '0')}:${String(date.getUTCDate()).padStart(2, '0')} 00:00:00`,
      '-overwrite_original',
      ctx.filename,
      // Creator?
      // Author?
    ]);
  } catch (e) {
    task.skip('exiftool not installed, skipping');
  }
}
