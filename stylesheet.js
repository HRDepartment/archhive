const AT_IMPORT_RULES = /@import (?:url\()?(?:"|')(.*?)(?:"|')\)?(?: (.*?))?;/g;
const fs = require('fs');
const path = require('path');
module.exports = async function resolveStylesheet(argv) {
  let stylesheet = '';
  let cssFilename;
  if (argv.stylesheet) {
    cssFilename = argv.stylesheet;
  } else {
    const host = new URL(argv.url).host;
    cssFilename = path.join(argv.stylesheetsDir, host + '.css');
  }

  try {
    stylesheet = fs.readFileSync(cssFilename);
  } catch (e) {}

  if (stylesheet) {
    stylesheet = stylesheet.replace(AT_IMPORT_RULES, (rule, filename, mediaQueries) => {
      const subsheet = fs.readFileSync(path.join(path.dirname(cssFilename), filename));
      if (mediaQueries) {
        return `@media ${mediaQueries} {${subsheet}}`;
      }
      return subsheet;
    });
  }

  return { cssFilename, stylesheet };
};
