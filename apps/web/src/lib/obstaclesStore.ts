import { parseObstacles, type Obstacles } from "@wotrep/analysis";
import { openDb } from "./mapStore";

/** Map obstacles stay on the user's device (IndexedDB), like map images and heights (ADR-0003):
 *  extracted from their own game files, never uploaded or committed. The stored value is the
 *  validated obstacles object (parseObstacles runs on save and again on load). */
export interface StoredObstacles { name: string; data: Obstacles }

export async function loadObstacles(name: string): Promise<Obstacles | null> {
  try {
    const db = await openDb();
    const stored = await new Promise<StoredObstacles | undefined>((res) => { const q = db.transaction("obstacles").objectStore("obstacles").get(name); q.onsuccess = () => res((q.result as StoredObstacles | undefined) ?? undefined); q.onerror = () => res(undefined); });
    if (!stored) return null;
    return parseObstacles(stored.data);
  } catch { return null; }
}
export async function saveObstacles(m: StoredObstacles): Promise<boolean> {
  try { const db = await openDb(); return await new Promise((res) => { const q = db.transaction("obstacles", "readwrite").objectStore("obstacles").put(m); q.onsuccess = () => res(true); q.onerror = () => res(false); }); } catch { return false; }
}
export async function deleteObstacles(name: string): Promise<boolean> {
  try { const db = await openDb(); return await new Promise((res) => { const q = db.transaction("obstacles", "readwrite").objectStore("obstacles").delete(name); q.onsuccess = () => res(true); q.onerror = () => res(false); }); } catch { return false; }
}
