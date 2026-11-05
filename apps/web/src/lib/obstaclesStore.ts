import { type Obstacles } from "@wotrep/analysis";
import { openDb } from "./mapStore";

/** Map obstacles stay on the user's device (IndexedDB), like map images and heights (ADR-0003):
 *  extracted from their own game files, never uploaded or committed. The stored value is the
 *  validated obstacles object (parseObstacles runs on save). Load returns it after a shape
 *  check — it must NOT re-run parseObstacles, which validates the extractor's file format
 *  (manifest required) and would reject the stored parsed object, so nothing would ever load. */
export interface StoredObstacles { name: string; data: Obstacles }

/** The stored shape is the parsed Obstacles object: a map name plus the four arrays.
 *  (The extractor's file JSON has no top-level `map` — it lives under `manifest` — so the
 *  two shapes are distinguishable.) */
export function isObstacles(value: unknown): value is Obstacles {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v["map"] === "string" && Array.isArray(v["models"]) && Array.isArray(v["placements"]) && Array.isArray(v["trees"]) && Array.isArray(v["water"]);
}

export async function loadObstacles(name: string): Promise<Obstacles | null> {
  try {
    const db = await openDb();
    const stored = await new Promise<StoredObstacles | undefined>((res) => { const q = db.transaction("obstacles").objectStore("obstacles").get(name); q.onsuccess = () => res((q.result as StoredObstacles | undefined) ?? undefined); q.onerror = () => res(undefined); });
    if (!stored || !isObstacles(stored.data)) return null;
    return stored.data;
  } catch { return null; }
}
export async function saveObstacles(m: StoredObstacles): Promise<boolean> {
  try { const db = await openDb(); return await new Promise((res) => { const q = db.transaction("obstacles", "readwrite").objectStore("obstacles").put(m); q.onsuccess = () => res(true); q.onerror = () => res(false); }); } catch { return false; }
}
export async function deleteObstacles(name: string): Promise<boolean> {
  try { const db = await openDb(); return await new Promise((res) => { const q = db.transaction("obstacles", "readwrite").objectStore("obstacles").delete(name); q.onsuccess = () => res(true); q.onerror = () => res(false); }); } catch { return false; }
}
