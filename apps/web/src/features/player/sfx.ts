/** Synthesised shot sounds (no audio files). Browsers only start audio after a user gesture, so the context is
 *  created when the player turns sound on. */
export type ShotKind = "own" | "ally" | "enemy";

let ctx: AudioContext | null = null, noise: AudioBuffer | null = null;

export function sfxStart() {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new AC();
    noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.4), ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
  }
  if (ctx.state === "suspended") void ctx.resume();
}

/** Gun report: a short noise burst through a low-pass filter. Own shots are louder and lower; enemy shots quieter. */
export function sfxShot(kind: ShotKind) {
  if (!ctx || !noise) return;
  const gain = kind === "own" ? 0.5 : kind === "ally" ? 0.25 : 0.18, cut = kind === "own" ? 900 : kind === "ally" ? 1400 : 1000;
  const src = ctx.createBufferSource(); src.buffer = noise;
  const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = cut;
  const g = ctx.createGain(); g.gain.value = gain;
  src.connect(lp).connect(g).connect(ctx.destination);
  src.start();
}
