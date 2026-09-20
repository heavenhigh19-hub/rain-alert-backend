# Rain Alert Backend

ดึงข้อมูลเรดาร์ฝนจริงจาก [RainViewer](https://www.rainviewer.com/api.html) (ฟรี ไม่ต้องใช้ API key)
แล้วคำนวณ ระยะห่าง / ทิศทาง / ETA / ความมั่นใจ ให้ตำแหน่งที่ระบุ — endpoint เดียว พร้อมให้หน้าเว็บ
Rain Alert เรียกใช้แทนตัวจำลองที่มีอยู่

## วิธีรัน

```bash
npm install
cp .env.example .env
npm start
```

ทดสอบ:
```
curl "http://localhost:3001/api/rain?lat=13.7563&lon=100.5018&radiusKm=20"
curl "http://localhost:3001/api/grid?lat=13.7563&lon=100.5018&radiusKm=20"
```

`/api/rain` จะได้ผลลัพธ์ประมาณนี้:
```json
{
  "status": "yellow",
  "label": "ฝนกำลังเข้าใกล้",
  "etaMinutes": 42,
  "distanceKm": 14.5,
  "direction": "ตะวันตกเฉียงเหนือ",
  "confidence": "กลาง"
}
```
`status` เป็นหนึ่งใน `green` / `yellow` / `red` / `rain` — ใช้ map เป็น 🟢🟡🔴🌧️ ในหน้าเว็บได้ตรงๆ
(ส่วน ⚪ "ข้อมูลไม่พอ" ให้ frontend จัดการเองตอนยังไม่ได้ตำแหน่งผู้ใช้)

`/api/grid` คืนจุดตัวอย่างรอบตำแหน่งผู้ใช้ (16 ทิศ x 8 ระยะ) สำหรับวาดเรดาร์:
```json
{ "time": 1732000000, "points": [{ "bearingDeg": 45, "distanceKm": 5, "intensity": 0.4 }, ...] }
```

## โครงสร้างโค้ด (ไฟล์เดี่ยว ไม่มีโฟลเดอร์ย่อย — อัปโหลดผ่านมือถือง่าย)

- `server.js` — Express endpoint `/api/rain` และ `/api/grid`
- `rainviewer.js` — ดึง metadata + ภาพ tile จาก RainViewer พร้อม cache สั้นๆ (2 นาที) กันยิงถี่เกิน
- `tileMath.js` — แปลง lat/lon ↔ tile/pixel, และ offset ตำแหน่งเป็นกิโลเมตร
- `colorScale.js` — แปลงสีพิกเซลของ tile เป็นค่าความเข้มฝน 0-1
- `analyze.js` — ตรรกะหลัก 2 ชุดที่ทำงานร่วมกัน:
  - **pointForecast**: เช็คความเข้มฝน ณ ตำแหน่งผู้ใช้ ข้าม frame อดีต + nowcast (RainViewer
    คำนวณการเคลื่อนที่ล่วงหน้าให้เองอยู่แล้วในเฟรม nowcast) — ได้ ETA แบบตรงไปตรงมา
  - **scan**: สแกนวงแหวนรอบผู้ใช้ 16 ทิศ เทียบ 2 เฟรมอดีต เพื่อหาขอบฝนที่ใกล้ที่สุดตอนนี้
    และความเร็ว/ทิศทางที่มันเคลื่อนเข้าหา — ได้ระยะห่าง/ทิศทางที่ point forecast บอกไม่ได้
  - **fullAnalysis**: รวมสองอย่างเข้าด้วยกัน และใช้ "ความสอดคล้องของ ETA จากสองวิธี" เป็นตัว
    วัดความมั่นใจ — ถ้าสองวิธีให้ ETA ใกล้กัน = มั่นใจสูง

## ⚠️ ข้อควรรู้ก่อนใช้จริง

`colorScale.js` แปลงสีพิกเซลเป็นความเข้มฝนด้วยการประมาณ hue ของ palette ที่ RainViewer ใช้
(color scheme "2" / Universal Blue) — ไม่ใช่ค่าที่ได้จาก RainViewer อย่างเป็นทางการ ก่อนใช้งานจริง
ควรทดสอบกับพื้นที่ที่รู้อยู่แล้วว่ามีฝนตก (เช็คจากแอปพยากรณ์อากาศทั่วไปเทียบกัน) แล้วปรับช่วง hue ใน
ไฟล์นั้นถ้าผลลัพธ์ดูไม่ตรง

`scan()` ยิง fetch หลายครั้งต่อ 1 request (สูงสุด ~16 ทิศ x จุดตรวจในแต่ละทิศ x 2 เฟรม) แต่ tile
cache (2 นาที) จะช่วยลดจำนวนการดึงซ้ำเมื่อมีผู้ใช้หลายคนในพื้นที่ใกล้กันเรียกพร้อมกัน — ถ้าจะรองรับ
ผู้ใช้จำนวนมาก ควรเพิ่ม rate limiting และพิจารณาย้ายไปสแกนแบบ tile-based (ดึง tile 1 ครั้งแล้วอ่านหลาย
พิกเซลจากในหน่วยความจำ) แทนการยิง fetch ต่อจุด

## Deploy

### ทางที่ 1: GitHub + Render — ทำผ่านเบราว์เซอร์ล้วนๆ ไม่ต้องมีคอม/เทอร์มินัล (เหมาะกับมือถือ)

1. แตก zip นี้ในเครื่อง/มือถือ ให้เห็นไฟล์ทั้งหมด (ไม่มีโฟลเดอร์ย่อยแล้ว อัปโหลดง่าย)
2. ไปที่ [github.com](https://github.com) → กด "+" → **New repository** → ตั้งชื่อ เช่น
   `rain-alert-backend` → Create repository
3. ในหน้า repo ที่ว่างเปล่า กด **uploading an existing file** (หรือ Add file → Upload files)
4. เลือกไฟล์ทั้งหมดที่แตกไว้ (เลือกได้ทีละหลายไฟล์) ลากหรือเลือกขึ้นไปพร้อมกัน แล้วกด **Commit changes**
5. ไปที่ [render.com](https://render.com) → สมัคร/login (เชื่อมด้วยบัญชี GitHub ได้เลย)
6. New → **Web Service** → เลือก repo `rain-alert-backend` ที่เพิ่งสร้าง
7. Render จะอ่าน `render.yaml` แล้วตั้งค่า Build/Start command ให้อัตโนมัติ (ถ้าไม่ขึ้นให้เอง ใส่เอง:
   Build command `npm install`, Start command `npm start`)
8. กด **Create Web Service** รอ deploy เสร็จ แล้วคัดลอก URL ที่ได้ (เช่น
   `https://rain-alert-backend.onrender.com`) ไปใส่ใน `BACKEND_URL` ของ `rain-alert.html`

### ทางที่ 2: Railway CLI — ถ้ามีคอมพิวเตอร์และเทอร์มินัล

```bash
npm install -g @railway/cli
railway login
cd rain-backend
railway init
railway up
railway domain
```
เอา URL ที่ได้ไปใส่ใน `BACKEND_URL` เหมือนกัน

## เชื่อมกับหน้าเว็บ Rain Alert ที่มีอยู่

`rain-alert.html` (เวอร์ชันล่าสุด) มีโค้ดเชื่อมต่อ backend ในตัวอยู่แล้ว — แค่หา `const BACKEND_URL = ''`
ใกล้ต้นสคริปต์ แล้วใส่ URL ของ backend หลัง deploy เช่น `'https://your-rain-backend.onrender.com'`

พฤติกรรมที่ตั้งไว้:
- ถ้า `BACKEND_URL` ว่าง → หน้าเว็บใช้ข้อมูลจำลองเหมือนเดิมทุกอย่าง (แตะจอทดสอบได้)
- ถ้าใส่ URL แล้วเชื่อมต่อสำเร็จ → ดึง `/api/rain` (ตัวเลข ETA/ทิศทาง/ระยะ/ความมั่นใจ) และ `/api/grid`
  (จุดฝนจริงสำหรับวาดเรดาร์) ทุก ~2.5 นาที ปิดโหมดทดสอบชั่วคราว และปิดแถบย้อนหลัง (ยังไม่รองรับกับ
  ข้อมูลจริงในเวอร์ชันนี้)
- ถ้าใส่ URL แล้วแต่เชื่อมต่อไม่สำเร็จ (backend ล่ม/ยังไม่ deploy/ตั้ง CORS ผิด) → สลับกลับไปโหมดจำลอง
  อัตโนมัติ พร้อมข้อความแจ้งในหน้าจอ

ตรวจสอบว่า backend เปิด CORS ให้โดเมนที่ publish หน้าเว็บไว้แล้ว (ในโค้ดนี้เปิดกว้างด้วย `cors()`
เริ่มต้น — ถ้าจะจำกัดโดเมนทีหลังให้แก้ใน `server.js`)
