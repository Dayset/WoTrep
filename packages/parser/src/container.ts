import { unzlibSync } from "fflate";
import { Blowfish } from "./blowfish";
import { ParseError } from "./errors";

export const MAGIC = 0x11343212;
const KEY = Uint8Array.from("DE72BEA0DE04BEB1DEFEBEEFDEADBEEF".match(/../g)!.map((h) => parseInt(h, 16)));

export interface Container { blocks: unknown[]; packets: Uint8Array }

/** Read container → JSON blocks + decrypted, inflated packet stream (docs/REPLAY_FORMAT.md §1–2). */
export function readContainer(bytes: Uint8Array): Container {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const need = (off: number, n: number) => { if (off + n > bytes.byteLength) throw new ParseError("Truncated", "container", `need ${n} bytes at ${off}`); };
  need(0, 8);
  if (dv.getUint32(0, true) !== MAGIC) throw new ParseError("BadMagic", "container", "not a replay file");
  const count = dv.getUint32(4, true);
  if (count > 16) throw new ParseError("BadBlock", "container", `block count ${count}`);
  let off = 8; const blocks: unknown[] = [];
  for (let i = 0; i < count; i++) {
    need(off, 4); const len = dv.getUint32(off, true); off += 4; need(off, len);
    try { blocks.push(JSON.parse(new TextDecoder().decode(bytes.subarray(off, off + len)))); }
    catch { throw new ParseError("BadBlock", "container", `block ${i} is not JSON`); }
    off += len;
  }
  need(off, 8);
  const decSize = dv.getUint32(off, true), compSize = dv.getUint32(off + 4, true); off += 8;
  const n = (bytes.byteLength - off) & ~7;
  if (compSize > n + 8) throw new ParseError("Truncated", "decrypt", "encrypted stream shorter than header says");
  const plain = bytes.slice(off, off + n);
  try {
    const bf = new Blowfish(KEY); let prev = new Uint8Array(8);
    for (let i = 0; i < n; i += 8) {
      bf.decryptBlock(plain, i);
      if (i > 0) for (let j = 0; j < 8; j++) plain[i + j]! ^= prev[j]!;
      prev = plain.slice(i, i + 8);
    }
  } catch (e) { throw new ParseError("DecryptFailed", "decrypt", String(e)); }
  let packets: Uint8Array;
  try { packets = unzlibSync(plain.subarray(0, compSize), { out: new Uint8Array(decSize) }); }
  catch (e) { throw new ParseError("InflateFailed", "inflate", String(e)); }
  if (packets.byteLength !== decSize) throw new ParseError("InflateFailed", "inflate", `size ${packets.byteLength} != ${decSize}`);
  return { blocks, packets };
}
