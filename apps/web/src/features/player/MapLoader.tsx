import { useState } from "react";
import { parseBounds, saveMap, type MapBounds } from "../../lib/mapStore";
import { t } from "../../i18n";

/** "Bring your own map": the minimap image from the player's own game files plus the playable-area box (from the arena XML, or typed). Stored locally only. */
export function MapLoader({ mapName, onSaved, onClose }: { mapName: string; onSaved: () => void; onClose: () => void }) {
  const [img, setImg] = useState<File | null>(null), [b, setB] = useState<Record<keyof MapBounds, string>>({ x0: "", x1: "", z0: "", z1: "" }), [msg, setMsg] = useState("");
  const readXml = async (f: File) => { const p = parseBounds(await f.text()); if (p) { setB({ x0: String(p.x0), x1: String(p.x1), z0: String(p.z0), z1: String(p.z1) }); setMsg(t("map.parsed")); } else setMsg(t("map.noxml")); };
  const save = async () => {
    const n = { x0: Number(b.x0), x1: Number(b.x1), z0: Number(b.z0), z1: Number(b.z1) };
    if (!img || ![n.x0, n.x1, n.z0, n.z1].every(Number.isFinite) || n.x1 <= n.x0 || n.z1 <= n.z0 || b.x0 === "") { setMsg(t("map.invalid")); return; }
    if (await saveMap({ name: mapName, image: img, bounds: n })) { onSaved(); onClose(); } else setMsg(t("map.savefail"));
  };
  return (
    <div className="maploader" onPointerDown={(e) => e.stopPropagation()}>
      <b>{t("map.title", { name: mapName })}</b>
      <p className="muted">{t("map.help")}</p>
      <label>{t("map.image")} <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setImg(e.target.files?.[0] ?? null)} /></label>
      <label>{t("map.xml")} <input type="file" accept=".xml,text/xml" onChange={(e) => e.target.files?.[0] && void readXml(e.target.files[0])} /></label>
      <div className="mlgrid">{(["x0", "x1", "z0", "z1"] as const).map((k) => <label key={k}>{k} <input inputMode="decimal" value={b[k]} onChange={(e) => setB({ ...b, [k]: e.target.value })} /></label>)}</div>
      {msg && <p className="muted">{msg}</p>}
      <div className="factions"><button type="button" onClick={() => void save()}>{t("map.save")}</button><button type="button" onClick={onClose}>{t("map.cancel")}</button></div>
    </div>
  );
}
