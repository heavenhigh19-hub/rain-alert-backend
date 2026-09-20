const fetch = require('node-fetch');
const { PNG } = require('pngjs');

const META_URL = 'https://api.rainviewer.com/public/weather-maps.json';

// RainViewer refreshes its radar roughly every 10 minutes — polling more often than
// this just wastes calls, so we cache the metadata response briefly.
const META_TTL_MS = 2 * 60 * 1000;
let metaCache = { data: null, fetchedAt: 0 };

async function getMapsMeta() {
  const now = Date.now();
  if (metaCache.data && now - metaCache.fetchedAt < META_TTL_MS) return metaCache.data;

  const res = await fetch(META_URL);
  if (!res.ok) throw new Error(`RainViewer meta fetch failed: ${res.status}`);
  const data = await res.json();
  metaCache = { data, fetchedAt: now };
  return data;
}

// frame comes from meta.radar.past / meta.radar.nowcast — each has { time, path }.
// color 2 = "Universal Blue" palette (see colorScale.js for how we decode it).
function buildTileUrl(frame, zoom, tileX, tileY, tileSize = 512, color = 2) {
  return `https://tilecache.rainviewer.com${frame.path}/${tileSize}/${zoom}/${tileX}/${tileY}/${color}/1_1.png`;
}

const TILE_TTL_MS = 2 * 60 * 1000;
const tileCache = new Map(); // url -> { png, fetchedAt }

async function getTilePng(url) {
  const cached = tileCache.get(url);
  const now = Date.now();
  if (cached && now - cached.fetchedAt < TILE_TTL_MS) return cached.png;

  const res = await fetch(url);
  if (!res.ok) {
    // A 404 just means no radar data was drawn at that tile (e.g. open ocean) — not fatal.
    if (res.status === 404) return null;
    throw new Error(`Tile fetch failed (${res.status}): ${url}`);
  }
  const buf = await res.buffer();
  const png = PNG.sync.read(buf);
  tileCache.set(url, { png, fetchedAt: now });
  return png;
}

function readPixel(png, px, py) {
  if (!png) return { r: 0, g: 0, b: 0, a: 0 };
  const idx = (png.width * py + px) << 2;
  return { r: png.data[idx], g: png.data[idx + 1], b: png.data[idx + 2], a: png.data[idx + 3] };
}

module.exports = { getMapsMeta, buildTileUrl, getTilePng, readPixel };
