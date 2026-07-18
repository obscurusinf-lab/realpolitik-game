// Разовый скрипт подготовки геоданных районного уровня для тактической карты.
// НЕ часть обычного деплоя — выход коммитится как статичный asset (frontend/src/assets/ua-raions.json),
// как и frontend/src/assets/ua-oblasts.json (тот же источник и лицензия — geoBoundaries.org, CC BY 4.0).
//
// Источник: geoBoundaries UKR ADM2 (районы, дореформенная сетка — 495 полигонов на всю страну,
// без поля привязки к области в properties). Раздел кода ниже сам определяет oblastKey через
// point-in-polygon против уже существующих 5 отслеживаемых контуров областей.
//
// Запуск: node backend/scripts/prepare-ua-raions.js

const https = require("https");
const fs = require("fs");
const path = require("path");

const RAION_URL = "https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/UKR/ADM2/geoBoundaries-UKR-ADM2_simplified.geojson";
const OBLASTS_PATH = path.join(__dirname, "..", "..", "frontend", "src", "assets", "ua-oblasts.json");
const OUT_PATH = path.join(__dirname, "..", "..", "frontend", "src", "assets", "ua-raions.json");

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "realpolitik-game-data-prep" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchJson(res.headers.location).then(resolve, reject);
      }
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on("error", reject);
  });
}

// Площадь кольца (шнуровая формула, планарное приближение — точности достаточно для ранжирования
// районов ВНУТРИ одной области, не для абсолютных гео-измерений).
function ringArea(ring) {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i], [x2, y2] = ring[i + 1];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a / 2);
}

function ringCentroid(ring) {
  let x = 0, y = 0;
  for (const [px, py] of ring) { x += px; y += py; }
  return [x / ring.length, y / ring.length];
}

// Точка в полигоне (ray casting) — только внешнее кольцо, дырки в областях не ожидаются.
function pointInRing(pt, ring) {
  const [x, y] = pt;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    const intersect = (yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// Возвращает { area, centroid } для Polygon/MultiPolygon — центроид берётся по САМОЙ КРУПНОЙ
// части (достаточно точно для облaстной привязки и восток-запад ранжирования, не нужен точный
// многочастный взвешенный центроид).
function geometryStats(geometry) {
  const polys = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  let totalArea = 0;
  let biggestArea = -1, biggestCentroid = null;
  for (const poly of polys) {
    const outer = poly[0];
    const area = ringArea(outer);
    totalArea += area;
    if (area > biggestArea) { biggestArea = area; biggestCentroid = ringCentroid(outer); }
  }
  return { area: totalArea, centroid: biggestCentroid };
}

// Реверс порядка точек внешнего (и внутренних) колец — geoBoundaries отдаёт стандартный
// RFC7946 CCW, но этот проект (см. ua-oblasts.json, уже проверено вживую сегодня) рендерит
// заливку корректно только при ПРОТИВОПОЛОЖНОЙ ориентации (CW) под d3-geo/geoMercator на таком
// масштабе — тот же баг с "хвостом" координат, что облачная сессия уже нашла и починила для
// областей.
function reverseWinding(geometry) {
  if (geometry.type === "Polygon") {
    return { type: "Polygon", coordinates: geometry.coordinates.map((ring) => [...ring].reverse()) };
  }
  return { type: "MultiPolygon", coordinates: geometry.coordinates.map((poly) => poly.map((ring) => [...ring].reverse())) };
}

function round4(coordsGeometry) {
  const r = (n) => Math.round(n * 10000) / 10000;
  if (coordsGeometry.type === "Polygon") {
    return { type: "Polygon", coordinates: coordsGeometry.coordinates.map((ring) => ring.map(([x, y]) => [r(x), r(y)])) };
  }
  return { type: "MultiPolygon", coordinates: coordsGeometry.coordinates.map((poly) => poly.map((ring) => ring.map(([x, y]) => [r(x), r(y)]))) };
}

(async () => {
  console.log("Fetching national raion geometry...");
  const national = await fetchJson(RAION_URL);
  console.log(`  ${national.features.length} raions total`);

  const oblasts = JSON.parse(fs.readFileSync(OBLASTS_PATH, "utf8"));
  const trackedOblasts = oblasts.features.filter((f) => f.properties.tracked);
  console.log(`  ${trackedOblasts.length} tracked oblasts:`, trackedOblasts.map((f) => f.properties.key));

  const kept = [];
  for (const raion of national.features) {
    const { area, centroid } = geometryStats(raion.geometry);
    if (!centroid || area <= 0) continue;
    const oblast = trackedOblasts.find((o) => pointInRing(centroid, o.geometry.coordinates[0]));
    if (!oblast) continue; // вне 5 отслеживаемых областей — не нужна районная детализация
    kept.push({
      raion,
      oblastKey: oblast.properties.key,
      area,
      centroidLon: centroid[0],
      shapeName: raion.properties.shapeName,
    });
  }
  console.log(`  ${kept.length} raions matched to tracked oblasts`);

  const oblastTotalArea = {};
  for (const k of kept) oblastTotalArea[k.oblastKey] = (oblastTotalArea[k.oblastKey] || 0) + k.area;
  for (const key of Object.keys(oblastTotalArea)) {
    const count = kept.filter((k) => k.oblastKey === key).length;
    console.log(`  ${key}: ${count} raions, total area ${oblastTotalArea[key].toFixed(3)}`);
  }

  const features = kept.map((k) => ({
    type: "Feature",
    properties: {
      oblastKey: k.oblastKey,
      areaShare: Math.round((k.area / oblastTotalArea[k.oblastKey]) * 100000) / 100000,
      centroidLon: Math.round(k.centroidLon * 10000) / 10000,
      shapeName: k.shapeName,
    },
    geometry: round4(reverseWinding(k.raion.geometry)),
  }));

  const out = { type: "FeatureCollection", features };
  fs.writeFileSync(OUT_PATH, JSON.stringify(out));
  const sizeKb = Math.round(fs.statSync(OUT_PATH).size / 1024);
  console.log(`Wrote ${OUT_PATH} (${features.length} features, ${sizeKb}KB)`);
})().catch((e) => { console.error(e); process.exit(1); });
