import { readFileSync } from 'fs';
import { join, dirname } from 'path';

const AT_IMPORT_RULES = /@import (?:url\()?(?:"|')(.*?)(?:"|')\)?(?: (.*?))?;/g;

/**
 *
 * @param {import('./types').ArchhiveOptions} opts
 */
export default async function resolveStylesheet(opts) {
  let stylesheet = '';
  let cssFilename;
  if (opts.stylesheet) {
    cssFilename = opts.stylesheet;
  } else {
    const host = new URL(opts.url).host;
    cssFilename = join(opts.stylesheetsDir, host + '.css');
  }

  try {
    stylesheet = readFileSync(cssFilename, 'utf8');
  } catch (e) {}

  if (stylesheet) {
    stylesheet = stylesheet.replace(AT_IMPORT_RULES, (rule, filename, mediaQueries) => {
      const subsheet = readFileSync(join(dirname(cssFilename), filename), 'utf8');
      if (mediaQueries) {
        return `@media ${mediaQueries} {${subsheet}}`;
      }
      return subsheet;
    });
  }

  return { cssFilename, stylesheet };
}
