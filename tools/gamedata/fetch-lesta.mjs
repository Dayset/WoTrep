// Usage: LESTA_APP_ID=... node tools/gamedata/fetch-lesta.mjs   (free id: https://developers.lesta.ru/)
// Writes packages/gamedata/data/vehicles.lesta.json. The public "demo" id is blocked by the API (verified 2026-11-03).
import { writeFileSync, mkdirSync } from "node:fs";
const id = process.env.LESTA_APP_ID; if (!id) { console.error("LESTA_APP_ID is required"); process.exit(2); }
const host = process.env.API_HOST ?? "https://api.tanki.su", out = {};
for (let page = 1, total = 1; page <= total; page++) {
  const r = await fetch(`${host}/wot/encyclopedia/vehicles/?application_id=${id}&page_no=${page}&limit=100&fields=tag,name,short_name,tier,type,nation,default_profile`);
  const j = await r.json(); if (j.status !== "ok") { console.error("API error", JSON.stringify(j.error)); process.exit(1); }
  total = j.meta.page_total ?? 1; Object.assign(out, j.data); console.error(`page ${page}/${total}`);
}
mkdirSync("packages/gamedata/data", { recursive: true });
writeFileSync("packages/gamedata/data/vehicles.lesta.json", JSON.stringify({ source: `${host} encyclopedia/vehicles`, fetchedAt: new Date().toISOString(), vehicles: out }, null, 1) + "\n");
console.error(`wrote ${Object.keys(out).length} vehicles`);
