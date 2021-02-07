import { readFileSync } from 'fs';
import { join, dirname } from 'path';

const AT_IMPORT_RULES = /@import (?:url\()?(?:"|')(.*?)(?:"|')\)?(?: (.*?))?;/g;

export default async function resolveStylesheet(argv) {
  let stylesheet = '';
  let cssFilename;
  if (argv.stylesheet) {
    cssFilename = argv.stylesheet;
  } else {
    const host = new URL(argv.url).host;
    cssFilename = join(argv.stylesheetsDir, host + '.css');
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
