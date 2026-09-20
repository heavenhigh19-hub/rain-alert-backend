const { lonLatToTilePixel, offsetLatLon } = require('./tileMath');
const { getMapsMeta, buildTileUrl, getTilePng, readPixel } = require('./rainviewer');
const { pixelToIntensity } = require('./colorScale');

const ZOOM = 9; // ~0.15-0.3 km/pixel depending on latitude — fine for city-scale radii
const TILE_SIZE = 512;
const COLOR = 2; // Universal Blue palette
const RAIN_THRESHOLD = 0.15;

async function intensityAt(frame, lat, lon) {
  const { tileX, tileY, px, py } = lonLatToTilePixel(lon, lat, ZOOM, TILE_SIZE);
  const url = buildTileUrl(frame, ZOOM, tileX, tileY, TILE_SIZE, COLOR);
  const png = await getTilePng(url);
  return pixelToIntensity(readPixel(png, px, py));
}

// Point forecast: sample the user's exact location across past + nowcast frames.
// RainViewer's nowcast frames are already its own short-range extrapolation, so the
// simplest, most reliable ETA is just "first future frame where intensity crosses the
// threshold" — no motion modeling needed for this one.
async function pointForecast(lat, lon, threshold = RAIN_THRESHOLD) {
  const meta = await getMapsMeta();
  const pastFrames = meta.radar.past;
  const nowcastFrames = meta.radar.nowcast || [];
  const frames = [...pastFrames, ...nowcastFrames];

  const series = [];
  for (const f of frames) {
    series.push({ time: f.time, intensity: await intensityAt(f, lat, lon) });
  }
  const nowIdx = pastFrames.length - 1;
  const now = series[nowIdx];

  let etaMinutes = null;
  for (let i = nowIdx + 1; i < series.length; i++) {
    if (series[i].intensity >= threshold) {
      etaMinutes = Math.round((series[i].time - now.time) / 60);
      break;
    }
  }
  return { series, nowIntensity: now.intensity, etaMinutes };
}

// Ring scan: sample points at 16 bearings around the user for two recent past frames, to
// find the nearest rain edge right now and estimate its bearing + closing speed from how
// far that edge moved between the two frames. This is what drives ทิศทาง / ระยะห่าง in the UI.
async function scan(lat, lon, radiusKm = 20, threshold = RAIN_THRESHOLD) {
  const meta = await getMapsMeta();
  const past = meta.radar.past;
  const frameNow = past[past.length - 1];
  const framePrev = past[Math.max(0, past.length - 3)]; // ~10-20 min earlier

  const bearingsDeg = Array.from({ length: 16 }, (_, i) => i * 22.5);
  const stepKm = radiusKm / 8;

  async function nearestEdge(frame) {
    let best = null; // { distanceKm, bearingDeg }
    for (const bearing of bearingsDeg) {
      const rad = (bearing * Math.PI) / 180;
      for (let d = stepKm; d <= radiusKm; d += stepKm) {
        const dx = Math.sin(rad) * d;
        const dy = Math.cos(rad) * d; // x = east, y = north
        const pt = offsetLatLon(lat, lon, dx, dy);
        const intensity = await intensityAt(frame, pt.lat, pt.lon);
        if (intensity >= threshold) {
          if (!best || d < best.distanceKm) best = { distanceKm: d, bearingDeg: bearing };
          break; // points along this bearing are scanned nearest-first
        }
      }
    }
    return best;
  }

  const [edgeNow, edgePrev] = await Promise.all([nearestEdge(frameNow), nearestEdge(framePrev)]);
  const dtMinutes = (frameNow.time - framePrev.time) / 60;

  if (!edgeNow) return { hasRainNearby: false };

  let closingKmh = null;
  if (edgePrev && dtMinutes > 0) {
    const deltaKm = edgePrev.distanceKm - edgeNow.distanceKm; // positive = got closer
    closingKmh = (deltaKm / dtMinutes) * 60;
  }
  const etaMinutes =
    closingKmh && closingKmh > 0.5 ? Math.round((edgeNow.distanceKm / closingKmh) * 60) : null;

  return {
    hasRainNearby: true,
    distanceKm: Math.round(edgeNow.distanceKm * 10) / 10,
    bearingDeg: edgeNow.bearingDeg,
    closingKmh: closingKmh !== null ? Math.round(closingKmh * 10) / 10 : null,
    etaMinutes,
  };
}

const DIRS_TH = [
  'เหนือ', 'ตะวันออกเฉียงเหนือ', 'ตะวันออก', 'ตะวันออกเฉียงใต้',
  'ใต้', 'ตะวันตกเฉียงใต้', 'ตะวันตก', 'ตะวันตกเฉียงเหนือ',
];
function bearingToThaiDir(deg) {
  return DIRS_TH[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

// Combine the ring-scan physics estimate with RainViewer's own nowcast: when both methods
// agree on ETA, that agreement IS the confidence signal — no need for a separate heuristic.
async function fullAnalysis(lat, lon, radiusKm = 20) {
  const [point, ring] = await Promise.all([pointForecast(lat, lon), scan(lat, lon, radiusKm)]);

  if (point.nowIntensity >= RAIN_THRESHOLD) {
    return { status: 'rain', label: 'ฝนกำลังตกอยู่', etaMinutes: 0, distanceKm: 0, direction: null, confidence: 'สูง' };
  }
  if (!ring.hasRainNearby && point.etaMinutes === null) {
    return { status: 'green', label: 'ไม่มีฝนกำลังเข้าหา', etaMinutes: null, distanceKm: null, direction: null, confidence: null };
  }

  const etaCandidates = [point.etaMinutes, ring.etaMinutes].filter((v) => v !== null);
  const etaMinutes = etaCandidates.length ? Math.min(...etaCandidates) : null;

  let confidence = 'ต่ำ';
  if (point.etaMinutes !== null && ring.etaMinutes !== null) {
    const diff = Math.abs(point.etaMinutes - ring.etaMinutes);
    confidence = diff <= 10 ? 'สูง' : diff <= 25 ? 'กลาง' : 'ต่ำ';
  } else if (etaCandidates.length === 1) {
    confidence = 'กลาง';
  }

  let status = 'green';
  let label = 'ไม่มีฝนกำลังเข้าหาในเร็วๆนี้';
  if (etaMinutes !== null && etaMinutes <= 30) {
    status = 'red'; label = 'ฝนกำลังมา';
  } else if (etaMinutes !== null && etaMinutes <= 90) {
    status = 'yellow'; label = 'ฝนกำลังเข้าใกล้';
  }

  return {
    status,
    label,
    etaMinutes,
    distanceKm: ring.distanceKm ?? null,
    direction: ring.bearingDeg !== undefined ? bearingToThaiDir(ring.bearingDeg) : null,
    confidence,
  };
}

// Grid sample: intensity at a set of bearing/distance points around the user, for the
// "now" frame only — this is what the frontend radar draws instead of simulated cells.
async function sampleGrid(lat, lon, radiusKm = 20) {
  const meta = await getMapsMeta();
  const past = meta.radar.past;
  const frameNow = past[past.length - 1];

  const bearingsDeg = Array.from({ length: 16 }, (_, i) => i * 22.5);
  const distances = Array.from({ length: 8 }, (_, i) => ((i + 1) * radiusKm) / 8);

  const points = [];
  await Promise.all(
    bearingsDeg.map(async (bearingDeg) => {
      const rad = (bearingDeg * Math.PI) / 180;
      for (const d of distances) {
        const dx = Math.sin(rad) * d;
        const dy = Math.cos(rad) * d;
        const pt = offsetLatLon(lat, lon, dx, dy);
        const intensity = await intensityAt(frameNow, pt.lat, pt.lon);
        if (intensity > 0) points.push({ bearingDeg, distanceKm: d, intensity });
      }
    })
  );
  return { time: frameNow.time, points };
}

module.exports = { pointForecast, scan, fullAnalysis, sampleGrid, bearingToThaiDir };
