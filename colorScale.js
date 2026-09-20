// Approximate mapping from a RainViewer tile pixel color -> normalized rain intensity (0-1).
//
// RainViewer tiles are transparent where there is no precipitation, and use a color ramp
// (blue -> green -> yellow -> red) for increasing reflectivity under color scheme "2"
// (Universal Blue), which is what this backend requests by default.
//
// ⚠️ This hue-band mapping is a reasonable approximation, not RainViewer's official spec.
// Before relying on it, fetch a few tiles you know are over active rain (see README) and
// sanity-check the intensity values it produces — adjust the hue bands below if they look off.
function pixelToIntensity({ r, g, b, a }) {
  if (a < 12) return 0; // transparent = no precipitation drawn at this pixel

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = max / 255;

  let hue = 0;
  if (max !== min) {
    const d = max - min;
    if (max === r) hue = ((g - b) / d + (g < b ? 6 : 0)) * 60;
    else if (max === g) hue = ((b - r) / d + 2) * 60;
    else hue = ((r - g) / d + 4) * 60;
  }

  let base;
  if (hue >= 180 && hue <= 260) base = 0.25; // blue: light rain
  else if (hue >= 80 && hue < 180) base = 0.45; // green/cyan: light-moderate
  else if (hue >= 40 && hue < 80) base = 0.65; // yellow: moderate
  else if (hue < 40 || hue > 320) base = 0.9; // red/magenta: heavy
  else base = 0.35;

  const alphaFactor = a / 255;
  return Math.min(1, base * (0.6 + 0.4 * lightness) * alphaFactor);
}

module.exports = { pixelToIntensity };
