import { perc, swell } from '../dsl';
import { MODES, blast, clank, click, gunshot, laser, modal, thump, whoosh, zap } from '../instruments';
import { r } from '../recipe';

export const weapons = [
  // Judge. The second low boom after the crack is what separates a hand cannon from a pistol.
  r('revolver_fire', { dur: 1.6, n: 3, mix: 'gunHeavy', expect: { attackMs: [0, 6], minSub: 0.04, centroid: [450, 2400] } }, s => {
    gunshot(s, {
      crack: 1.8, crackHp: 1900, body: 820, bodyDecay: 0.14, bodyLevel: 1.3, sub: 0.75, subFreq: 66, subDecay: 0.22,
      tail: 0.5, tailDecay: 1, drive: 4.5, ring: 0.3, ringFreq: s.r(1900, 2300),
    });
    s.at(0.012, () => s.noise('brown', 0.6).lp([[0, 1000], [0.45, 110]]).env(perc(0.38, 1)).gain(1.8).out(0.42));
  }),
  r('revolver_cock', { dur: 0.3, mix: 'foley' }, s => {
    click(s, 2400, 0.8);
    s.at(0.095, () => { click(s, 3400, 1); clank(s, 1600, 0.35, 0.03); });
  }),
  r('revolver_open', { dur: 0.42, mix: 'foley' }, s => {
    click(s, 1800, 0.9);
    for (let i = 0; i < 5; i++) s.at(0.09 + i * 0.045, () => click(s, 3000 + i * 180, 0.32, 0.006));
    s.at(0.33, () => clank(s, 900, 0.5, 0.05));
  }),
  r('revolver_load', { dur: 0.3, mix: 'foley', over: { maxVoices: 3 } }, s => {
    clank(s, s.r(1300, 1600), 0.8, 0.05);
    s.at(0.05, () => click(s, 2600, 0.5));
  }),
  r('revolver_close', { dur: 0.5, mix: 'foley' }, s => {
    for (let i = 0; i < 7; i++) s.at(i * 0.03 * (1 + i * 0.12), () => click(s, 3400 - i * 150, 0.34, 0.005));
    s.at(0.3, () => clank(s, 1100, 1, 0.08));
  }),
  r('revolver_ricochet', { dur: 1.1, mix: 'gun', expect: { trend: -1 } }, s => {
    click(s, 4200, 0.9);
    s.osc('sine', [[0, 4300], [0.12, 3100], [1, 1150]], 1).detune(s.lfo(23, 60))
      .env([[0, 0.0001], [0.02, 1], [1, 0.0001]]).out(0.55);
    s.osc('sine', [[0, 6100], [1, 1700]], 0.7).env(perc(0.55, 0.3)).out();
  }),

  // Harrow. A rifle beside the SMG: a harder crack, a real chest thump, and a tail the SMG's 20 Hz chatter never has room for.
  r('harrow_fire', { dur: 0.9, n: 3, mix: 'gun', over: { volume: 0.52, send: 0.2 }, expect: { attackMs: [0, 6], minSub: 0.03 } }, s => {
    gunshot(s, {
      crack: 1.5, crackHp: 2500, body: 1100, bodyDecay: 0.09, bodyLevel: 1.15, sub: 0.6, subFreq: 84, subDecay: 0.13,
      tail: 0.4, tailDecay: 0.55, drive: 4, ring: 0.22, ringFreq: s.r(2700, 3100),
    });
  }),
  // Rivet. All crack and slide: short enough that ten a second stay ten shots, and nothing below it to mistake for the Judge.
  r('rivet_fire', { dur: 0.45, n: 3, mix: 'gun', over: { volume: 0.44 }, expect: { attackMs: [0, 6], centroid: [1200, 9000] } }, s => {
    gunshot(s, {
      crack: 1.3, crackHp: 3000, body: 1750, bodyDecay: 0.05, bodyLevel: 1, sub: 0.25, subFreq: 120, subDecay: 0.06,
      tail: 0.18, tailDecay: 0.28, drive: 3.5, ring: 0.3, ringFreq: s.r(3300, 3800),
    });
    s.at(0.035, () => click(s, 2900, 0.35, 0.006));
  }),
  // Sabot. The cannon's report with no shell going off at the far end, so the shot itself carries it: a tearing dart and a long roll.
  r('sabot_fire', { dur: 2, n: 2, mix: 'gunHeavy', over: { send: 0.32 }, expect: { attackMs: [0, 6], minSub: 0.05 } }, s => {
    gunshot(s, {
      crack: 2, crackHp: 2300, body: 620, bodyDecay: 0.17, bodyLevel: 1.35, sub: 1, subFreq: 54, subDecay: 0.3,
      tail: 0.6, tailDecay: 1.2, drive: 5, ring: 0.36, ringFreq: s.r(1300, 1600),
    });
    s.osc('sawtooth', [[0, 6400], [0.04, 2600], [0.2, 420]], 0.24).drive(3, 'fold').env(perc(0.18, 0.8, 0.0003)).out(0.5);
    s.at(0.01, () => s.noise('brown', 0.7).lp([[0, 900], [0.5, 100]]).env(perc(0.45, 1)).gain(1.6).out(0.4));
  }),

  // Thresher. The pump's recording sits on top (`thresher_fire` in catalog.ts); this is what makes it a drum gun: a short
  // chest punch under it, and the bolt slamming home 50 ms later, so five a second read as a machine and not five pumps.
  r('thresher_punch', { dur: 0.5, n: 3, mix: 'gun', over: { volume: 0.5, send: 0.16 }, expect: { attackMs: [0, 6], minSub: 0.04 } }, s => {
    gunshot(s, {
      crack: 0.9, crackHp: 1700, body: 520, bodyDecay: 0.07, bodyLevel: 1.2, sub: 0.95, subFreq: 72, subDecay: 0.12,
      tail: 0.22, tailDecay: 0.32, drive: 4.5, ring: 0.12, ringFreq: s.r(1500, 1800),
    });
    s.at(0.05, () => { clank(s, s.r(820, 960), 0.55, 0.04); click(s, 2600, 0.4, 0.006); });
  }),
  // The drum: a heavy steel can with shells rattling in it, out on a latch and in with a slap.
  r('drum_out', { dur: 0.6, mix: 'foley' }, s => {
    click(s, 1600, 0.9);
    s.at(0.04, () => clank(s, 520, 0.8, 0.08));
    for (let i = 0; i < 6; i++) s.at(0.08 + i * 0.035 + s.r(0, 0.012), () => clank(s, s.r(1300, 1900), 0.28 - i * 0.03, 0.03));
    s.at(0.06, () => s.noise('pink', 0.3).bp([[0, 900], [0.3, 500]], 1).env(perc(0.26, 0.3)).out());
  }),
  r('drum_in', { dur: 0.55, mix: 'foley' }, s => {
    s.noise('pink', 0.12).bp(1000, 1).env(perc(0.1, 0.3, 0.02)).out();
    s.at(0.1, () => { clank(s, 430, 1, 0.12); thump(s, 92, 0.1, 0.8, 2); });
    s.at(0.13, () => click(s, 2300, 0.8));
    for (let i = 0; i < 3; i++) s.at(0.15 + i * 0.03, () => clank(s, s.r(1400, 1800), 0.16, 0.025));
  }),

  // Quiver. One tube lighting: a sharp pop and a quick tearing hiss, a third the length of the ROCKET's, so four in 0.3 s
  // are four. It sits under a pitched-up, cut-down `rocket_fire` (`quiver_fire` in catalog.ts) to keep the family voice.
  r('quiver_tube', { dur: 0.9, n: 3, mix: 'gun', over: { volume: 0.5, send: 0.22, near: 8, far: 160 }, expect: { attackMs: [0, 8] } }, s => {
    thump(s, 88, 0.09, 0.8, 2.6);
    s.noise('white', 0.05).hp(2600).env(perc(0.04, 1, 0.0005)).drive(3).out(0.8);
    s.noise('pink', 0.8).bp([[0, 2400], [0.15, 1300], [0.75, 600]], 0.8).env(perc(0.7, 0.85, 0.004)).drive(2.5).out(0.9);
    s.osc('sawtooth', [[0, 900], [0.6, 260]], 0.7).lp(1800).env(perc(0.6, 0.18, 0.01)).out(0.5);
  }),
  r('quiver_load', { dur: 0.32, n: 2, mix: 'foley', over: { maxVoices: 3 } }, s => {
    s.noise('pink', 0.12).bp([[0, 700], [0.1, 1500]], 1.2).env(perc(0.1, 0.35, 0.01)).out();
    s.at(0.1, () => { clank(s, s.r(700, 820), 0.8, 0.07); click(s, 2400, 0.5); });
  }),
  // The seeker. Short, clean tones well above the guns, so a lock is heard through a fight.
  r('quiver_arm', { dur: 0.3, mix: 'reward', over: { volume: 0.3 }, expect: { trend: 1 } }, s => {
    s.osc('sine', [[0, 520], [0.22, 980]], 0.26).env([[0, 0.0001], [0.02, 0.6], [0.2, 0.5], [0.26, 0.0001]]).out(0.6);
    click(s, 1800, 0.3, 0.006);
  }),
  r('quiver_lock', { dur: 0.16, mix: 'reward', over: { volume: 0.34, maxVoices: 4, perFrame: 2 }, expect: { centroid: [900, 6000] } }, s => {
    s.osc('square', 1180, 0.09).lp(3600).env(perc(0.085, 0.8, 0.002)).out(0.6);
    s.osc('sine', 2360, 0.06).env(perc(0.05, 0.4, 0.001)).out(0.6);
  }),
  r('quiver_full', { dur: 0.42, mix: 'reward', over: { volume: 0.36 } }, s => {
    [0, 0.09, 0.18].forEach(t => s.at(t, () => s.osc('square', 1760, 0.07).lp(4200).env(perc(0.065, 0.7, 0.002)).out(0.55)));
  }),
  r('quiver_cancel', { dur: 0.3, mix: 'reward', over: { volume: 0.28 }, expect: { trend: -1 } }, s => {
    s.osc('square', [[0, 900], [0.24, 300]], 0.26).lp(2400).env(perc(0.24, 0.7, 0.004)).out(0.6);
  }),

  // Lance. The charge must end loud with no decay: releasing it is the payoff.
  r('railgun_charge', { dur: 1.6, mix: 'loop2d', expect: { trend: 1 } }, s => {
    const rise: [number, number][] = [[0, 95], [1.6, 760]];
    s.osc('sawtooth', rise, 1.6).detune(s.lfo([[0, 5], [1.6, 28]], 18)).lp([[0, 400], [1.6, 5200]], 2)
      .env([[0, 0.05], [1.5, 0.6], [1.6, 0.0001]]).out(0.55);
    s.osc('sawtooth', rise.map(([t, f]) => [t, f * 1.5] as const), 1.6, 8).lp([[0, 300], [1.6, 4200]], 2)
      .env([[0, 0.02], [1.5, 0.42], [1.6, 0.0001]]).out(0.45);
    s.osc('sine', [[0.3, 1400], [1.6, 7200]], 1.6).env([[0, 0.0001], [0.3, 0.0001], [1.5, 0.3], [1.6, 0.0001]]).out(0.6);
    s.grains(1.6, t => 10 + t * 110, 0.0015, t => 0.2 + t * 0.4).hp(2600).out(0.8);
  }),
  r('railgun_charge_loop', { dur: 1, mix: 'loop2d', loop: true }, s => {
    s.osc('sawtooth', 760).lp(5200, 2).am(s.lfo(28, 0.18)).out(0.34);
    s.osc('sawtooth', 1140, undefined, 8).lp(4200, 2).out(0.22);
    s.osc('sine', 7200).am(s.lfo(11, 0.3)).out(0.12);
    s.grains(1.4, () => 170, 0.0015).hp(2600).out(0.5);
  }),
  r('railgun_ready', { dur: 0.45, mix: 'reward', expect: { centroid: [1500, 9000] } }, s => {
    modal(s, { f0: 2960, modes: MODES.bell, decay: 0.28, level: 0.8, strike: 0.2 });
    s.at(0.06, () => modal(s, { f0: 3950, modes: MODES.bell, decay: 0.24, level: 0.5, strike: 0 }));
  }),
  r('railgun_fire', { dur: 2.4, mix: 'gunHeavy', over: { volume: 0.95, duck: [0.35, 0.5], send: 0.4 }, expect: { attackMs: [0, 5], minSub: 0.06 } }, s => {
    s.noise('white', 0.06).hp(3000).env(perc(0.016, 1, 0.0002)).drive(8, 'hard').out(1);
    // The tear: a folded sawtooth diving through the whole spectrum in a quarter second.
    s.osc('sawtooth', [[0, 5200], [0.05, 1700], [0.28, 70]], 0.32).drive(4, 'fold').env(perc(0.26, 1, 0.0003)).out(0.75);
    s.osc('sine', [[0, 240], [0.05, 72], [1.3, 24]], 1.6).env(perc(1.2, 1, 0.0008)).drive(2.6).out(1);
    s.noise('pink', 1.3).bp([[0, 5000], [1.2, 300]], 0.8).env(perc(1, 0.75, 0.0008)).out();
    s.at(0.04, () => zap(s, 1.1, 0.42, 96));
    modal(s, { f0: 1420, modes: MODES.bar, decay: 0.55, level: 0.28, strike: 0 });
  }),
  r('railgun_fizzle', { dur: 0.6, mix: 'gun', expect: { trend: -1 } }, s => {
    s.osc('sawtooth', [[0, 620], [0.5, 60]], 0.55).lp([[0, 4000], [0.5, 300]], 3).env(perc(0.5, 0.7)).out();
    zap(s, 0.35, 0.5, 70);
  }),
  r('railgun_beam', { dur: 1.6, mix: 'enemyFx', over: { volume: 0.4 } }, s => {
    s.osc('sawtooth', 96).lp(1500, 3).env(perc(1.5, 1)).out(0.5);
    s.osc('sine', [[0, 1900], [1.5, 620]], 1.6).am(s.lfo(30, 0.4)).env(perc(1.4, 0.5)).out();
    s.grains(1.5, t => 90 * (1 - t / 1.5) + 4, 0.0015).hp(3000).out(0.5);
  }),

  // Buzzsaw. Everything is built on a 50 Hz firing grid so spin and barrage share a pulse.
  r('minigun_spinup', { dur: 1, mix: 'loop2d', expect: { trend: 1 } }, s => {
    const f: [number, number][] = [[0, 42], [0.9, 300]];
    s.osc('sawtooth', f, 1).lp([[0, 500], [1, 3400]], 1.5).env([[0, 0.1], [0.92, 0.55], [1, 0.0001]]).out(0.6);
    s.osc('square', f.map(([t, v]) => [t, v * 2.03] as const), 1).lp(2400).env([[0, 0.02], [0.92, 0.2], [1, 0.0001]]).out(0.6);
    s.grains(1, t => 10 + t * t * 240, 0.0018, t => 0.4 + t * 0.6).bp(2300, 1.6).out(1.2);
  }),
  r('minigun_spin_loop', { dur: 1, mix: 'loop2d', loop: true }, s => {
    s.osc('sawtooth', 300).lp(3400, 1.5).am(s.lfo(50, 0.24)).out(0.33);
    s.osc('square', 609).lp(2400).out(0.12);
    s.osc('sine', 50).out(0.16);
    s.noise('pink').bp(3000, 1).out(0.08);
  }),
  r('minigun_fire_loop', { dur: 0.8, mix: 'loop2d', loop: true, over: { volume: 0.72, send: 0.2 }, seam: 0.1 }, s => {
    const n = Math.ceil((0.8 + 0.2) * s.sr);
    const train = new Float32Array(n);
    const step = Math.round(0.02 * s.sr);
    for (let i = 0, k = 0; i < n; i += step, k++) {
      // Loop-periodic amplitude: every 40th shot repeats, so the seam cannot be heard.
      const a = 0.7 + 0.3 * Math.sin(((k % 40) * 2.399) % 6.283);
      for (let j = 0; j < 90 && i + j < n; j++) train[i + j] = a * (1 - j / 90) * (s.rng() * 2 - 1);
    }
    const shots = s.samples(train);
    shots.fork().hp(1900).drive(3.5).out(0.5);
    shots.fork().bp(640, 0.7).drive(6).out(0.95);
    shots.fork().lp(170).gain(4).drive(3).out(0.9);
    s.osc('sawtooth', 300).lp(3200).out(0.1);
    s.noise('pink').lp(2600).am(s.lfo(50, 0.5)).out(0.16);
  }),
  r('minigun_spindown', { dur: 1.5, mix: 'loop2d', expect: { trend: -1 } }, s => {
    const f: [number, number][] = [[0, 300], [1.4, 30]];
    s.osc('sawtooth', f, 1.5).lp([[0, 3400], [1.4, 300]], 1.5).env(perc(1.4, 0.55, 0.002)).out();
    s.grains(1.4, t => 200 * Math.exp(-t * 2.8) + 4, 0.0018, t => 1 - t / 1.5).bp([[0, 2300], [1.3, 420]], 1.6).out(1.2);
  }),
  r('minigun_fire', { dur: 0.28, n: 3, mix: 'gun', expect: { attackMs: [0, 5] } }, s => {
    gunshot(s, { crack: 0.8, crackHp: 2600, body: 860, bodyDecay: 0.05, sub: 0.6, subFreq: 110, subDecay: 0.07, drive: 3.5 });
  }),

  // Kiln.
  r('flame_ignite', { dur: 0.6, mix: 'gun', expect: { minSub: 0.03 } }, s => {
    s.noise('pink', 0.55).bp([[0, 300], [0.1, 1400], [0.5, 500]], 0.7).env(perc(0.45, 1, 0.012)).drive(3).out(0.9);
    thump(s, 62, 0.22, 0.8, 2);
    s.grains(0.5, t => 180 * (1 - t * 2), 0.002).bp(2600, 1.2).out(0.8);
  }),
  r('flame_loop', { dur: 2.4, mix: 'loop2d', loop: true, stereo: true, over: { volume: 0.55 } }, s => {
    s.noise('pink').lp(1900).sweep(s.wander(3, 500)).am(s.wander(9, 0.34)).out(0.7, -0.2);
    s.noise('brown').lp(420).gain(1.8).am(s.wander(5, 0.4)).out(0.8, 0.2);
    s.noise('white').hp(5200).am(s.wander(3, 0.5)).out(0.07);
    s.grains(3, () => 34, 0.0025).bp(1700, 1.6).drive(1.8).out(1, 0.1);
  }),
  r('flame_stop', { dur: 0.5, mix: 'gun' }, s => {
    s.noise('pink', 0.45).bp([[0, 1200], [0.4, 3200]], 0.9).env(perc(0.38, 0.8, 0.002)).out();
    s.at(0.03, () => thump(s, 90, 0.1, 0.4, 1.6));
  }),
  r('flame_burn_loop', { dur: 2.2, mix: 'loop3d', loop: true, over: { volume: 0.38, maxVoices: 4 } }, s => {
    s.noise('pink').lp(1000).am(s.wander(7, 0.45)).out(0.45);
    s.grains(3, () => 46, 0.002).bp(2400, 1.4).drive(1.6).out(1.1);
    s.grains(3, () => 7, 0.003).bp(650, 2).out(1.4);
  }),

  // Stakegun. A pneumatic thunk with no powder: all air and steel.
  r('stake_fire', { dur: 0.8, mix: 'gun', over: { volume: 0.72 }, expect: { attackMs: [0, 8] } }, s => {
    s.noise('pink', 0.3).bp([[0, 2400], [0.2, 700]], 0.9).env(perc(0.17, 1, 0.0006)).drive(2).out(0.85);
    clank(s, 620, 1, 0.13);
    thump(s, 70, 0.16, 0.95, 3);
    modal(s, { f0: 1830, modes: MODES.bar, decay: 0.34, level: 0.26, strike: 0 });
  }),
  r('stake_reload', { dur: 0.7, mix: 'foley' }, s => {
    for (let i = 0; i < 4; i++) s.at(i * 0.07, () => click(s, 2100 + i * 240, 0.5, 0.008));
    s.at(0.34, () => clank(s, 760, 1, 0.09));
    s.at(0.4, () => s.noise('pink', 0.2).bp(1200, 1).env(perc(0.14, 0.3)).out());
  }),
  r('stake_hit_wall', { dur: 0.6, mix: 'impact', over: { volume: 0.6, priority: 6 } }, s => {
    s.noise('white', 0.04).hp(1500).env(perc(0.012, 1)).drive(3).out();
    clank(s, 1180, 0.8, 0.09);
    thump(s, 110, 0.08, 0.6, 2);
    s.grains(0.4, t => 200 * Math.exp(-t * 11), 0.002, t => 1 - t * 2).bp(3000, 1).out(0.8);
  }),
  r('stake_hit_flesh', { dur: 0.45, mix: 'gore', over: { volume: 0.7 } }, s => {
    s.noise('pink', 0.08).bp(900, 1).env(perc(0.03, 1)).drive(3).out();
    s.osc('sine', [[0, 210], [0.07, 70]], 0.12).env(perc(0.08, 1)).out();
    s.grains(0.25, t => 240 * Math.exp(-t * 16), 0.003).bp(700, 3).out(1.2);
    s.at(0.015, () => click(s, 1900, 0.5));
  }),
  r('stake_twang', { dur: 1.1, mix: 'impact', over: { volume: 0.34, send: 0.2 } }, s => {
    const f = s.r(205, 240);
    [1, 2.76, 5.4].forEach((m, i) => {
      s.osc('sine', f * m, 1.1).am(s.lfo(34 + i * 7, 0.55)).env(perc(0.95 / (1 + i), 1 / (1 + i * 1.6))).out();
    });
  }),

  r('grenade_pin', { dur: 0.25, mix: 'foley', expect: { centroid: [1800, 9000] } }, s => {
    modal(s, { f0: 3200, modes: MODES.bar, decay: 0.09, level: 0.8, strike: 0.5 });
    s.at(0.07, () => click(s, 2600, 0.4, 0.006));
  }),
  r('grenade_throw', { dur: 0.35, mix: 'foley' }, s => whoosh(s, { from: 500, to: 1900, dur: 0.33, q: 1.2 })),
  r('grenade_bounce', { dur: 0.3, n: 3, mix: 'impact', over: { volume: 0.4 } }, s => {
    clank(s, s.r(760, 980), 0.8, 0.06);
    s.osc('sine', [[0, 200], [0.05, 120]], 0.09).env(perc(0.06, 0.6)).out();
  }),
  r('grenade_explode', { dur: 2.6, n: 2, mix: 'blast', expect: { attackMs: [0, 12], minSub: 0.08 } }, s => {
    blast(s, { size: 0.8, crack: 1.1, crackle: 0.55, tail: 0.45 });
  }),

  r('reload_mag_out', { dur: 0.28, mix: 'foley' }, s => { click(s, 1500, 0.9); s.at(0.05, () => s.noise('pink', 0.15).bp(1100, 1.2).env(perc(0.11, 0.28)).out()); }),
  r('reload_mag_in', { dur: 0.25, mix: 'foley' }, s => { clank(s, 880, 0.9, 0.05); s.at(0.03, () => click(s, 2700, 0.7)); }),
  r('reload_bolt', { dur: 0.32, mix: 'foley' }, s => {
    click(s, 2100, 0.9);
    s.at(0.012, () => s.noise('white', 0.09).bp([[0, 1700], [0.08, 3100]], 1.5).env(perc(0.07, 0.35)).out());
    s.at(0.13, () => clank(s, 1250, 0.9, 0.06));
  }),
  r('reload_shell_in', { dur: 0.22, n: 3, mix: 'foley' }, s => {
    click(s, s.r(1100, 1400), 0.8);
    s.osc('sine', [[0, 340], [0.05, 200]], 0.07).env(perc(0.05, 0.6)).out();
  }),
  r('reload_pump', { dur: 0.4, mix: 'foley' }, s => {
    clank(s, 620, 0.8, 0.05);
    s.noise('pink', 0.12).bp(1300, 1.4).env(perc(0.08, 0.3)).out();
    s.at(0.18, () => { clank(s, 900, 1, 0.06); click(s, 2300, 0.5); });
  }),
  r('reload_rocket', { dur: 0.7, mix: 'foley' }, s => {
    s.noise('pink', 0.35).bp([[0, 500], [0.3, 1100]], 1.2).env(swell(0.05, 0.34, 0.1, 0.4)).out();
    s.at(0.32, () => { clank(s, 420, 1, 0.13); thump(s, 95, 0.1, 0.7, 2); });
    s.at(0.5, () => click(s, 2300, 0.6));
  }),
  r('reload_cell', { dur: 0.55, mix: 'foley' }, s => {
    click(s, 1700, 0.8);
    s.at(0.1, () => s.osc('sine', [[0, 300], [0.32, 2100]], 0.36).env(swell(0.02, 0.35, 0.05, 0.4)).out());
    s.at(0.42, () => { clank(s, 1400, 0.7, 0.05); });
  }),

  r('weapon_dry', { dur: 0.14, mix: 'foley', over: { priority: 5, volume: 0.5 }, expect: { attackMs: [0, 6] } }, s => { click(s, 3100, 1, 0.006); s.at(0.03, () => click(s, 1700, 0.4, 0.006)); }),
  r('weapon_draw', { dur: 0.32, mix: 'foley' }, s => {
    s.noise('pink', 0.16).bp(1400, 0.9).env(perc(0.11, 0.35, 0.02)).out();
    s.at(0.14, () => click(s, 2300, 0.9));
    s.at(0.2, () => clank(s, 1200, 0.45, 0.04));
  }),
  r('weapon_draw_heavy', { dur: 0.48, mix: 'foley' }, s => {
    s.noise('pink', 0.24).bp(800, 0.9).env(perc(0.16, 0.45, 0.03)).out();
    s.at(0.2, () => { clank(s, 520, 1, 0.1); thump(s, 88, 0.1, 0.7, 2); });
    s.at(0.32, () => click(s, 2000, 0.6));
  }),
  r('weapon_draw_blade', { dur: 0.6, mix: 'foley', expect: { centroid: [1800, 11000] } }, s => {
    s.noise('white', 0.45).bp([[0, 2600], [0.25, 6200]], 3).env(perc(0.28, 0.7, 0.03)).out();
    s.at(0.06, () => modal(s, { f0: 3100, modes: MODES.bar, decay: 0.4, level: 0.32, strike: 0 }));
  }),
  r('weapon_holster', { dur: 0.25, mix: 'foley' }, s => {
    s.noise('pink', 0.15).bp(1000, 1).env(perc(0.1, 0.4, 0.015)).out();
    s.at(0.12, () => click(s, 1500, 0.7));
  }),

  r('casing_brass', { dur: 0.42, n: 4, mix: 'foley', over: { maxVoices: 5, near: 2, far: 18, volume: 0.24, pitchJitter: 0.1 }, expect: { centroid: [1800, 9500] } }, s => {
    const f = s.r(3400, 4600);
    let t = 0;
    for (let i = 0; i < 4; i++) {
      s.at(t, () => modal(s, { f0: f * s.r(0.97, 1.03), modes: MODES.pipe, decay: 0.05, level: 0.9 / (1 + i * 0.8), strike: 0.3 }));
      t += 0.11 / (1 + i * 0.7) + s.r(0, 0.02);
    }
  }),
  r('casing_shotgun', { dur: 0.36, n: 3, mix: 'foley', over: { maxVoices: 3, near: 2, far: 18, volume: 0.26 } }, s => {
    let t = 0;
    for (let i = 0; i < 3; i++) {
      s.at(t, () => {
        s.osc('triangle', s.r(620, 780), 0.05).env(perc(0.03, 1 / (1 + i))).out();
        click(s, 1500, 0.5 / (1 + i), 0.006);
      });
      t += 0.1 / (1 + i * 0.6);
    }
  }),
  r('casing_heavy', { dur: 0.6, n: 3, mix: 'foley', over: { maxVoices: 3, near: 3, far: 26, volume: 0.42 } }, s => {
    const f = s.r(1100, 1400);
    let t = 0;
    for (let i = 0; i < 3; i++) {
      s.at(t, () => modal(s, { f0: f, modes: MODES.pipe, decay: 0.11, level: 1 / (1 + i * 0.7), strike: 0.6 }));
      t += 0.16 / (1 + i * 0.4);
    }
  }),

  r('sword_block', { dur: 0.35, mix: 'player' }, s => {
    s.noise('pink', 0.18).bp([[0, 700], [0.15, 1700]], 1).env(perc(0.13, 0.6, 0.015)).out();
    s.at(0.1, () => modal(s, { f0: 2500, modes: MODES.bar, decay: 0.14, level: 0.5, strike: 0.3 }));
  }),
  r('sword_deflect', { dur: 0.6, n: 3, mix: 'player', over: { volume: 0.55, priority: 7, perFrame: 2, pitchJitter: 0.08 }, expect: { attackMs: [0, 8], centroid: [1800, 11000] } }, s => {
    modal(s, { f0: s.r(2300, 3100), modes: MODES.bar, decay: 0.4, level: 0.8, strike: 1 });
    s.grains(0.25, t => 260 * Math.exp(-t * 15), 0.001).hp(4200).out(1);
  }),
  r('sword_windup', { dur: 0.7, mix: 'player', expect: { trend: 1 } }, s => {
    s.noise('white', 0.68).bp([[0, 700], [0.65, 5400]], 4).env([[0, 0.0001], [0.62, 1], [0.68, 0.0001]]).out(0.9);
    s.osc('sine', [[0, 260], [0.65, 1650]], 0.68).env([[0, 0.0001], [0.62, 0.42], [0.68, 0.0001]]).out();
  }),
  r('sword_sweep', { dur: 0.6, mix: 'player', over: { volume: 0.62, send: 0.12 } }, s => {
    whoosh(s, { from: 380, to: 2500, dur: 0.56, q: 0.9, peakAt: 0.45 });
    whoosh(s, { from: 1400, to: 5200, dur: 0.46, q: 1.4, level: 0.5, peakAt: 0.5, color: 'white' });
  }),

  r('sentinel_fire', { dur: 0.22, n: 3, mix: 'gun', over: { volume: 0.34, maxVoices: 6, perFrame: 3, near: 8, far: 70 }, expect: { attackMs: [0, 6] } }, s => {
    laser(s, s.r(2300, 2900), s.r(420, 600), 0.14, 0.9);
    s.noise('white', 0.02).hp(3000).env(perc(0.006, 0.5)).out();
  }),
  r('sentinel_orbit_loop', { dur: 2, mix: 'loop3d', loop: true, over: { volume: 0.2, near: 3, far: 28 } }, s => {
    s.osc('sine', 164).am(s.lfo(4, 0.22)).out(0.4);
    s.osc('triangle', 328, undefined, 7).lp(1200).out(0.2);
    s.noise('pink').bp(2000, 8).am(s.wander(2, 0.5)).out(0.26);
  }),
];
