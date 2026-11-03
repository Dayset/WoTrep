/** Map images stay on the user's device (IndexedDB). They are the game's assets, so they are never uploaded or committed. */
export interface MapBounds { x0: number; x1: number; z0: number; z1: number }
export interface StoredMap { name: string; image: Blob; bounds: MapBounds }

const open = () => new Promise<IDBDatabase>((res, rej) => { const r = indexedDB.open("wotrep", 1); r.onupgradeneeded = () => r.result.createObjectStore("maps", { keyPath: "name" }); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
export async function loadMap(name: string): Promise<StoredMap | null> {
  try { const db = await open(); return await new Promise((res) => { const q = db.transaction("maps").objectStore("maps").get(name); q.onsuccess = () => res((q.result as StoredMap | undefined) ?? null); q.onerror = () => res(null); }); } catch { return null; }
}
export async function saveMap(m: StoredMap): Promise<boolean> {
  try { const db = await open(); return await new Promise((res) => { const q = db.transaction("maps", "readwrite").objectStore("maps").put(m); q.onsuccess = () => res(true); q.onerror = () => res(false); }); } catch { return false; }
}

/** Reads the playable-area box from an arena definition XML: <boundingBox><bottomLeft>x z</bottomLeft><upperRight>x z</upperRight></boundingBox>. */
export function parseBounds(xml: string): MapBounds | null {
  const num = (tag: string) => { const m = new RegExp(`<${tag}>\\s*(-?[\\d.]+)\\s+(-?[\\d.]+)\\s*</${tag}>`).exec(xml); return m ? [Number(m[1]), Number(m[2])] as const : null; };
  const a = num("bottomLeft"), b = num("upperRight");
  return a && b && b[0] > a[0] && b[1] > a[1] ? { x0: a[0], z0: a[1], x1: b[0], z1: b[1] } : null;
}
