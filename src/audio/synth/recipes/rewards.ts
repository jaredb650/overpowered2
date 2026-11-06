import { perc, swell, type Synth } from '../dsl';
import { MODES, bell, blast, boom, brass, clank, click, hz, laser, modal, riser, steps, thump, whoosh, zap } from '../instruments';
import { r } from '../recipe';

/** A perk stinger: a hit, a chord and one signature element. Stereo, because stingers are played 2D. */
function stinger(id: string, dur: number, signature: (s: Synth) => void, chord: readonly number[], cutoff = 2800) {
  return r(id, { dur, mix: 'stinger', stereo: true, expect: { attackMs: [0, 30] } }, s => {
    boom(s, 0.5, 0.75);
    brass(s, chord, dur * 0.7, 1.1, cutoff);
    signature(s);
  });
}

/** A powerup grab: a bright arpeggio over a pad, with a colour of its own. */
function powerup(id: string, dur: number, notes: readonly number[], colour: (s: Synth) => void) {
  return r(id, { dur, mix: 'stinger', stereo: true, over: { volume: 0.55, duck: [0.25, 0.6] } }, s => {
    notes.forEach((n, i) => s.at(i * 0.06, () => bell(s, hz(n), 0.5, 0.42, i % 2 ? 0.25 : -0.25)));
    colour(s);
  });
}

export const perks = [
  // Warthog gets its own ready cue: the first game shared Airstrike's "for now".
  stinger('perk_warthog', 3.2, s => {
    s.at(0.1, () => s.osc('sawtooth', [[0, 88], [0.9, 118]], 2.4).lp(1500, 2).am(s.lfo(62, 0.6, 'square')).env(swell(0.1, 2.3, 1.2, 0.7)).out(0.65));
    whoosh(s, { from: 300, to: 2600, dur: 2.2, q: 1, level: 0.55, peakAt: 0.55 });
  }, [38, 45, 50]),
  stinger('perk_sentinels', 2.6, s => {
    [0, 0.13, 0.26].forEach((t, i) => s.at(t, () => {
      laser(s, 3000 - i * 400, 900, 0.3, 0.42);
      s.osc('sine', [[0, 300], [0.5, 900 + i * 300]], 1.2).env(perc(1, 0.28, 0.02)).out(1, [-0.6, 0, 0.6][i]);
    }));
  }, [50, 57, 62, 69], 3400),
  stinger('perk_chainStorm', 2.8, s => {
    zap(s, 1.2, 0.8, 110);
    s.at(0.25, () => zap(s, 0.8, 0.5, 170));
    s.at(0.5, () => zap(s, 0.5, 0.42, 90));
  }, [40, 47, 52, 58], 3800),
  stinger('perk_butcher', 2.4, s => {
    s.noise('white', 0.3).bp([[0, 1800], [0.2, 7000]], 3).env(perc(0.22, 0.9, 0.002)).out();
    modal(s, { f0: 1960, modes: MODES.bar, decay: 0.7, level: 0.42, strike: 0.5 });
    s.osc('sawtooth', 55, 1.2).drive(5, 'fold').lp(1800).env(perc(1, 0.34)).out();
  }, [36, 43, 44], 2000),
  stinger('perk_skyfall', 2.8, s => {
    s.noise('pink', 1.4).bp([[0, 4800], [1.3, 240]], 2).env(perc(1.3, 1, 0.02)).out(0.6);
    s.osc('sine', [[0, 2400], [1.3, 160]], 1.4).env(perc(1.2, 0.38, 0.01)).out();
  }, [43, 50, 55, 62], 3000),
  stinger('perk_chainReaction', 2.8, s => {
    [0, 0.14, 0.26, 0.36, 0.44].forEach((t, i) => s.at(t, () => {
      thump(s, 74 + i * 11, 0.16, 0.8, 2.4);
      s.noise('pink', 0.2).lp(2400).env(perc(0.14, 0.55)).drive(3).out(1, (i - 2) * 0.3);
    }));
  }, [45, 52, 57, 64], 3000),
  // The title perk: the loudest, widest stinger on the ladder.
  r('perk_overdrive', { dur: 4, mix: 'stinger', stereo: true, over: { volume: 0.8, duck: [0.5, 1.6] }, expect: { attackMs: [0, 45] } }, s => {
    boom(s, 0.9, 1);
    brass(s, [33, 40, 45, 52, 57], 3, 1.5, 3800);
    s.osc('sawtooth', [[0, 110], [2, 880]], 2.1).drive(3).lp([[0, 700], [2, 6400]], 3).env(swell(0.05, 2.1, 0.5, 0.42)).out();
    s.osc('sawtooth', [[0, 111], [2, 884]], 2.1, 11).lp([[0, 700], [2, 6400]], 3).env(swell(0.05, 2.1, 0.5, 0.3)).out(1, 0.5);
    s.at(1.95, () => { s.noise('white', 1.4).hp(2200).env(perc(1, 0.42)).out(); s.osc('sine', 880, 1.6).env(perc(1.3, 0.28)).out(); });
  }),
  r('perk_end', { dur: 0.7, mix: 'reward', over: { volume: 0.36 }, expect: { trend: -1 } }, s => {
    s.osc('sine', [[0, 880], [0.55, 330]], 0.6).env(perc(0.55, 0.6, 0.004)).out();
    s.osc('sawtooth', [[0, 440], [0.5, 165]], 0.55).lp(1500).env(perc(0.4, 0.2)).out();
  }),
];

export const callIns = [
  r('callin_ready', { dur: 1.2, mix: 'stinger', stereo: true, over: { volume: 0.6, duck: [0.2, 0.5] } }, s => {
    s.noise('white', 0.04).bp(2400, 1).env(perc(0.025, 0.6)).out();
    [76, 83, 88].forEach((n, i) => s.at(0.05 + i * 0.08, () => bell(s, hz(n), 0.7, 0.42, (i - 1) * 0.35)));
    s.at(0.05, () => thump(s, 60, 0.25, 0.7, 2));
  }),
  r('callin_target_loop', { dur: 1, mix: 'loop2d', loop: true, seam: 0.01, over: { volume: 0.26, send: 0, exempt: true } }, s => {
    [0.05, 0.55].forEach(t => s.at(t, () => s.osc('sine', 1760, 0.06).env(perc(0.05, 0.75, 0.002)).out()));
    s.osc('sine', 220).am(s.lfo(2, 0.3)).out(0.1);
  }),
  r('callin_confirm', { dur: 0.55, mix: 'reward', over: { volume: 0.5 } }, s => {
    s.noise('white', 0.03).bp(2200, 1).env(perc(0.02, 0.5)).out();
    s.osc('square', 880, 0.08).lp(3000).env(swell(0.002, 0.07, 0.02, 0.5)).out();
    s.at(0.09, () => s.osc('square', 1320, 0.2).lp(3000).env(swell(0.002, 0.18, 0.08, 0.5)).out());
  }),
  r('callin_cancel', { dur: 0.32, mix: 'reward', over: { volume: 0.4 } }, s => {
    s.osc('square', 660, 0.08).lp(2400).env(swell(0.002, 0.07, 0.02, 0.5)).out();
    s.at(0.09, () => s.osc('square', 440, 0.14).lp(2400).env(swell(0.002, 0.12, 0.05, 0.5)).out());
  }),
  r('callin_denied', { dur: 0.3, mix: 'reward', over: { volume: 0.4 } }, s => {
    s.osc('sawtooth', 165, 0.1).lp(1400).env(swell(0.002, 0.09, 0.02, 0.6)).out();
    s.at(0.13, () => s.osc('sawtooth', 165, 0.12).lp(1400).env(swell(0.002, 0.11, 0.03, 0.6)).out());
  }),
  r('missile_incoming', { dur: 1.6, n: 3, mix: 'blastSmall', over: { volume: 0.5, near: 12, far: 200, airDelay: false, send: 0.2, duck: undefined, maxVoices: 4 }, expect: { trend: -1 } }, s => {
    const f = s.r(1500, 2100);
    s.osc('sine', [[0, f], [1.5, f * 0.46]], 1.6).env([[0, 0.0001], [1.4, 0.3], [1.6, 0.0001]]).out();
    s.noise('pink', 1.6).bp([[0, f * 1.4], [1.5, 540]], 1.7).env([[0, 0.0001], [1.5, 1], [1.6, 0.0001]]).out();
  }),
  r('orbital_charge', { dur: 2.8, mix: 'stinger', stereo: true, over: { volume: 0.68, duck: [0.45, 2.5] }, expect: { trend: 1 } }, s => {
    riser(s, 2.7, 0.8, 120, 6000);
    s.osc('sine', [[0, 55], [2.7, 110]], 2.8).env(swell(0.3, 2.75, 0.1, 0.16)).out();
    s.grains(2.8, t => 5 + t * t * 28, 0.0012, t => 0.3 + t * 0.25).hp(3200).out(0.8, 0.3);
    bell(s, hz(84), 2.4, 0.13, -0.4);
  }),
  r('orbital_beam_loop', { dur: 2.4, mix: 'loop3d', loop: true, stereo: false, over: { volume: 0.85, priority: 9, maxVoices: 2, near: 36, far: 420, send: 0.34, exempt: true } }, s => {
    s.osc('sawtooth', 41.25).drive(3).hp(120).lp(1800, 2).am(s.lfo(7.5, 0.12)).out(0.6);
    s.osc('sawtooth', 61.67).hp(140).lp(2200, 3).out(0.34);
    s.osc('sine', 41.25).out(0.2);
    s.noise('pink').bp(1800, 0.7).sweep(s.wander(4, 700)).am(s.wander(18, 0.4)).out(1.1);
    s.noise('white').hp(5000).am(s.wander(30, 0.5)).out(0.1);
    s.grains(3, () => 200, 0.0012).bp(3400, 1.6).out(0.5);
  }),
  r('orbital_strike', { dur: 3.2, mix: 'blast', over: { volume: 1, near: 30, duck: [0.6, 1.5] }, expect: { attackMs: [0, 8], minSub: 0.1 } }, s => {
    blast(s, { size: 1.2, crackle: 0.7, tail: 0.7 });
    s.osc('sawtooth', [[0, 4600], [0.3, 90]], 0.34).drive(4, 'fold').env(perc(0.3, 0.75, 0.0004)).out();
    s.at(0.02, () => zap(s, 1.3, 0.34, 80));
  }),
  // Black Sun: sound falls into it. Every element sweeps down, and space pinches at the implode.
  r('blacksun_open', { dur: 2.8, mix: 'stinger', stereo: true, over: { volume: 0.8, duck: [0.7, 4], exempt: true }, expect: { trend: -1, minSub: 0.08 } }, s => {
    s.osc('sine', [[0, 140], [2.2, 24]], 2.6).env(swell(0.02, 2.6, 1.3, 1)).drive(2.6).out();
    s.noise('pink', 2.6).bp([[0, 7000], [2.4, 110]], 2.4).env(swell(0.02, 2.55, 1.2, 1)).out(1.2, [[0, -0.8], [2.4, 0.8]]);
    s.osc('sawtooth', [[0, 1800], [2.2, 55]], 2.4).lp([[0, 7000], [2.2, 300]], 3).env(perc(2.2, 0.28, 0.01)).out(1, [[0, 0.8], [2.2, -0.6]]);
  }),
  r('blacksun_loop', { dur: 3.2, mix: 'loop3d', loop: true, seam: 0.8, over: { volume: 0.9, priority: 9, maxVoices: 2, near: 28, far: 300, send: 0.34, exempt: true } }, s => {
    // A singularity felt in the sub and heard in the mids, where laptop speakers still work.
    s.osc('sine', 27.5).am(s.lfo(0.625, 0.32)).drive(2).out(0.5);
    s.osc('sawtooth', 41.25).hp(110).lp(900, 2).am(s.lfo(1.25, 0.3)).out(0.75);
    s.noise('pink').bp(420, 2).sweep(s.lfo(0.3125, 220)).am(s.wander(1.6, 0.4)).out(2.2);
    s.noise('pink').bp(1300, 3).sweep(s.lfo(0.3125, 600)).am(s.wander(2.2, 0.5)).out(0.8);
    s.noise('white').bp(5000, 9).sweep(s.lfo(0.3125, 2600)).out(0.14);
  }),
  r('blacksun_implode', { dur: 4.4, mix: 'blastHuge', over: { volume: 1, near: 50 }, expect: { minSub: 0.08 } }, s => {
    // The reverse swell into a dead-silent gap makes the detonation land twice as hard.
    s.osc('sawtooth', [[0, 40], [1.4, 1800]], 1.42).lp([[0, 300], [1.4, 9000]], 3).env([[0, 0.02], [1.38, 1], [1.42, 0.0001]]).out(0.55);
    s.noise('pink', 1.42).bp([[0, 200], [1.4, 8000]], 2).env([[0, 0.02], [1.38, 1], [1.42, 0.0001]]).out(0.9);
    s.at(1.56, () => blast(s, { size: 1.5, crack: 1.2, crackle: 0.8, tail: 0.9 }));
  }),
  r('nuke_siren', { dur: 4.4, mix: 'stinger', over: { volume: 0.7, duck: [0.75, 4.5], near: 400, far: 2000, send: 0.3, airDelay: false }, expect: { centroid: [250, 2500] } }, s => {
    const up: [number, number][] = [[0, 320], [1.1, 760], [2.2, 320], [3.3, 760], [4.3, 300]];
    s.osc('sawtooth', up, 4.35).lp(2100).env(swell(0.15, 4.35, 0.5, 0.42)).out();
    s.osc('sawtooth', up.map(([t, f]) => [t, f * 1.5] as const), 4.35, 7).lp(2100).env(swell(0.15, 4.35, 0.5, 0.2)).out();
  }),
  r('nuke_incoming', { dur: 3.2, mix: 'stinger', over: { volume: 0.72, duck: [0.75, 3.5], send: 0.2 }, expect: { trend: -1 } }, s => {
    s.osc('sine', [[0, 2400], [3, 340]], 3.1).env([[0, 0.0001], [2.9, 0.42], [3.1, 0.0001]]).out();
    s.noise('pink', 3.1).bp([[0, 3000], [3, 300]], 2).env([[0, 0.0001], [2.95, 1], [3.1, 0.0001]]).out();
  }),
  // Biggest sound in the game. The limiter is expected to work here.
  r('nuke_blast', { dur: 7.5, mix: 'blastHuge', stereo: true, rate: 44100, expect: { attackMs: [0, 8], minSub: 0.15 } }, s => {
    blast(s, { size: 3.2, crack: 1.3, crackle: 1, tail: 1, bright: 6000 });
    s.osc('sine', [[0, 90], [0.1, 40], [6, 18]], 7).env(perc(6, 1, 0.003)).drive(3).out();
    s.at(0.32, () => s.noise('pink', 5).lp([[0, 3000], [4.5, 200]]).am(s.wander(7, 0.5)).env(perc(4.5, 0.75, 0.04)).drive(3).out(0.75, [[0, -0.7], [4, 0.7]]));
  }),
  r('nuke_tail', { dur: 8.5, mix: 'ambience', stereo: true, rate: 24000, over: { volume: 0.8, priority: 8, exempt: true, fadeIn: 0 } }, s => {
    s.noise('brown', 8.4).lp([[0, 520], [8, 90]]).am(s.wander(1.1, 0.5)).env(perc(8, 1, 0.8)).gain(2).out(1, -0.3);
    s.noise('pink', 8.4).lp([[0, 1200], [8, 180]]).am(s.wander(0.8, 0.5)).env(perc(7, 0.42, 1)).gain(1.4).out(1, 0.3);
    s.grains(8, t => 16 * Math.exp(-t * 0.6) + 1, 0.004, t => 1 - t / 8.4).bp(1100, 1).out(0.7);
  }),
  r('siren_loop', { dur: 4, mix: 'loop3d', loop: true, seam: 0.5, over: { volume: 0.55, priority: 7, maxVoices: 2, near: 60, far: 600, send: 0.4 } }, s => {
    const up: [number, number][] = [[0, 340], [2, 760], [4, 340], [6, 760]];
    s.osc('sawtooth', up).lp(2200).out(0.4);
    s.osc('sawtooth', up.map(([t, f]) => [t, f * 1.5] as const), undefined, 7).lp(2200).out(0.2);
  }),

  r('lightning_arc', { dur: 0.45, n: 4, mix: 'impact', over: { volume: 0.55, family: 'arc', familyMax: 5, near: 8, far: 90, send: 0.2, priority: 6 }, expect: { attackMs: [0, 8], centroid: [800, 9000] } }, s => {
    zap(s, s.r(0.24, 0.38), 1, s.r(90, 170));
    s.noise('white', 0.03).hp(3000).env(perc(0.01, 0.9)).drive(3).out();
  }),
  r('lightning_strike', { dur: 1.6, n: 3, mix: 'blastSmall', over: { volume: 0.78 }, expect: { attackMs: [0, 6] } }, s => {
    s.noise('white', 0.05).hp(1800).env(perc(0.016, 1)).drive(8, 'hard').out(1.5);
    zap(s, 0.5, 0.75, 130);
    s.at(0.02, () => { s.noise('brown', 1.4).lp([[0, 1600], [1.2, 120]]).am(s.wander(13, 0.5)).env(perc(1.2, 1)).gain(2).out(0.5); });
    s.at(0.02, () => thump(s, 58, 0.5, 0.6, 2.4));
  }),
  r('electric_buzz_loop', { dur: 1, mix: 'loop3d', loop: true, over: { volume: 0.32, near: 4, far: 40 } }, s => {
    s.osc('sawtooth', 100).drive(4, 'fold').lp(5200).hp(160).am(s.wander(25, 0.4)).out(0.34);
    s.grains(1.4, () => 90, 0.001).hp(3000).out(0.42);
  }),
];

export const powerups = [
  powerup('powerup_quad', 1.5, [52, 59, 64, 71], s => {
    boom(s, 0.4, 0.7);
    brass(s, [40, 47, 52], 1, 1, 2600);
  }),
  powerup('powerup_haste', 1.1, [72, 76, 79, 84], s => whoosh(s, { from: 400, to: 5200, dur: 0.6, q: 1.2, peakAt: 0.7 })),
  powerup('powerup_vampire', 1.5, [57, 60, 63, 68], s => {
    s.osc('sawtooth', [[0, 220], [0.6, 110]], 1).lp(1100, 3).env(perc(0.9, 0.34, 0.03)).out();
    s.noise('white', 0.8).bp(3400, 6).env(perc(0.7, 0.28, 0.1)).out();
  }),
  powerup('powerup_ricochet', 1.2, [76, 79, 83], s => {
    s.osc('sine', [[0.05, 4300], [0.7, 1500]], 0.75).detune(s.lfo(24, 40)).env(perc(0.68, 0.34, 0.01)).out(1, [[0, -0.7], [0.7, 0.7]]);
  }),
  powerup('powerup_shock', 1.2, [64, 71, 76], s => zap(s, 0.7, 0.7, 150)),
  powerup('powerup_ghost', 1.6, [69, 72, 76, 81], s => {
    s.noise('pink', 1.3).bp([[0, 700], [1.2, 2400]], 7).env(swell(0.2, 1.3, 0.8, 1)).out(1.6);
    s.osc('sine', [[0, 880], [1.3, 660]], 1.4).detune(s.lfo(5, 22)).env(swell(0.15, 1.35, 0.8, 0.2)).out();
  }),
  powerup('powerup_magnet', 1.2, [60, 67, 72], s => {
    s.osc('sawtooth', [[0, 110], [0.8, 440]], 0.85).lp(1800, 4).am(s.lfo(14, 0.6, 'square')).env(perc(0.8, 0.28, 0.02)).out();
  }),
  powerup('powerup_regen', 1.4, [60, 64, 67, 72], s => {
    [0, 0.14, 0.28, 0.42].forEach((t, i) => s.at(t, () => s.osc('sine', hz(84 + i * 2), 0.3).env(perc(0.26, 0.18)).out()));
  }),
  powerup('powerup_frostNova', 1.3, [79, 83, 86], s => {
    s.noise('white', 0.8).hp(4300).env(perc(0.68, 0.34, 0.005)).out();
    modal(s, { f0: 3700, modes: MODES.glass, decay: 0.42, level: 0.28, strike: 0 });
  }),
  powerup('powerup_timeWarp', 1.5, [55, 59, 62, 66], s => {
    s.osc('sine', [[0, 880], [1.2, 110]], 1.3).env(perc(1.2, 0.34, 0.01)).out(1, [[0, -0.5], [1.2, 0.5]]);
    s.noise('pink', 1.2).bp([[0, 3000], [1.1, 300]], 3).env(perc(1.1, 0.7, 0.02)).out();
  }),
  r('powerup_end', { dur: 0.6, mix: 'reward', over: { volume: 0.34 }, expect: { trend: -1 } }, s => {
    s.osc('triangle', [[0, 1320], [0.42, 440]], 0.46).env(perc(0.42, 0.7, 0.003)).out();
  }),
  r('powerup_spawn', { dur: 1, mix: 'enemyFx', over: { volume: 0.5, near: 14, far: 180, exempt: true, pitchJitter: 0, send: 0.3 } }, s => {
    [72, 79, 84].forEach((n, i) => s.at(i * 0.1, () => bell(s, hz(n), 0.6, 0.45)));
    riser(s, 0.32, 0.3, 500, 4000);
  }),
  r('powerup_idle_loop', { dur: 2, mix: 'loop3d', loop: true, over: { volume: 0.22, near: 3, far: 26, maxVoices: 4 } }, s => {
    s.osc('sine', 440).am(s.lfo(3, 0.3)).out(0.18);
    s.osc('sine', 660).am(s.lfo(2, 0.4)).out(0.1);
    s.osc('sine', 1321).am(s.lfo(5, 0.5)).out(0.05);
  }),
  r('vampire_drain', { dur: 0.55, mix: 'reward', over: { volume: 0.3, maxVoices: 2 } }, s => {
    s.osc('sawtooth', [[0, 880], [0.45, 200]], 0.5).lp(2200, 5).env(perc(0.46, 0.42, 0.01)).out();
    s.noise('white', 0.4).bp([[0, 3000], [0.4, 800]], 6).env(perc(0.36, 0.42, 0.02)).out();
  }),
  r('magnet_pull', { dur: 0.65, mix: 'reward', over: { volume: 0.26 }, expect: { trend: 1 } }, s => {
    s.osc('sine', [[0, 300], [0.6, 1300]], 0.62).am(s.lfo([[0, 14], [0.6, 42]], 0.6, 'square')).env(swell(0.05, 0.62, 0.1, 0.6)).out();
  }),
  r('frost_nova_blast', { dur: 1.8, mix: 'blastSmall', over: { volume: 0.86, airDelay: false, exempt: true, duck: [0.35, 0.8] }, expect: { attackMs: [0, 8], centroid: [800, 12000] } }, s => {
    s.noise('white', 1.2).hp([[0, 1200], [1, 5200]]).env(perc(0.95, 1, 0.0008)).drive(2).out();
    thump(s, 64, 0.32, 0.85, 3);
    for (let i = 0; i < 10; i++) s.at(s.r(0, 0.7), () => modal(s, { f0: s.r(2200, 6000), modes: MODES.glass, decay: s.r(0.08, 0.3), level: s.r(0.16, 0.42), strike: 0.2 }));
  }),
  r('time_warp_in', { dur: 1.3, mix: 'stinger', stereo: true, over: { volume: 0.68, duck: [0.3, 1] }, expect: { trend: -1 } }, s => {
    s.osc('sawtooth', [[0, 1800], [1.1, 60]], 1.2).lp([[0, 8000], [1.1, 280]], 3).env(perc(1.15, 0.42, 0.003)).out(1, [[0, -0.7], [1, 0.7]]);
    s.noise('pink', 1.2).bp([[0, 5000], [1.1, 200]], 2.2).env(perc(1.1, 0.75, 0.005)).out();
    s.at(0.75, () => thump(s, 42, 0.45, 0.42, 1.8));
  }),
  r('time_warp_out', { dur: 1.1, mix: 'stinger', stereo: true, over: { volume: 0.56, duck: undefined }, expect: { trend: 1 } }, s => {
    s.osc('sawtooth', [[0, 60], [1, 1500]], 1.05).lp([[0, 280], [1, 7000]], 3).env([[0, 0.02], [0.92, 0.42], [1.05, 0.0001]]).out(1, [[0, 0.7], [1, -0.7]]);
    s.noise('pink', 1.05).bp([[0, 240], [1, 4800]], 2.2).env([[0, 0.02], [0.92, 0.75], [1.05, 0.0001]]).out();
  }),
];

export const pickups = [
  // The first game's three stepped sines, kept note for note.
  r('pickup_generic', { dur: 0.42, mix: 'reward', over: { volume: 0.3, perFrame: 1 }, expect: { centroid: [400, 2500] } }, s => {
    steps(s, [400, 800, 1200], 0.1, 0.13, 0.9);
  }),
  r('pickup_health', { dur: 0.55, mix: 'reward', over: { volume: 0.36 }, expect: { centroid: [400, 4000] } }, s => {
    steps(s, [hz(72), hz(76), hz(79)], 0.07, 0.3, 0.6);
    s.osc('sine', hz(60), 0.3).env(perc(0.26, 0.28, 0.01)).out();
  }),
  r('pickup_ammo', { dur: 0.42, mix: 'reward', over: { volume: 0.4 } }, s => {
    clank(s, 1250, 0.7, 0.05);
    s.at(0.07, () => clank(s, 1650, 0.55, 0.05));
    s.at(0.12, () => s.osc('triangle', 880, 0.14).env(perc(0.12, 0.3)).out());
  }),
  r('pickup_armor', { dur: 0.55, mix: 'reward', over: { volume: 0.4 } }, s => {
    clank(s, 680, 0.8, 0.12);
    s.at(0.05, () => s.osc('square', [[0, 330], [0.1, 495]], 0.3).lp(1900).env(perc(0.26, 0.3, 0.004)).out());
  }),
  r('pickup_megaHealth', { dur: 1, mix: 'reward', stereo: true, over: { volume: 0.5, duck: [0.2, 0.4] } }, s => {
    [60, 67, 72, 76, 79].forEach((n, i) => s.at(i * 0.07, () => bell(s, hz(n), 0.65, 0.34, (i - 2) * 0.22)));
    s.osc('sine', hz(48), 0.8).env(perc(0.7, 0.42, 0.01)).out();
  }),
  r('pickup_heavyArmor', { dur: 0.9, mix: 'reward', over: { volume: 0.54, duck: [0.2, 0.4] } }, s => {
    clank(s, 420, 1, 0.2);
    thump(s, 76, 0.16, 0.8, 2);
    s.at(0.13, () => clank(s, 640, 0.7, 0.14));
    s.at(0.16, () => s.osc('square', [[0, 220], [0.12, 440]], 0.5).lp(1500).env(perc(0.44, 0.34, 0.004)).out());
  }),
  r('pickup_weaponCache', { dur: 1.1, mix: 'reward', stereo: true, over: { volume: 0.54, duck: [0.2, 0.5] } }, s => {
    clank(s, 560, 0.8, 0.1);
    brass(s, [52, 59, 64], 0.8, 0.7, 2600);
    s.at(0.08, () => bell(s, hz(83), 0.7, 0.34));
  }),
  r('pickup_grenade', { dur: 0.32, mix: 'reward', over: { volume: 0.36 } }, s => {
    clank(s, 980, 0.7, 0.05);
    s.at(0.1, () => modal(s, { f0: 3100, modes: MODES.bar, decay: 0.07, level: 0.5, strike: 0.3 }));
  }),
  r('cache_incoming', { dur: 3, mix: 'blastSmall', over: { volume: 0.54, near: 40, far: 500, airDelay: false, duck: undefined }, expect: { trend: -1 } }, s => {
    s.osc('sine', [[0, 2100], [2.9, 620]], 3).env([[0, 0.0001], [2.8, 0.34], [3, 0.0001]]).out();
    s.noise('pink', 3).bp([[0, 2500], [2.9, 500]], 1.6).env([[0, 0.0001], [2.85, 1], [3, 0.0001]]).out();
  }),
  r('cache_land', { dur: 1.5, mix: 'blastSmall', over: { volume: 0.72, near: 18, far: 260 }, expect: { attackMs: [0, 20], minSub: 0.06 } }, s => {
    blast(s, { size: 0.42, crackle: 0.5, tail: 0.2, bright: 4000 });
    clank(s, 220, 1, 0.4);
    modal(s, { f0: 160, modes: MODES.barrel, decay: 0.7, level: 0.42, strike: 0 });
  }),
  r('cache_open', { dur: 0.9, mix: 'enemyFx', over: { volume: 0.5, pitchJitter: 0 } }, s => {
    s.noise('white', 0.5).hp(2600).env(perc(0.42, 0.42, 0.01)).out();
    clank(s, 700, 0.7, 0.1);
    s.at(0.2, () => clank(s, 520, 0.8, 0.12));
    s.at(0.28, () => bell(s, hz(76), 0.5, 0.28));
  }),
  r('weapon_unlock', { dur: 1.6, mix: 'stinger', stereo: true, over: { volume: 0.62 } }, s => {
    boom(s, 0.4, 0.6);
    brass(s, [45, 52, 57, 64], 1.2, 1, 3200);
    s.at(0.14, () => clank(s, 1250, 0.6, 0.07));
    s.at(0.28, () => bell(s, hz(88), 0.8, 0.28));
  }),
];

export const progress = [
  r('wave_start', { dur: 1.8, mix: 'stinger', stereo: true, over: { volume: 0.6 }, expect: { attackMs: [0, 30] } }, s => {
    boom(s, 0.5, 0.8);
    brass(s, [38, 45, 50], 1.3, 1.1, 2200);
    s.at(0.2, () => brass(s, [50, 57, 62], 0.7, 0.5, 3000));
  }),
  r('wave_start_hard', { dur: 2.4, mix: 'stinger', stereo: true, over: { volume: 0.72, duck: [0.45, 1.1] }, expect: { attackMs: [0, 30] } }, s => {
    boom(s, 0.8, 1);
    brass(s, [33, 40, 41], 1.9, 1.3, 2000);
    s.at(0.28, () => { boom(s, 0.4, 0.6); brass(s, [45, 52, 53], 1, 0.7, 2600); });
  }),
  r('wave_clear', { dur: 2.2, mix: 'stinger', stereo: true, over: { volume: 0.56 } }, s => {
    [62, 69, 74, 81].forEach((n, i) => s.at(i * 0.12, () => bell(s, hz(n), 1.3, 0.42, (i - 1.5) * 0.3)));
    brass(s, [50, 57, 62, 66], 1.6, 0.8, 2600);
  }),
  // Two knuckles on a helmet, then the ping leaves and comes back thinner. Not on the ui bus: it is a world event.
  r('sonar_ping', { dur: 1.7, mix: 'reward', over: { volume: 0.5, send: 0.3 }, expect: { attackMs: [0, 12] } }, s => {
    click(s, 1400, 0.7, 0.008);
    s.at(0.003, () => {
      bell(s, 1568, 1.1, 0.6);
      s.osc('sine', [[0, 1568], [0.5, 1320]], 0.7).env(perc(0.6, 0.3, 0.002)).out();
    });
    s.at(0.5, () => bell(s, 1568, 0.8, 0.14));
    s.at(0.95, () => bell(s, 1568, 0.6, 0.05));
  }),
  r('wave_tick', { dur: 0.14, mix: 'reward', over: { volume: 0.34 }, expect: { centroid: [600, 5000] } }, s => {
    s.osc('square', 1046, 0.06).lp(3400).env(perc(0.05, 0.7, 0.001)).out();
  }),
  r('boss_alarm', { dur: 3.2, mix: 'stinger', over: { volume: 0.68, duck: [0.55, 3], send: 0.3 }, expect: { centroid: [200, 3000] } }, s => {
    for (let i = 0; i < 4; i++) {
      s.at(i * 0.78, () => {
        s.osc('sawtooth', [[0, 196], [0.5, 262]], 0.62).drive(2).lp(2200).env(swell(0.012, 0.6, 0.16, 0.7)).out();
        s.osc('sawtooth', [[0, 294], [0.5, 392]], 0.62, 6).lp(2200).env(swell(0.012, 0.6, 0.16, 0.42)).out();
      });
    }
  }),
  r('boss_intro', { dur: 4.2, mix: 'stinger', stereo: true, over: { volume: 0.86, duck: [0.7, 3.6], send: 0.3 } }, s => {
    boom(s, 1.2, 1);
    brass(s, [26, 33, 34, 38], 3.2, 1.6, 1500);
    s.at(0.9, () => boom(s, 0.9, 0.8));
    s.at(1.8, () => { boom(s, 1.1, 1); brass(s, [38, 45, 46], 2, 1, 2200); });
  }),
  r('boss_death', { dur: 5, mix: 'stinger', stereo: true, over: { volume: 0.86, duck: [0.65, 3.6], send: 0.3 } }, s => {
    boom(s, 1.5, 1);
    [50, 57, 62, 69, 74, 81].forEach((n, i) => s.at(0.25 + i * 0.14, () => bell(s, hz(n), 2.2, 0.34, (i - 2.5) * 0.25)));
    brass(s, [38, 45, 50, 54, 57], 4, 1.6, 2600);
  }),

  r('combo_tick', { dur: 0.14, mix: 'reward', over: { volume: 0.3, maxVoices: 3 }, expect: { centroid: [800, 6000] } }, s => {
    s.osc('sine', 1318, 0.1).env(perc(0.08, 0.7, 0.001)).out();
    s.osc('square', 2637, 0.04).lp(6000).env(perc(0.03, 0.14, 0.001)).out();
  }),
  r('combo_tier', { dur: 0.75, mix: 'reward', stereo: true, over: { volume: 0.46, priority: 8, duck: [0.14, 0.3] } }, s => {
    [79, 83, 86].forEach((n, i) => s.at(i * 0.05, () => bell(s, hz(n), 0.48, 0.42, (i - 1) * 0.4)));
    thump(s, 80, 0.1, 0.5, 2);
  }),
  r('combo_break', { dur: 0.55, mix: 'reward', over: { volume: 0.34 }, expect: { trend: -1 } }, s => {
    s.osc('sawtooth', [[0, 520], [0.46, 110]], 0.5).lp([[0, 3000], [0.45, 500]], 2).env(perc(0.46, 0.5, 0.003)).out();
  }),
  r('multikill', { dur: 0.9, mix: 'reward', stereo: true, over: { volume: 0.52, priority: 8, duck: [0.2, 0.4] } }, s => {
    thump(s, 62, 0.16, 0.85, 3);
    [72, 79, 84].forEach((n, i) => s.at(0.02 + i * 0.03, () => bell(s, hz(n), 0.6, 0.34, (i - 1) * 0.3)));
    brass(s, [48, 55, 60], 0.5, 0.42, 3200);
  }),
  r('style_bonus', { dur: 0.42, mix: 'reward', over: { volume: 0.28 } }, s => {
    s.fm(1046, 2, [[0, 1000], [0.3, 30]], 0.36).env(perc(0.32, 0.6, 0.002)).out();
  }),
  r('score_tick', { dur: 0.06, mix: 'ui', over: { volume: 0.16, maxVoices: 2 }, expect: { centroid: [700, 7000] } }, s => {
    s.osc('square', 1760, 0.02).lp(6000).env(perc(0.018, 0.7, 0.0008)).out();
  }),
  r('highscore', { dur: 2.4, mix: 'stinger', stereo: true, over: { bus: 'ui', volume: 0.6 } }, s => {
    [60, 64, 67, 72, 76, 79, 84].forEach((n, i) => s.at(i * 0.09, () => bell(s, hz(n), 1.2, 0.34, (i - 3) * 0.2)));
    brass(s, [48, 55, 60, 64], 1.9, 1, 3000);
  }),
  r('game_over', { dur: 3.2, mix: 'stinger', stereo: true, over: { volume: 0.72, duck: [0.5, 2], send: 0.2 } }, s => {
    boom(s, 1.4, 1);
    brass(s, [38, 41, 45], 2.6, 1.3, 1400);
    s.at(0.7, () => brass(s, [33, 36, 40], 2, 0.9, 1100));
    s.osc('sine', [[0.4, 880], [2.6, 110]], 2.8).env(perc(2.3, 0.14, 0.2)).out();
  }),

  r('hit_marker', { dur: 0.07, mix: 'reward', over: { volume: 0.22, perFrame: 1, maxVoices: 2 }, expect: { centroid: [1500, 9000], attackMs: [0, 3] } }, s => {
    click(s, 3600, 0.9, 0.006);
  }),
  r('hit_marker_head', { dur: 0.16, mix: 'reward', over: { volume: 0.34, perFrame: 1, maxVoices: 2 }, expect: { centroid: [1500, 9000], attackMs: [0, 3] } }, s => {
    modal(s, { f0: 3150, modes: MODES.bar, decay: 0.09, level: 0.75, strike: 0.6 });
  }),
  r('hit_marker_kill', { dur: 0.2, mix: 'reward', over: { volume: 0.38, perFrame: 1, maxVoices: 2 }, expect: { attackMs: [0, 6] } }, s => {
    click(s, 1900, 0.9, 0.009);
    s.osc('triangle', 1250, 0.13).env(perc(0.11, 0.6, 0.0008)).out();
    thump(s, 110, 0.05, 0.42, 2);
  }),
  r('hit_marker_armor', { dur: 0.1, mix: 'reward', over: { volume: 0.24, perFrame: 1, maxVoices: 2 }, expect: { attackMs: [0, 3] } }, s => clank(s, 1500, 0.6, 0.03)),
];

const uiBlip = { centroid: [300, 9500], attackMs: [0, 6] } as const;

export const ui = [
  r('ui_hover', { dur: 0.05, mix: 'ui', over: { volume: 0.13, maxVoices: 2 }, expect: uiBlip }, s => {
    s.osc('sine', 1760, 0.03).env(perc(0.022, 0.8, 0.0006)).out();
  }),
  r('ui_click', { dur: 0.07, mix: 'ui', over: { volume: 0.3 }, expect: uiBlip }, s => {
    click(s, 2100, 0.9, 0.006);
    s.osc('sine', 880, 0.03).env(perc(0.025, 0.4, 0.0006)).out();
  }),
  r('ui_back', { dur: 0.14, mix: 'ui', over: { volume: 0.26 }, expect: uiBlip }, s => {
    s.osc('square', [[0, 660], [0.08, 330]], 0.1).lp(2800).env(perc(0.09, 0.5, 0.0006)).out();
  }),
  r('ui_tick', { dur: 0.04, mix: 'ui', over: { volume: 0.16 }, expect: uiBlip }, s => click(s, 3000, 0.8, 0.004)),
  r('ui_toggle', { dur: 0.1, mix: 'ui', over: { volume: 0.28 }, expect: uiBlip }, s => {
    click(s, 1500, 0.9, 0.006);
    s.at(0.025, () => click(s, 2500, 0.6, 0.005));
  }),
  r('ui_slider', { dur: 0.03, mix: 'ui', over: { volume: 0.12 }, expect: uiBlip }, s => s.osc('sine', 1320, 0.018).env(perc(0.014, 0.8, 0.0005)).out()),
  r('ui_error', { dur: 0.26, mix: 'ui', over: { volume: 0.3 }, expect: uiBlip }, s => {
    s.osc('square', 196, 0.09).lp(1400).env(swell(0.002, 0.08, 0.02, 0.7)).out();
    s.at(0.11, () => s.osc('square', 185, 0.12).lp(1400).env(swell(0.002, 0.11, 0.03, 0.7)).out());
  }),
  r('ui_open', { dur: 0.24, mix: 'ui', over: { volume: 0.28 } }, s => {
    s.osc('sine', [[0, 440], [0.12, 1100]], 0.17).env(perc(0.15, 0.6, 0.002)).out();
    s.noise('white', 0.12).bp([[0, 1100], [0.1, 3800]], 2).env(perc(0.1, 0.3, 0.002)).out();
  }),
  r('ui_close', { dur: 0.24, mix: 'ui', over: { volume: 0.26 } }, s => {
    s.osc('sine', [[0, 1100], [0.14, 400]], 0.18).env(perc(0.16, 0.6, 0.002)).out();
    s.noise('white', 0.1).bp([[0, 3600], [0.1, 1100]], 2).env(perc(0.09, 0.26, 0.002)).out();
  }),
  r('ui_type', { dur: 0.04, mix: 'ui', over: { volume: 0.12, maxVoices: 3, pitchJitter: 0.12 }, expect: uiBlip }, s => {
    s.noise('white', 0.015).bp(3400, 2).env(perc(0.005, 0.9, 0.0004)).out();
    s.osc('square', 1046, 0.008).env(perc(0.006, 0.2, 0.0004)).out();
  }),
  r('ui_confirm', { dur: 0.32, mix: 'ui', over: { volume: 0.32 } }, s => {
    steps(s, [hz(76), hz(83)], 0.06, 0.2, 0.7, 'triangle');
    click(s, 2100, 0.5, 0.006);
  }),
];
