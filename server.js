require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { fullAnalysis, sampleGrid } = require('./analyze');

const app = express();
app.use(cors());

function parseLatLonRadius(req, res) {
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);
  const radiusKm = parseFloat(req.query.radiusKm) || 20;
  if (Number.isNaN(lat) || Number.isNaN(lon)) {
    res.status(400).json({ error: 'ต้องระบุ lat และ lon เป็นตัวเลข' });
    return null;
  }
  if (radiusKm < 1 || radiusKm > 50) {
    res.status(400).json({ error: 'radiusKm ต้องอยู่ระหว่าง 1-50' });
    return null;
  }
  return { lat, lon, radiusKm };
}

// GET /api/rain?lat=13.7563&lon=100.5018&radiusKm=20
app.get('/api/rain', async (req, res) => {
  const parsed = parseLatLonRadius(req, res);
  if (!parsed) return;
  try {
    res.json(await fullAnalysis(parsed.lat, parsed.lon, parsed.radiusKm));
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: 'ดึงข้อมูลเรดาร์ฝนไม่สำเร็จ ลองใหม่อีกครั้ง' });
  }
});

// GET /api/grid?lat=..&lon=..&radiusKm=.. — sample points for drawing the radar itself
app.get('/api/grid', async (req, res) => {
  const parsed = parseLatLonRadius(req, res);
  if (!parsed) return;
  try {
    res.json(await sampleGrid(parsed.lat, parsed.lon, parsed.radiusKm));
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: 'ดึงข้อมูลเรดาร์ฝนไม่สำเร็จ ลองใหม่อีกครั้ง' });
  }
});

app.get('/health', (_req, res) => res.json({ ok: true }));

const port = process.env.PORT || 3001;
app.listen(port, () => console.log(`Rain Alert backend listening on :${port}`));
