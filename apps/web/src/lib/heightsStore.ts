import { unzipSync } from "fflate";
import type { RealHeights, RealHeightsChunk } from "@wotrep/analysis";
import { openDb } from "./mapStore";

/** Real map heights stay on the user's device (IndexedDB), like map images (ADR-0003): extracted from their own
 *  game files, never uploaded or committed. The stored file is the ZIP the extractor writes (manifest.json +
 *  float32 little-endian metre grids, one per chunk); it is parsed on load. */
export interface StoredHeights { name: string; file: Blob }

export async function loadHeights(name: string): Promise<RealHeights | null> {
  try {
    const db = await openDb();
    const stored = await new Promise<StoredHeights | undefined>((res) => { const q = db.transaction("heights").objectStore("heights").get(name); q.onsuccess = () => res((q.result as StoredHeights | undefined) ?? undefined); q.onerror = () => res(undefined); });
    if (!stored) return null;
    return parseHeightsZip(await stored.file.arrayBuffer(), name);
  } catch { return null; }
}
export async function saveHeights(m: StoredHeights): Promise<boolean> {
  try { const db = await openDb(); return await new Promise((res) => { const q = db.transaction("heights", "readwrite").objectStore("heights").put(m); q.onsuccess = () => res(true); q.onerror = () => res(false); }); } catch { return false; }
}
export async function deleteHeights(name: string): Promise<boolean> {
  try { const db = await openDb(); return await new Promise((res) => { const q = db.transaction("heights", "readwrite").objectStore("heights").delete(name); q.onsuccess = () => res(true); q.onerror = () => res(false); }); } catch { return false; }
}

interface ManifestChunk { loc_x: unknown; loc_y: unknown; file: unknown; w: unknown; h: unknown; min_m?: unknown; max_m?: unknown }

/** Reads a heights ZIP as produced by the extractor (see docs/FINDINGS.md, 2026-11-05). Throws on a bad file:
 *  not a ZIP, no manifest, heights for another map, or a missing/short chunk. */
export function parseHeightsZip(buf: ArrayBuffer, map: string): RealHeights {
  let files: Record<string, Uint8Array>;
  try { files = unzipSync(new Uint8Array(buf)); } catch { throw new Error("not a zip file"); }
  const raw = files["manifest.json"];
  if (!raw) throw new Error("no manifest.json in the zip");
  const m = JSON.parse(new TextDecoder().decode(raw)) as { map?: unknown; chunk_size?: unknown; chunks?: unknown };
  if (m.map !== map) throw new Error(`heights are for ${String(m.map ?? "?")}, not ${map}`);
  if (typeof m.chunk_size !== "number" || !Number.isFinite(m.chunk_size) || m.chunk_size <= 0 || !Array.isArray(m.chunks) || m.chunks.length === 0) throw new Error("bad manifest");
  const chunks = new Map<string, RealHeightsChunk>();
  let minM = Infinity, maxM = -Infinity;
  for (const c of m.chunks as ManifestChunk[]) {
    if (![c.loc_x, c.loc_y, c.w, c.h].every((v) => typeof v === "number" && Number.isFinite(v)) || typeof c.file !== "string") throw new Error("bad chunk entry in manifest");
    const bin = files[c.file];
    if (!bin || bin.byteLength !== (c.w as number) * (c.h as number) * 4) throw new Error(`missing or short chunk ${c.file}`);
    // Float32Array reads native-endian; the format is little-endian and every browser/Node target is LE.
    const data = new Float32Array(bin.buffer, bin.byteOffset, (c.w as number) * (c.h as number));
    const lo = typeof c.min_m === "number" ? c.min_m : Math.min(...data), hi = typeof c.max_m === "number" ? c.max_m : Math.max(...data);
    if (lo < minM) minM = lo; if (hi > maxM) maxM = hi;
    chunks.set(`${c.loc_x},${c.loc_y}`, { locX: c.loc_x as number, locY: c.loc_y as number, w: c.w as number, h: c.h as number, data });
  }
  return { chunkSize: m.chunk_size, chunks, minM, maxM };
}
