const VIEWPORT_WIDTH = {
  phone: 576,
  tablet: 768,
  notebook: 1200,
  laptop: 1400,
  desktop: 1920,
};

module.exports.getViewport = function (width) {
  let w = 0;
  if (typeof width === 'string') width = width.toLowerCase();
  const wn = Number.parseInt(width);
  if (!Number.isNaN(wn)) {
    w = wn;
  } else if (VIEWPORT_WIDTH.hasOwnProperty(width)) {
    w = VIEWPORT_WIDTH[width];
  }
  return [w, 1080];
};
