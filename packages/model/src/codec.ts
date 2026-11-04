import type { BattleResults, BattleTimeline, PlayerResult } from "./timeline";

/** Compact binary serialisation for BattleTimeline (E2-05).
 *
 *  Format `WTC1`: magic + version, then sections in fixed order (source, arena, recorder,
 *  vehicles, tracks, events, camera, aim?, results?, diagnostics). Integers are LEB128 varints
 *  (unsigned, or zigzag for signed/delta values); strings are length-prefixed UTF-8; rare
 *  genuinely fractional numbers (battleStartClock, capture points, personal values, results
 *  numbers) are f64, exactly round-tripped.
 *
 *  Quantisation (the lossy part; everything else is exact):
 *  - times (track t, event t, camera t, visible intervals): 0.01 s — error ≤ 0.01 s
 *  - track positions (x, y, z) and projectileEnd coordinates: 0.1 m — error ≤ 0.1 m
 *  - track yaw / gunYaw: 0.01 rad — error ≤ 0.01 rad
 *  Track and camera/event time series are delta-coded, so the fixture timeline (1.8 MB as JSON)
 *  encodes to 281 KB and decodes in ~9 ms. Decode does NOT run zod validation (that would
 *  dominate the budget on 250k track samples); callers that need a validity proof run
 *  `validateTimeline` on the result separately.
 */
export const CODEC_MAGIC = "WTC1";
export const CODEC_VERSION = 1;
export const CODEC_QUANT = { time: 0.01, position: 0.1, yaw: 0.01 } as const;

export class CodecError extends Error {}

/* ---------------- writer ---------------- */

class Writer {
  out: number[] = [];
  uvarint(n: number): void {
    if (!Number.isInteger(n) || n < 0) throw new CodecError(`uvarint needs a non-negative integer, got ${n}`);
    let v = n;
    do { const b = v % 128; v = Math.floor(v / 128); this.out.push(v > 0 ? b + 128 : b); } while (v > 0);
  }
  svarint(n: number): void {
    if (!Number.isInteger(n)) throw new CodecError(`svarint needs an integer, got ${n}`);
    this.uvarint(n >= 0 ? 2 * n : -2 * n - 1);
  }
  f64(v: number): void {
    const b = new ArrayBuffer(8);
    new DataView(b).setFloat64(0, v, true);
    for (const x of new Uint8Array(b)) this.out.push(x);
  }
  f32(v: number): void {
    const b = new ArrayBuffer(4);
    new DataView(b).setFloat32(0, v, true);
    for (const x of new Uint8Array(b)) this.out.push(x);
  }
  byte(v: number): void { this.out.push(v ? 1 : 0); }
  /** Raw byte (0–255); unlike byte() this is not a boolean. */
  raw(v: number): void {
    if (!Number.isInteger(v) || v < 0 || v > 255) throw new CodecError(`raw byte out of range: ${v}`);
    this.out.push(v);
  }
  str(s: string): void {
    const b = new TextEncoder().encode(s);
    this.uvarint(b.length);
    for (const x of b) this.out.push(x);
  }
  bytes(): Uint8Array { return Uint8Array.from(this.out); }
}

/* ---------------- reader ---------------- */

class Reader {
  pos = 0;
  constructor(private b: Uint8Array) {}
  private need(n: number): void { if (this.pos + n > this.b.length) throw new CodecError("truncated input"); }
  uvarint(): number {
    let v = 0, shift = 0;
    for (let i = 0; i < 10; i++) {
      this.need(1);
      const byte = this.b[this.pos++]!;
      v += (byte % 128) * 2 ** shift;
      if (byte < 128) return v;
      shift += 7;
    }
    throw new CodecError("varint too long");
  }
  svarint(): number {
    const u = this.uvarint();
    return u % 2 === 0 ? u / 2 : -(u + 1) / 2;
  }
  f64(): number { this.need(8); const v = new DataView(this.b.buffer, this.b.byteOffset + this.pos, 8).getFloat64(0, true); this.pos += 8; return v; }
  f32(): number { this.need(4); const v = new DataView(this.b.buffer, this.b.byteOffset + this.pos, 4).getFloat32(0, true); this.pos += 4; return v; }
  byte(): number { this.need(1); return this.b[this.pos++]!; }
  bool(): boolean { return this.byte() !== 0; }
  /** Delta-coded quantised series: first value absolute, rest deltas; inlined varint loop
   *  because tracks carry ~250k values and this is the decode hot path. */
  series(scale: number): number[] {
    const n = this.uvarint();
    const out = new Array<number>(n);
    const b = this.b;
    let prev = 0;
    for (let i = 0; i < n; i++) {
      let v = 0, shift = 0;
      for (;;) {
        if (this.pos >= b.length) throw new CodecError("truncated input");
        const byte = b[this.pos++]!;
        v += (byte % 128) * 2 ** shift;
        if (byte < 128) break;
        shift += 7;
      }
      const sv = v % 2 === 0 ? v / 2 : -(v + 1) / 2;
      const cur = i === 0 ? sv : prev + sv;
      out[i] = cur / scale;
      prev = cur;
    }
    return out;
  }
  str(): string {
    const len = this.uvarint();
    this.need(len);
    const s = new TextDecoder().decode(this.b.subarray(this.pos, this.pos + len));
    this.pos += len;
    return s;
  }
  done(): void { if (this.pos !== this.b.length) throw new CodecError(`trailing bytes: ${this.b.length - this.pos}`); }
}

/* ---------------- shared helpers ---------------- */

const qt = (v: number) => Math.round(v * 100); // time, 0.01 s
const qp = (v: number) => Math.round(v * 10); // position, 0.1 m
const qy = (v: number) => Math.round(v * 100); // yaw, 0.01 rad

function writeSeries(w: Writer, vals: number[], q: (v: number) => number): void {
  w.uvarint(vals.length);
  let prev = 0;
  for (let i = 0; i < vals.length; i++) {
    const cur = q(vals[i]!);
    w.svarint(i === 0 ? cur : cur - prev);
    prev = cur;
  }
}
/** Event kind tags, fixed order. */
const KIND = ["period", "spotted", "unspotted", "shot", "projectileEnd", "damage", "kill", "chat", "baseCapture", "personal"] as const;
type Kind = (typeof KIND)[number];

/* ---------------- encode ---------------- */

export function encodeTimeline(tl: BattleTimeline): Uint8Array {
  const w = new Writer();
  for (const c of CODEC_MAGIC) w.out.push(c.charCodeAt(0));
  w.raw(CODEC_VERSION);
  w.str(tl.schema);
  const s = tl.source;
  w.str(s.realm); w.str(s.regionCode); w.str(s.server); w.str(s.clientVersion);
  w.str(s.manifest.id); w.str(s.manifest.confidence);
  w.byte(s.fileName !== undefined ? 1 : 0); if (s.fileName !== undefined) w.str(s.fileName);
  w.byte(s.hasMods ? 1 : 0); w.str(s.sha256);
  const a = tl.arena;
  w.str(a.arenaUniqueId); w.str(a.map); w.str(a.mapDisplayName); w.str(a.gameplay);
  w.svarint(a.battleType); w.str(a.startedAt);
  w.byte(a.durationS !== null ? 1 : 0); if (a.durationS !== null) w.f64(a.durationS);
  w.byte(a.winnerTeam !== null ? 1 : 0); if (a.winnerTeam !== null) w.svarint(a.winnerTeam);
  w.byte(a.finishReason !== null ? 1 : 0); if (a.finishReason !== null) w.svarint(a.finishReason);
  w.f64(a.battleStartClock);
  w.uvarint(tl.recorder.vid); w.uvarint(tl.recorder.team); w.str(tl.recorder.name);
  w.uvarint(tl.vehicles.length);
  for (const v of tl.vehicles) {
    w.uvarint(v.vid); w.uvarint(v.team); w.str(v.name); w.byte(v.anonymized ? 1 : 0);
    w.byte(v.clan !== undefined ? 1 : 0); if (v.clan !== undefined) w.str(v.clan);
    w.byte(v.accountId !== undefined ? 1 : 0); if (v.accountId !== undefined) w.uvarint(v.accountId);
    w.str(v.vehicleType); w.uvarint(v.maxHealth); w.byte(v.isRecorder ? 1 : 0);
    w.byte(v.platoon !== undefined ? 1 : 0); if (v.platoon !== undefined) w.svarint(v.platoon);
  }
  const vids = Object.keys(tl.tracks).map(Number).sort((x, y) => x - y);
  w.uvarint(vids.length);
  for (const vid of vids) {
    const tr = tl.tracks[vid]!;
    w.uvarint(vid);
    writeSeries(w, tr.t, qt); writeSeries(w, tr.x, qp); writeSeries(w, tr.z, qp); writeSeries(w, tr.y, qp); writeSeries(w, tr.yaw, qy);
    w.byte(tr.gunYaw !== undefined ? 1 : 0); if (tr.gunYaw !== undefined) writeSeries(w, tr.gunYaw, qy);
    w.uvarint(tr.visible.length);
    for (const [from, to] of tr.visible) { w.svarint(qt(from)); w.svarint(qt(to)); }
  }
  w.uvarint(tl.events.length);
  let prevTq = 0;
  for (const e of tl.events) {
    const tq = qt(e.t);
    w.raw(KIND.indexOf(e.k as Kind));
    w.svarint(tq - prevTq);
    prevTq = tq;
    switch (e.k) {
      case "period": w.svarint(e.period); w.f64(e.lengthS); break;
      case "spotted": case "unspotted": w.uvarint(e.vid); break;
      case "shot":
        w.uvarint(e.shooter);
        w.byte(e.shotId !== undefined ? 1 : 0); if (e.shotId !== undefined) w.uvarint(e.shotId);
        break;
      case "projectileEnd": w.uvarint(e.shotId); w.svarint(qp(e.x)); w.svarint(qp(e.y)); w.svarint(qp(e.z)); break;
      case "damage": w.uvarint(e.target); w.uvarint(e.attacker); w.uvarint(e.amount); w.uvarint(e.hpBefore); w.uvarint(e.hpAfter); w.uvarint(e.reason); break;
      case "kill": w.uvarint(e.victim); w.uvarint(e.killer); w.uvarint(e.reason); w.uvarint(e.equipment); break;
      case "chat":
        w.str(e.team);
        w.byte(e.sender !== undefined ? 1 : 0); if (e.sender !== undefined) w.str(e.sender);
        w.str(e.text);
        break;
      case "baseCapture":
        w.uvarint(e.team); w.f64(e.points);
        w.uvarint(e.capturers.length); for (const c of e.capturers) w.uvarint(c);
        break;
      case "personal":
        w.str(e.type);
        w.byte(e.target !== undefined ? 1 : 0); if (e.target !== undefined) w.uvarint(e.target);
        w.byte(e.value !== undefined ? 1 : 0); if (e.value !== undefined) w.f64(e.value);
        break;
    }
  }
  writeSeries(w, tl.camera.t, qt);
  w.uvarint(tl.camera.mode.length); for (const m of tl.camera.mode) w.str(m);
  w.byte(tl.aim !== undefined ? 1 : 0);
  if (tl.aim !== undefined) {
    writeSeries(w, tl.aim.t, qt);
    w.uvarint(tl.aim.pos.length); for (const v of tl.aim.pos) w.f32(v);
    w.uvarint(tl.aim.dir.length); for (const v of tl.aim.dir) w.f32(v);
  }
  w.byte(tl.results !== undefined ? 1 : 0);
  if (tl.results !== undefined) {
    const pids = Object.keys(tl.results.players).map(Number).sort((x, y) => x - y);
    w.uvarint(pids.length);
    for (const pid of pids) {
      const p = tl.results.players[pid]!;
      w.uvarint(pid);
      for (const v of [p.damageDealt, p.assistRadio, p.assistTrack, p.assistStun, p.blocked, p.kills, p.spotted, p.shots, p.hits, p.pens, p.damageReceived, p.lifeTimeS, p.deathReason, p.mileageM, p.xp, p.capturePoints, p.droppedCapturePoints]) w.f64(v);
      w.byte(p.killerVid !== null ? 1 : 0); if (p.killerVid !== null) w.uvarint(p.killerVid);
    }
    const personal = tl.results.personal as Record<string, number> | undefined;
    w.byte(personal !== undefined ? 1 : 0);
    if (personal !== undefined) {
      const keys = Object.keys(personal);
      w.uvarint(keys.length);
      for (const k of keys) { w.str(k); w.f64(personal[k]!); }
    }
  }
  const unknown = Object.entries(tl.diagnostics.unknownPacketTypes);
  w.uvarint(unknown.length);
  for (const [k, v] of unknown) { w.str(k); w.uvarint(v); }
  w.uvarint(tl.diagnostics.warnings.length);
  for (const warn of tl.diagnostics.warnings) w.str(warn);
  return w.bytes();
}

/* ---------------- decode ---------------- */

export function decodeTimeline(bytes: Uint8Array): BattleTimeline {
  const r = new Reader(bytes);
  for (const c of CODEC_MAGIC) if (r.byte() !== c.charCodeAt(0)) throw new CodecError("bad magic");
  if (r.byte() !== CODEC_VERSION) throw new CodecError(`unsupported codec version (want ${CODEC_VERSION})`);
  const schema = r.str();
  if (schema !== "wotrep.timeline/1") throw new CodecError(`unsupported timeline schema ${schema}`);
  const realm = r.str();
  if (realm !== "wg" && realm !== "lesta") throw new CodecError(`bad realm ${realm}`);
  const regionCode = r.str(), server = r.str(), clientVersion = r.str();
  const manifestId = r.str(), confidence = r.str();
  if (confidence !== "defs" && confidence !== "fingerprint" && confidence !== "none") throw new CodecError(`bad manifest confidence ${confidence}`);
  const fileName = r.bool() ? r.str() : undefined;
  const hasMods = r.bool(), sha256 = r.str();
  const arenaUniqueId = r.str(), map = r.str(), mapDisplayName = r.str(), gameplay = r.str();
  const battleType = r.svarint(), startedAt = r.str();
  const durationS = r.bool() ? r.f64() : null;
  const winnerTeam = r.bool() ? r.svarint() : null;
  const finishReason = r.bool() ? r.svarint() : null;
  const battleStartClock = r.f64();
  const recorder = { vid: r.uvarint(), team: r.uvarint() as 1 | 2, name: r.str() };
  const vehicles: BattleTimeline["vehicles"] = [];
  const nVeh = r.uvarint();
  for (let i = 0; i < nVeh; i++) {
    const vid = r.uvarint(), team = r.uvarint() as 1 | 2, name = r.str(), anonymized = r.bool();
    const clan = r.bool() ? r.str() : undefined;
    const accountId = r.bool() ? r.uvarint() : undefined;
    const vehicleType = r.str(), maxHealth = r.uvarint(), isRecorder = r.bool();
    const platoon = r.bool() ? r.svarint() : undefined;
    vehicles.push({ vid, team, name, anonymized, ...(clan !== undefined ? { clan } : {}), ...(accountId !== undefined ? { accountId } : {}), vehicleType, maxHealth, isRecorder, ...(platoon !== undefined ? { platoon } : {}) });
  }
  const tracks: BattleTimeline["tracks"] = {};
  const nTracks = r.uvarint();
  for (let i = 0; i < nTracks; i++) {
    const vid = r.uvarint();
    const t = r.series(100), x = r.series(10), z = r.series(10), y = r.series(10), yaw = r.series(100);
    const gunYaw = r.bool() ? r.series(100) : undefined;
    const visible: [number, number][] = [];
    const nVis = r.uvarint();
    for (let j = 0; j < nVis; j++) visible.push([r.svarint() / 100, r.svarint() / 100]);
    tracks[vid] = { t, x, z, y, yaw, ...(gunYaw !== undefined ? { gunYaw } : {}), visible };
  }
  const events: BattleTimeline["events"] = [];
  const nEvents = r.uvarint();
  let prevTq = 0;
  for (let i = 0; i < nEvents; i++) {
    const kindByte = r.byte();
    if (kindByte >= KIND.length) throw new CodecError(`bad event kind ${kindByte}`);
    const kind = KIND[kindByte]!;
    prevTq += r.svarint();
    const t = prevTq / 100;
    switch (kind) {
      case "period": events.push({ k: kind, t, period: r.svarint(), lengthS: r.f64() }); break;
      case "spotted": case "unspotted": events.push({ k: kind, t, vid: r.uvarint() }); break;
      case "shot": {
        const shooter = r.uvarint();
        const shotId = r.bool() ? r.uvarint() : undefined;
        events.push({ k: kind, t, shooter, ...(shotId !== undefined ? { shotId } : {}) });
        break;
      }
      case "projectileEnd": events.push({ k: kind, t, shotId: r.uvarint(), x: r.svarint() / 10, y: r.svarint() / 10, z: r.svarint() / 10 }); break;
      case "damage": events.push({ k: kind, t, target: r.uvarint(), attacker: r.uvarint(), amount: r.uvarint(), hpBefore: r.uvarint(), hpAfter: r.uvarint(), reason: r.uvarint() }); break;
      case "kill": events.push({ k: kind, t, victim: r.uvarint(), killer: r.uvarint(), reason: r.uvarint(), equipment: r.uvarint() }); break;
      case "chat": {
        const team = r.str();
        if (team !== "ally" && team !== "enemy" && team !== "all") throw new CodecError(`bad chat team ${team}`);
        const sender = r.bool() ? r.str() : undefined;
        const text = r.str();
        events.push({ k: kind, t, team, ...(sender !== undefined ? { sender } : {}), text });
        break;
      }
      case "baseCapture": {
        const team = r.uvarint() as 1 | 2, points = r.f64();
        const capturers: number[] = [];
        const nCap = r.uvarint();
        for (let j = 0; j < nCap; j++) capturers.push(r.uvarint());
        events.push({ k: kind, t, team, points, capturers });
        break;
      }
      case "personal": {
        const type = r.str();
        const target = r.bool() ? r.uvarint() : undefined;
        const value = r.bool() ? r.f64() : undefined;
        events.push({ k: kind, t, type, ...(target !== undefined ? { target } : {}), ...(value !== undefined ? { value } : {}) });
        break;
      }
    }
  }
  const camera = { t: r.series(100), mode: [] as string[] };
  const nModes = r.uvarint();
  for (let i = 0; i < nModes; i++) camera.mode.push(r.str());
  const aim = r.bool() ? (() => {
    const t = r.series(100);
    const pos: number[] = [], dir: number[] = [];
    const nPos = r.uvarint();
    for (let i = 0; i < nPos; i++) pos.push(r.f32());
    const nDir = r.uvarint();
    for (let i = 0; i < nDir; i++) dir.push(r.f32());
    return { t, pos, dir };
  })() : undefined;
  const results = r.bool() ? (() => {
    const players: Record<number, PlayerResult> = {};
    const nPlayers = r.uvarint();
    for (let i = 0; i < nPlayers; i++) {
      const pid = r.uvarint();
      const n: number[] = [];
      for (let j = 0; j < 17; j++) n.push(r.f64());
      const killerVid = r.bool() ? r.uvarint() : null;
      players[pid] = {
        damageDealt: n[0]!, assistRadio: n[1]!, assistTrack: n[2]!, assistStun: n[3]!, blocked: n[4]!,
        kills: n[5]!, spotted: n[6]!, shots: n[7]!, hits: n[8]!, pens: n[9]!, damageReceived: n[10]!,
        lifeTimeS: n[11]!, deathReason: n[12]!, killerVid, mileageM: n[13]!, xp: n[14]!,
        capturePoints: n[15]!, droppedCapturePoints: n[16]!,
      };
    }
    const personal = r.bool() ? (() => {
      const rec: Record<string, number> = {};
      const n = r.uvarint();
      for (let i = 0; i < n; i++) rec[r.str()] = r.f64();
      return rec as BattleResults["personal"];
    })() : undefined;
    return { players, ...(personal !== undefined ? { personal } : {}) };
  })() : undefined;
  const unknownPacketTypes: Record<string, number> = {};
  const nUnknown = r.uvarint();
  for (let i = 0; i < nUnknown; i++) unknownPacketTypes[r.str()] = r.uvarint();
  const warnings: string[] = [];
  const nWarnings = r.uvarint();
  for (let i = 0; i < nWarnings; i++) warnings.push(r.str());
  r.done();
  return {
    schema: "wotrep.timeline/1",
    source: { realm, regionCode, server, clientVersion, manifest: { id: manifestId, confidence }, ...(fileName !== undefined ? { fileName } : {}), hasMods, sha256 },
    arena: { arenaUniqueId, map, mapDisplayName, gameplay, battleType, startedAt, durationS, winnerTeam: winnerTeam as 0 | 1 | 2 | null, finishReason, battleStartClock },
    recorder,
    vehicles,
    tracks,
    events,
    camera,
    ...(aim !== undefined ? { aim } : {}),
    ...(results !== undefined ? { results } : {}),
    diagnostics: { unknownPacketTypes, warnings },
  };
}
