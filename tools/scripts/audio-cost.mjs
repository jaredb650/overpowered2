// What each piece of the audio graph costs on the render thread, measured with no game around it.
//
//   node tools/shot.mjs --url "/?sandbox=audio&mode=idle" --script tools/scripts/audio-cost.mjs --wait 500 --timeout 170
//
// Each row builds the voice chain and master bus in an OfflineAudioContext and times 10 s of audio, keeping the
// fastest of three runs, because this machine is shared and only the minimum is free of other people's work.
// `load` is the share of real time one render thread would spend: above 1.0 audio cannot keep up at all.
//
// Offline rendering runs the convolver's long tail on the render thread, where a live context hands it to a
// background thread, so the rows with reverb overstate what the live thread pays. Compare them with each other.
function bench(cases) {
  const SECONDS = 10;
  const RATE = 44100;
  const noise = (ctx, channels) => {
    const b = ctx.createBuffer(channels, RATE, RATE);
    for (let c = 0; c < channels; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    return b;
  };
  const impulse = (ctx, seconds) => {
    const b = ctx.createBuffer(2, Math.floor(seconds * RATE), RATE);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp((-6.9 * i) / d.length);
    }
    return b;
  };

  async function run(cfg) {
    const ctx = new OfflineAudioContext(2, SECONDS * RATE, RATE);
    const sfx = ctx.createGain();
    const reverbIn = ctx.createGain();
    const master = ctx.createGain();
    sfx.connect(master);
    if (cfg.ir > 0) {
      const conv = ctx.createConvolver();
      conv.normalize = false;
      conv.buffer = impulse(ctx, cfg.ir);
      reverbIn.connect(conv);
      conv.connect(master);
    }
    let tail = master;
    if (cfg.limiter !== false) {
      const limiter = ctx.createDynamicsCompressor();
      tail.connect(limiter);
      tail = limiter;
    }
    if (cfg.oversample) {
      const shaper = ctx.createWaveShaper();
      const curve = new Float32Array(4097);
      for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh((i / 4096) * 2 - 1);
      shaper.curve = curve;
      shaper.oversample = cfg.oversample;
      tail.connect(shaper);
      tail = shaper;
    }
    tail.connect(ctx.destination);

    const mono = noise(ctx, 1);
    const stereo = noise(ctx, 2);
    const l = ctx.listener;
    const listenerParams = [l.positionX, l.positionY, l.positionZ, l.forwardX, l.forwardY, l.forwardZ, l.upX, l.upY, l.upZ];
    if (cfg.krate) for (const p of listenerParams) p.automationRate = 'k-rate';

    const frames = cfg.frameEvents ? Math.floor(SECONDS * 60) : 0;
    for (let f = 0; f < frames; f++) {
      const t = f / 60;
      listenerParams.forEach((p, i) => p.setValueAtTime(i < 3 ? Math.sin(t + i) * 5 : i === 5 ? -1 : i === 7 ? 1 : 0, t));
    }

    const total = cfg.pool ?? cfg.active;
    for (let i = 0; i < total; i++) {
      const active = i < cfg.active;
      const level = ctx.createGain();
      const send = ctx.createGain();
      level.gain.value = 0.02;
      send.gain.value = 0.1;
      level.connect(send);
      send.connect(reverbIn);
      let input = level;
      let air = null;
      let dist = null;
      let panner = null;
      if (cfg.spatial !== false) {
        if (cfg.biquad !== false) {
          air = ctx.createBiquadFilter();
          air.type = 'lowpass';
          air.frequency.value = 8000;
          air.Q.value = 0.5;
          air.connect(level);
          input = air;
        }
        dist = ctx.createGain();
        level.connect(dist);
        if (cfg.stereoPanner) {
          panner = ctx.createStereoPanner();
          panner.pan.value = Math.sin(i);
          dist.connect(panner);
          panner.connect(sfx);
        } else {
          panner = ctx.createPanner();
          panner.distanceModel = 'linear';
          panner.rolloffFactor = 0;
          panner.panningModel = i < (cfg.hrtf ?? 0) ? 'HRTF' : 'equalpower';
          panner.positionX.value = i - total / 2;
          panner.positionZ.value = -5;
          dist.connect(panner);
          panner.connect(sfx);
        }
      } else {
        level.connect(sfx);
      }
      if (cfg.krate) {
        for (const p of [send.gain, dist?.gain, air?.frequency, air?.Q, air?.detune, air?.gain, panner?.positionX, panner?.positionY, panner?.positionZ, panner?.orientationX, panner?.orientationY, panner?.orientationZ]) {
          if (p) p.automationRate = 'k-rate';
        }
      }
      if (active) {
        const source = ctx.createBufferSource();
        source.buffer = cfg.stereo ? stereo : mono;
        source.loop = true;
        source.playbackRate.value = 0.97 + (i % 7) * 0.01;
        source.connect(input);
        source.start();
        for (let f = 0; f < frames; f++) {
          const t = f / 60;
          if (panner?.positionX) {
            panner.positionX.setValueAtTime(Math.sin(t + i) * 10, t);
            panner.positionY.setValueAtTime(1, t);
            panner.positionZ.setValueAtTime(-5 + Math.cos(t + i), t);
          }
          if (cfg.distanceEvents !== false && dist) {
            air?.frequency.setTargetAtTime(6000 + 2000 * Math.sin(t), t, 0.03);
            dist.gain.setTargetAtTime(0.5 + 0.2 * Math.sin(t), t, 0.03);
            send.gain.setTargetAtTime(0.2, t, 0.03);
          }
        }
      }
    }
    const started = performance.now();
    await ctx.startRendering();
    return (performance.now() - started) / 1000 / SECONDS;
  }

  return (async () => {
    const rows = [];
    for (const [name, cfg] of Object.entries(cases)) {
      let best = Infinity;
      for (let i = 0; i < 3; i++) best = Math.min(best, await run(cfg));
      rows.push({ name, load: Number(best.toFixed(4)) });
      console.log(name, best.toFixed(4));
    }
    return rows;
  })();
}

const POOLS = { pool: 48, active: 48 };
const CASES = {
  'empty master, limiter only': { active: 0, ir: 0 },
  'master + 4x clipper': { active: 0, ir: 0, oversample: '4x' },
  'master + 2x clipper': { active: 0, ir: 0, oversample: '2x' },
  'master + clipper none': { active: 0, ir: 0, oversample: 'none' },
  'reverb 8 s': { active: 1, ir: 8 },
  'reverb 4 s': { active: 1, ir: 4 },
  'reverb 2 s': { active: 1, ir: 2 },
  'idle pool 48, nothing playing': { active: 0, pool: 48, ir: 0 },
  'idle pool 48, listener moving': { active: 0, pool: 48, ir: 0, frameEvents: true },
  '24 voices, still': { active: 24, ir: 0 },
  '48 voices, still': { active: 48, ir: 0 },
  '48 voices, moving, a-rate': { ...POOLS, ir: 0, frameEvents: true },
  '48 voices, moving, a-rate, stereo sources': { ...POOLS, ir: 0, frameEvents: true, stereo: true },
  '48 voices, moving, k-rate': { ...POOLS, ir: 0, frameEvents: true, krate: true },
  '48 voices, listener only moving, a-rate': { ...POOLS, ir: 0, frameEvents: true, distanceEvents: false },
  '48 voices, no biquad, k-rate': { ...POOLS, ir: 0, frameEvents: true, krate: true, biquad: false },
  '48 voices, StereoPanner, k-rate': { ...POOLS, ir: 0, frameEvents: true, krate: true, stereoPanner: true },
  '6 HRTF of 48, a-rate': { ...POOLS, ir: 0, frameEvents: true, hrtf: 6 },
  '6 HRTF of 48, k-rate': { ...POOLS, ir: 0, frameEvents: true, krate: true, hrtf: 6 },
  '2 HRTF of 24, k-rate': { active: 24, ir: 0, frameEvents: true, krate: true, hrtf: 2 },
  'old worst case': { ...POOLS, ir: 8, oversample: '4x', frameEvents: true, hrtf: 6, stereo: true },
  'current worst case': { active: 32, pool: 32, ir: 4, oversample: '4x', frameEvents: true, krate: true, hrtf: 3 },
};

export default async function cost(page, h) {
  for (let i = 0; i < 120; i++) {
    if (await page.evaluate(() => !!window.__audio)) break;
    await h.sleep(250);
  }
  const only = process.env.AC_ONLY?.split('|');
  const cases = only ? Object.fromEntries(Object.entries(CASES).filter(([name]) => only.some(o => name.includes(o)))) : CASES;
  return page.evaluate(bench, cases);
}
