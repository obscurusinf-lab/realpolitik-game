// Разовый скрипт подготовки расширенного списка населённых пунктов для тактической карты.
// НЕ часть обычного деплоя — выход коммитится как статичный asset
// (frontend/src/assets/ua-settlements.json), как и ua-raions.json/ua-oblasts.json.
//
// Источник: GeoNames.org (открытые данные, CC BY 4.0) — полный дамп Украины (UA.zip), отфильтрован
// до реальных населённых пунктов (feature class "P", исключая PPLX/PPLQ/PPLH/PPLW — секции города/
// заброшенные/исторические/уничтоженные — не текущие живые НП) внутри 5 отслеживаемых областей
// (через уже существующий point-in-polygon по ua-raions.json).
//
// Крупные города (>~15 названий) оставлены на РУССКОМ (ручной список ниже, тот же, что уже был) —
// GeoNames даёт только латинскую/украинскую транслитерацию имени, для узнаваемых городов это будет
// выглядеть чужеродно рядом с русским текстом остального интерфейса. Мелкие НП (их тысячи, ручной
// перевод нереалистичен) — оставлены как есть из GeoNames, с пометкой в HANDOFF как известное
// ограничение.
//
// Запуск: node backend/scripts/prepare-ua-settlements.js

const https = require("https");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const GEONAMES_URL = "https://download.geonames.org/export/dump/UA.zip";
const RAIONS_PATH = path.join(__dirname, "..", "..", "frontend", "src", "assets", "ua-raions.json");
const OUT_PATH = path.join(__dirname, "..", "..", "frontend", "src", "assets", "ua-settlements.json");
const TMP_DIR = path.join(__dirname, "..", "..", ".tmp-geonames");

// Крупные/стратегически значимые города — русские названия сохранены вручную (см. коммент выше).
// tier 1 — видны без зума (тот же принцип, что уже был у прежних 35 населённых пунктов).
const CURATED_MAJOR = [
  { name: "Бахмут", coords: [37.9994, 48.5947] },
  { name: "Часів Яр", coords: [37.8267, 48.5794] },
  { name: "Торецьк", coords: [37.8383, 48.3908] },
  { name: "Авдіївка", coords: [37.7461, 48.1392] },
  { name: "Курахове", coords: [37.2683, 47.9789] },
  { name: "Покровськ", coords: [37.1764, 48.2836] },
  { name: "Костянтинівка", coords: [37.7161, 48.5333] },
  { name: "Слов'янськ", coords: [37.6053, 48.8536] },
  { name: "Краматорськ", coords: [37.5828, 48.7389] },
  { name: "Волноваха", coords: [37.5106, 47.5972] },
  { name: "Вугледар", coords: [37.2864, 47.7825] },
  { name: "Мар'їнка", coords: [37.5461, 48.0997] },
  { name: "Сєвєродонецьк", coords: [38.4934, 48.9481] },
  { name: "Лисичанськ", coords: [38.4444, 48.9139] },
  { name: "Кремінна", coords: [38.2378, 49.0447] },
  { name: "Рубіжне", coords: [38.3789, 49.0106] },
  { name: "Старобільськ", coords: [38.9019, 49.2717] },
  { name: "Бiловодськ", coords: [39.6033, 49.2075] },
  { name: "Мелітополь", coords: [35.3725, 46.8372] },
  { name: "Енергодар", coords: [34.6564, 47.4986] },
  { name: "Оріхів", coords: [35.7847, 47.5686] },
  { name: "Гуляйполе", coords: [36.2686, 47.6614] },
  { name: "Василівка", coords: [35.2853, 47.4331] },
  { name: "Токмак", coords: [35.7042, 47.2494] },
  { name: "Херсон", coords: [32.6178, 46.6354] },
  { name: "Берислав", coords: [33.4022, 46.8375] },
  { name: "Нова Каховка", coords: [33.3667, 46.75] },
  { name: "Каховка", coords: [33.4783, 46.7867] },
  { name: "Гола Пристань", coords: [32.5083, 46.5058] },
  { name: "Куп'янськ", coords: [37.6156, 49.7086] },
  { name: "Ізюм", coords: [37.2489, 49.2114] },
  { name: "Вовчанськ", coords: [36.9436, 50.2911] },
  { name: "Чугуїв", coords: [36.6875, 49.8386] },
  { name: "Балаклія", coords: [36.8514, 49.4644] },
  { name: "Лиман", coords: [37.8039, 48.9836] },
];

function fetchToFile(url, destPath) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchToFile(res.headers.location, destPath).then(resolve, reject);
      }
      const file = fs.createWriteStream(destPath);
      res.pipe(file);
      file.on("finish", () => file.close(resolve));
    }).on("error", reject);
  });
}

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
function findRaion(raions, pt) {
  return raions.features.find((f) => {
    const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    return polys.some((poly) => pointInRing(pt, poly[0]));
  });
}

// Уровень видимости по населению — крупные НП видны при небольшом зуме, мелкие только вблизи
// (иначе тысяча точек превратится в кашу на любом разумном масштабе).
function tierForPopulation(pop) {
  if (pop >= 15000) return 1;
  if (pop >= 3000) return 2;
  if (pop >= 800) return 3;
  return 4;
}

(async () => {
  fs.mkdirSync(TMP_DIR, { recursive: true });
  const zipPath = path.join(TMP_DIR, "UA.zip");
  console.log("Fetching GeoNames Ukraine dump...");
  await fetchToFile(GEONAMES_URL, zipPath);
  execSync(`unzip -o "${zipPath}" -d "${TMP_DIR}"`, { stdio: "inherit" });

  const raions = JSON.parse(fs.readFileSync(RAIONS_PATH, "utf8"));
  const lines = fs.readFileSync(path.join(TMP_DIR, "UA.txt"), "utf8").split("\n");
  const EXCLUDE_CODES = new Set(["PPLX", "PPLQ", "PPLH", "PPLW"]);
  const geonamesPlaces = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const c = line.split("\t");
    const featureClass = c[6], featureCode = c[7], name = c[1];
    const lat = parseFloat(c[4]), lon = parseFloat(c[5]), population = parseInt(c[14], 10) || 0;
    if (featureClass !== "P" || EXCLUDE_CODES.has(featureCode) || population < 300) continue;
    const raion = findRaion(raions, [lon, lat]);
    if (!raion) continue;
    geonamesPlaces.push({
      name, coords: [Math.round(lon * 10000) / 10000, Math.round(lat * 10000) / 10000], population,
      tier: tierForPopulation(population), oblastKey: raion.properties.oblastKey, raionName: raion.properties.shapeName,
    });
  }
  console.log(`GeoNames: ${geonamesPlaces.length} settlements (population >= 300) in tracked oblasts`);

  // Дедуп: GeoNames-точка ближе ~0.05° (примерно 4-5км) к ручной — считаем тем же городом,
  // оставляем ручную (русское название).
  const deduped = geonamesPlaces.filter((g) => {
    return !CURATED_MAJOR.some((m) => Math.abs(m.coords[0] - g.coords[0]) < 0.05 && Math.abs(m.coords[1] - g.coords[1]) < 0.05);
  });
  console.log(`After dedup against ${CURATED_MAJOR.length} curated majors: ${deduped.length} remain`);

  const majors = CURATED_MAJOR.map((m) => {
    const raion = findRaion(raions, m.coords);
    return { ...m, tier: 1, oblastKey: raion?.properties.oblastKey ?? null, raionName: raion?.properties.shapeName ?? null };
  }).filter((m) => m.oblastKey); // на случай, если ручная координата мимо всех районов — не рендерить мусор
  const out = [...majors, ...deduped];
  fs.writeFileSync(OUT_PATH, JSON.stringify(out));
  const sizeKb = Math.round(fs.statSync(OUT_PATH).size / 1024);
  console.log(`Wrote ${OUT_PATH} (${out.length} settlements, ${sizeKb}KB)`);
  console.log("Tier breakdown:", [1, 2, 3, 4].map((t) => `tier${t}:${out.filter((p) => p.tier === t).length}`).join(" "));

  fs.rmSync(TMP_DIR, { recursive: true, force: true });
})().catch((e) => { console.error(e); process.exit(1); });
