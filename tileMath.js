// Slippy-map (Web Mercator) tile math used by RainViewer's tile URLs.

function lonLatToTilePixel(lon, lat, zoom, tileSize) {
  const latRad = (lat * Math.PI) / 180;
  const n = Math.pow(2, zoom);
  const xTile = ((lon + 180) / 360) * n;
  const yTile =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;

  const tileX = Math.floor(xTile);
  const tileY = Math.floor(yTile);
  const px = Math.min(tileSize - 1, Math.floor((xTile - tileX) * tileSize));
  const py = Math.min(tileSize - 1, Math.floor((yTile - tileY) * tileSize));
  return { tileX, tileY, px, py };
}

// Offset a lat/lon by dx/dy kilometers (east/north). Flat-earth approximation —
// fine at the <50km radii this app works with, not meant for long distances.
function offsetLatLon(lat, lon, dxKm, dyKm) {
  const dLat = dyKm / 111.32;
  const dLon = dxKm / (111.32 * Math.cos((lat * Math.PI) / 180));
  return { lat: lat + dLat, lon: lon + dLon };
}

module.exports = { lonLatToTilePixel, offsetLatLon };
