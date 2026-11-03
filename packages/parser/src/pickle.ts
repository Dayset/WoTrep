// Whitelist pickle decoder (protocol 2). Never executes or instantiates anything: GLOBAL/REDUCE/BUILD produce tagged plain objects.
import { ParseError } from "./errors";

export interface Tagged { __global: string; args?: unknown; state?: unknown }
const MAX_ITEMS = 1_000_000;
const MARK = Symbol("mark");
type V = unknown;

export function unpickle(b: Uint8Array): V {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const dec = new TextDecoder("latin1");
  const stack: V[] = []; const memo = new Map<number, V>(); let p = 0, items = 0;
  const bad = (m: string): never => { throw new ParseError("BadBlock", "events", `pickle: ${m}`); };
  const need = (n: number) => { if (p + n > b.byteLength) bad("truncated"); };
  const popMark = (): V[] => { const i = stack.lastIndexOf(MARK as V); if (i < 0) bad("no mark"); const r = stack.splice(i); r.shift(); return r; };
  const top = () => { if (!stack.length) bad("empty stack"); return stack[stack.length - 1]; };
  const push = (v: V) => { if (++items > MAX_ITEMS) bad("too many items"); stack.push(v); };
  const line = () => { const s = p; while (p < b.byteLength && b[p] !== 10) p++; const r = dec.decode(b.subarray(s, p)); p++; return r; };
  for (;;) {
    need(1); const op = b[p++]!;
    switch (op) {
      case 0x80: need(1); if (b[p++] !== 2 && b[p - 1] !== 3) bad("protocol"); break; // PROTO
      case 0x2e: if (stack.length !== 1) bad("stack at STOP"); return stack[0]; // .
      case 0x4e: push(null); break; // N
      case 0x88: push(true); break; case 0x89: push(false); break;
      case 0x4b: need(1); push(b[p++]); break; // K
      case 0x4d: need(2); push(dv.getUint16(p, true)); p += 2; break; // M
      case 0x4a: need(4); push(dv.getInt32(p, true)); p += 4; break; // J
      case 0x47: need(8); push(dv.getFloat64(p, false)); p += 8; break; // G
      case 0x8a: { need(1); const n = b[p++]!; need(n); let v = 0n; for (let i = n - 1; i >= 0; i--) v = (v << 8n) | BigInt(b[p + i]!); if (n && b[p + n - 1]! & 0x80) v -= 1n << BigInt(8 * n); p += n; push(Number.isSafeInteger(Number(v)) ? Number(v) : v); break; } // LONG1
      case 0x55: { need(1); const n = b[p++]!; need(n); push(dec.decode(b.subarray(p, p + n))); p += n; break; } // U short binstring
      case 0x54: { need(4); const n = dv.getUint32(p, true); p += 4; need(n); push(dec.decode(b.subarray(p, p + n))); p += n; break; } // T
      case 0x58: { need(4); const n = dv.getUint32(p, true); p += 4; need(n); push(new TextDecoder().decode(b.subarray(p, p + n))); p += n; break; } // X unicode
      case 0x8c: { need(1); const n = b[p++]!; need(n); push(new TextDecoder().decode(b.subarray(p, p + n))); p += n; break; } // SHORT_BINUNICODE
      case 0x43: { need(1); const n = b[p++]!; need(n); push(b.slice(p, p + n)); p += n; break; } // SHORT_BINBYTES-ish (py3)
      case 0x28: push(MARK); break; // (
      case 0x29: push([]); break; // empty tuple )
      case 0x5d: push([]); break; // ]
      case 0x7d: push({}); break; // }
      case 0x74: push(popMark()); break; // t tuple
      case 0x85: { const a = [top()]; stack.pop(); push(a); break; } // TUPLE1
      case 0x86: { const y = stack.pop(), x = stack.pop(); push([x, y]); break; }
      case 0x87: { const z = stack.pop(), y = stack.pop(), x = stack.pop(); push([x, y, z]); break; }
      case 0x6c: push(popMark()); break; // l
      case 0x61: { const v = stack.pop(); const l = top(); if (!Array.isArray(l)) bad("APPEND"); (l as V[]).push(v); break; } // a
      case 0x65: { const vs = popMark(); const l = top(); if (!Array.isArray(l)) bad("APPENDS"); (l as V[]).push(...vs); break; } // e
      case 0x73: { const v = stack.pop(), k = stack.pop(); const d = top() as Record<string, V>; d[String(k)] = v; break; } // s
      case 0x75: { const kv = popMark(); const d = top() as Record<string, V>; for (let i = 0; i + 1 < kv.length; i += 2) d[String(kv[i])] = kv[i + 1]; break; } // u
      case 0x64: { const kv = popMark(); const d: Record<string, V> = {}; for (let i = 0; i + 1 < kv.length; i += 2) d[String(kv[i])] = kv[i + 1]; push(d); break; } // d
      case 0x71: need(1); memo.set(b[p++]!, top()); break; // q BINPUT
      case 0x72: need(4); memo.set(dv.getUint32(p, true), top()); p += 4; break; // r
      case 0x68: { need(1); const k = b[p++]!; if (!memo.has(k)) bad("memo"); push(memo.get(k)); break; } // h
      case 0x6a: { need(4); const k = dv.getUint32(p, true); p += 4; if (!memo.has(k)) bad("memo"); push(memo.get(k)); break; } // j
      case 0x63: { const m = line(), n = line(); push({ __global: `${m}.${n}` } as Tagged); break; } // c GLOBAL
      case 0x52: { const a = stack.pop(), g = stack.pop() as Tagged; if (!g || typeof g !== "object") bad("REDUCE"); push({ ...g, args: a }); break; } // R
      case 0x62: { const s = stack.pop(), o = top() as Tagged; if (o && typeof o === "object") o.state = s; break; } // b BUILD
      case 0x30: stack.pop(); break; // POP
      default: bad(`unknown opcode 0x${op.toString(16)} at ${p - 1}`);
    }
    if (stack.length > 100_000) bad("stack too deep");
  }
}

/** BigWorld string: u8 length, or 0xFF + u24 length. Returns [bytes, nextOffset]. */
export function readBwString(a: Uint8Array, off = 0): [Uint8Array, number] {
  if (off >= a.byteLength) throw new ParseError("Truncated", "events", "bw string");
  let n: number, s: number;
  if (a[off] === 0xff) { if (off + 4 > a.byteLength) throw new ParseError("Truncated", "events", "bw string"); n = a[off + 1]! | (a[off + 2]! << 8) | (a[off + 3]! << 16); s = off + 4; }
  else { n = a[off]!; s = off + 1; }
  if (s + n > a.byteLength) throw new ParseError("Truncated", "events", "bw string length");
  return [a.subarray(s, s + n), s + n];
}
