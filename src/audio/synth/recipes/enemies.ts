import { perc, swell } from '../dsl';
import { MODES, blast, clank, click, gunshot, laser, modal, radioize, thump, vox, whoosh, zap, type Vowel } from '../instruments';
import { r } from '../recipe';

const voiceBand = { centroid: [220, 4500] } as const;

export const voices = [
  r('vox_grunt', { dur: 0.3, n: 4, mix: 'voice', expect: voiceBand }, s => {
    const f = s.r(95, 135);
    vox(s, { f0: [[0, f * 1.25], [0.2, f * 0.85]], vowels: [[0, 'uh'], [0.2, 'er']], amp: perc(0.22, 1, 0.012), rough: 0.3, breath: 0.08, drive: 2 });
  }),
  r('vox_pain', { dur: 0.52, n: 4, mix: 'voice', over: { volume: 0.6 }, expect: voiceBand }, s => {
    const f = s.r(150, 215);
    const v: Vowel = s.rng() < 0.5 ? 'a' : 'ae';
    vox(s, { f0: [[0, f], [0.07, f * 1.42], [0.45, f * 0.8]], vowels: [[0, v], [0.42, 'uh']], amp: perc(0.42, 1, 0.012), rough: 0.46, breath: 0.1, drive: 3, jitter: 50 });
  }),
  r('vox_scream', { dur: 1.1, n: 4, mix: 'voice', over: { volume: 0.62, priority: 4 }, expect: { centroid: [500, 5500] } }, s => {
    const f = s.r(430, 640);
    vox(s, {
      f0: [[0, f * 0.7], [0.08, f * 1.25], [0.68, f * 1.1], [1.05, f * 0.6]], vowels: [[0, 'ae'], [0.3, 'a'], [1, 'e']],
      amp: swell(0.025, 1.08, 0.5, 1), rough: 0.7, breath: 0.18, drive: 5, jitter: 90, vibrato: 35, tract: 1.15,
    });
  }),
  r('vox_death', { dur: 1.2, n: 4, mix: 'voice', over: { volume: 0.62, priority: 4 }, expect: voiceBand }, s => {
    const f = s.r(120, 190);
    vox(s, {
      f0: [[0, f * 1.6], [0.12, f * 1.45], [0.9, f * 0.55], [1.1, f * 0.4]], vowels: [[0, 'a'], [0.4, 'uh'], [0.9, 'o'], [1.1, 'u']],
      amp: perc(1, 1, 0.012), rough: 0.6, breath: 0.15, drive: 3, jitter: 65,
    });
  }),
  r('vox_alert', { dur: 0.55, n: 4, mix: 'voice', over: { volume: 0.55 }, expect: voiceBand }, s => {
    const f = s.r(125, 165);
    vox(s, { f0: [[0, f], [0.1, f * 1.45], [0.5, f * 1.2]], vowels: [[0, 'e'], [0.12, 'a'], [0.45, 'o']], amp: swell(0.02, 0.5, 0.2, 1), rough: 0.25, breath: 0.08, drive: 3 });
  }),
  r('vox_gurgle', { dur: 0.9, n: 3, mix: 'voice', expect: { centroid: [120, 3000] } }, s => {
    const f = s.r(70, 100);
    vox(s, { f0: [[0, f], [0.85, f * 0.7]], vowels: [[0, 'u'], [0.4, 'o'], [0.8, 'u']], amp: perc(0.82, 1, 0.03), rough: 0.9, breath: 0.2, sub: 0.3, jitter: 60 });
    for (let i = 0; i < 14; i++) s.at(s.r(0, 0.75), () => s.osc('sine', [[0, s.r(200, 420)], [0.03, s.r(500, 800)]], 0.04).env(perc(0.03, s.r(0.15, 0.4))).out());
  }),
  r('vox_husk_growl', { dur: 1, n: 4, mix: 'voice', expect: voiceBand }, s => {
    const f = s.r(62, 84);
    vox(s, { f0: [[0, f], [0.45, f * 1.3], [0.95, f * 0.92]], vowels: [[0, 'uh'], [0.5, 'a'], [0.95, 'er']], amp: swell(0.08, 0.98, 0.35, 1), rough: 1, breath: 0.26, sub: 0.6, drive: 3.4, tract: 0.84 });
  }),
  r('vox_husk_snarl', { dur: 0.55, n: 3, mix: 'voice', over: { volume: 0.58 }, expect: voiceBand }, s => {
    const f = s.r(180, 250);
    vox(s, { f0: [[0, f], [0.08, f * 1.4], [0.5, f * 0.85]], vowels: [[0, 'ae'], [0.48, 'er']], amp: perc(0.46, 1, 0.012), rough: 1, breath: 0.3, drive: 4.5, tract: 0.95, jitter: 75 });
  }),
  r('vox_brute_grunt', { dur: 0.48, n: 3, mix: 'voice', over: { volume: 0.68 }, expect: { centroid: [120, 2600] } }, s => {
    const f = s.r(58, 72);
    vox(s, { f0: [[0, f * 1.3], [0.4, f * 0.82]], vowels: [[0, 'uh'], [0.4, 'o']], amp: perc(0.38, 1, 0.015), rough: 0.55, sub: 0.7, breath: 0.1, drive: 3, tract: 0.72 });
  }),
  r('vox_stalker_hiss', { dur: 0.8, n: 3, mix: 'voice', over: { volume: 0.52 }, expect: { centroid: [1200, 9000] } }, s => {
    s.noise('white', 0.78).bp([[0, 3100], [0.7, 5200]], 1.3).am(s.wander(38, 0.5)).env(swell(0.05, 0.78, 0.35, 1)).out(0.9);
    s.noise('pink', 0.78).bp(1500, 5).env(swell(0.06, 0.76, 0.4, 1)).out(0.7);
    vox(s, { f0: 300, vowels: [[0, 'i']], amp: swell(0.1, 0.76, 0.3, 0.16), rough: 0.9, breath: 0.8 });
  }),
  r('vox_leaper_shriek', { dur: 0.8, n: 3, mix: 'voice', over: { volume: 0.6, priority: 5 }, expect: { centroid: [800, 7000] } }, s => {
    const f = s.r(760, 1020);
    vox(s, { f0: [[0, f * 0.55], [0.07, f * 1.25], [0.5, f], [0.78, f * 0.5]], vowels: [[0, 'ae'], [0.3, 'i'], [0.75, 'e']], amp: swell(0.014, 0.78, 0.4, 1), rough: 0.9, breath: 0.2, drive: 6, jitter: 130, tract: 1.3 });
  }),
  r('vox_bomber_cackle', { dur: 1.3, n: 2, mix: 'voice', over: { volume: 0.56, priority: 5 }, expect: voiceBand }, s => {
    const f = s.r(210, 260);
    for (let i = 0; i < 6; i++) {
      s.at(i * 0.18, () => vox(s, {
        f0: [[0, f * (1.3 - i * 0.05)], [0.14, f * (0.95 - i * 0.04)]], vowels: [[0, 'a'], [0.13, 'uh']], amp: perc(0.14, 1 - i * 0.08, 0.008), rough: 0.5, breath: 0.2, drive: 3,
      }));
    }
  }),
  // A rebreather: rasping noise shaped into slow breath cycles.
  r('vox_burner_breath', { dur: 1.3, n: 2, mix: 'voice', over: { volume: 0.4, near: 4, far: 30 }, expect: { centroid: [400, 5000] } }, s => {
    s.noise('pink', 0.6).bp([[0, 900], [0.55, 1600]], 3).am(s.wander(50, 0.4)).env(swell(0.14, 0.58, 0.24, 1)).out();
    s.at(0.66, () => s.noise('pink', 0.6).bp([[0, 1500], [0.55, 700]], 3).am(s.wander(60, 0.6)).env(swell(0.1, 0.58, 0.28, 0.75)).out());
  }),
  r('vox_warden_chant', { dur: 1.7, n: 2, mix: 'voice', over: { volume: 0.5, send: 0.3 }, expect: voiceBand }, s => {
    const notes = [98, 110.0, 82.4];
    notes.forEach((f, i) => {
      s.at(i * 0.5, () => {
        vox(s, { f0: f, vowels: [[0, 'o'], [0.3, 'u']], amp: swell(0.06, 0.55, 0.2, 1), rough: 0.1, sub: 0.25, breath: 0.08, vibrato: 12, tract: 0.9 });
        vox(s, { f0: f * 1.5, vowels: [[0, 'o'], [0.3, 'u']], amp: swell(0.06, 0.55, 0.2, 0.42), rough: 0.1, vibrato: 12, tract: 1 });
      });
    });
  }),
  r('vox_juggernaut_roar', { dur: 1.8, n: 2, mix: 'voiceBig', expect: { centroid: [120, 2600] } }, s => {
    const f = s.r(46, 56);
    vox(s, { f0: [[0, f * 0.9], [0.32, f * 1.6], [1.4, f * 1.05]], vowels: [[0, 'o'], [0.4, 'a'], [1.4, 'uh']], amp: swell(0.09, 1.75, 0.8, 1), rough: 1, sub: 1, breath: 0.3, drive: 4.5, tract: 0.62, jitter: 70 });
    s.noise('brown', 1.6).lp(420).env(swell(0.1, 1.55, 0.7, 1)).gain(1.6).out(0.7);
  }),
  r('vox_radio', { dur: 1.1, n: 4, mix: 'voice', over: { volume: 0.42, send: 0.05 }, expect: { centroid: [500, 3400] } }, s => {
    const bus = s.sum();
    const syllables = 3 + Math.floor(s.r(0, 3));
    const vowels: Vowel[] = ['a', 'e', 'o', 'uh', 'i'];
    let t = 0.07;
    const f = s.r(105, 135);
    for (let i = 0; i < syllables; i++) {
      const len = s.r(0.09, 0.2);
      const v1 = vowels[Math.floor(s.r(0, vowels.length))]!;
      const v2 = vowels[Math.floor(s.r(0, vowels.length))]!;
      s.at(t, () => vox(s, {
        f0: [[0, f * s.r(1, 1.3)], [len, f * s.r(0.8, 1)]], vowels: [[0, v1], [len, v2]], amp: swell(0.01, len, len * 0.5, 1),
        rough: 0.2, breath: 0.1, drive: 2, into: bus,
      }));
      t += len + s.r(0.02, 0.09);
    }
    s.noise('white', t + 0.05).gain(0.03).to(bus);
    radioize(bus).out();
    // Squelch at both ends: the key-up and key-down are what make it read as a radio.
    s.noise('white', 0.03).hp(1800).env(perc(0.02, 0.6)).out();
    s.at(t + 0.02, () => { s.noise('white', 0.05).bp(2400, 1).env(perc(0.035, 0.8)).out(); click(s, 1400, 0.5); });
  }),
  r('vox_choke', { dur: 0.95, n: 2, mix: 'voice', expect: { centroid: [150, 3000] } }, s => {
    const f = s.r(100, 130);
    for (let i = 0; i < 4; i++) {
      s.at(i * 0.21 + s.r(0, 0.03), () => vox(s, { f0: [[0, f * 1.2], [0.14, f * 0.85]], vowels: [[0, 'er'], [0.13, 'u']], amp: perc(0.14, 1 - i * 0.16, 0.01), rough: 0.9, breath: 0.25, drive: 2.5 }));
    }
  }),
];

export const enemyGear = [
  // The bang took the hearing and left this. Two sines just apart, so it beats and never quite settles.
  r('ear_ring', { dur: 5.5, mix: 'enemyFx', over: { volume: 0.5, priority: 9, exempt: true, family: undefined } }, s => {
    s.osc('sine', [[0, 3340], [5.5, 3160]], 5.5).env([[0, 0.0001], [0.04, 1], [3, 0.7], [5.5, 0.0001]]).out(0.7);
    s.osc('sine', [[0, 3352], [5.5, 3171]], 5.5).env([[0, 0.0001], [0.04, 0.5], [3, 0.35], [5.5, 0.0001]]).out(0.4);
  }),
  r('enemy_pistol', { dur: 0.55, n: 3, mix: 'enemyGun', expect: { attackMs: [0, 6] } }, s => {
    gunshot(s, { crack: 0.9, crackHp: 2100, body: 1050, bodyDecay: 0.07, sub: 0.45, subFreq: 125, subDecay: 0.08, tail: 0.26, tailDecay: 0.42, drive: 3 });
  }),
  r('enemy_smg', { dur: 0.32, n: 3, mix: 'enemyGun', expect: { attackMs: [0, 6] } }, s => {
    gunshot(s, { crack: 0.8, crackHp: 2800, body: 1320, bodyDecay: 0.05, sub: 0.34, subFreq: 145, subDecay: 0.05, tail: 0.14, tailDecay: 0.22, drive: 3 });
  }),
  r('enemy_shotgun', { dur: 1, n: 2, mix: 'enemyGun', over: { volume: 0.58, maxVoices: 3 }, expect: { attackMs: [0, 6] } }, s => {
    gunshot(s, { crack: 0.7, crackHp: 1500, body: 560, bodyDecay: 0.13, sub: 0.85, subFreq: 88, subDecay: 0.18, tail: 0.4, tailDecay: 0.7, drive: 4 });
  }),
  r('enemy_minigun_loop', { dur: 0.8, mix: 'loop3d', loop: true, seam: 0.1, over: { volume: 0.5, near: 10, far: 130, send: 0.2 } }, s => {
    const n = Math.ceil(1 * s.sr);
    const train = new Float32Array(n);
    const step = Math.round(0.04 * s.sr);
    for (let i = 0; i < n; i += step) for (let j = 0; j < 120 && i + j < n; j++) train[i + j] = (1 - j / 120) * (s.rng() * 2 - 1);
    const shots = s.samples(train);
    shots.fork().bp(1050, 0.8).drive(4).out(0.9);
    shots.fork().lp(210).gain(4).drive(3).out(0.75);
    s.osc('sawtooth', 200).lp(2400).out(0.09);
  }),
  r('enemy_rocket_fire', { dur: 1, mix: 'enemyGun', over: { volume: 0.6, priority: 7, near: 10, far: 160, family: undefined }, expect: { attackMs: [0, 14] } }, s => {
    thump(s, 76, 0.16, 0.9, 2.5);
    s.noise('pink', 0.9).bp([[0, 1100], [0.8, 420]], 0.7).env(perc(0.75, 1, 0.002)).drive(3).out();
    s.noise('white', 0.45).hp(2800).env(perc(0.34, 0.4, 0.002)).out();
  }),
  r('sniper_charge', { dur: 1.5, mix: 'enemyFx', over: { volume: 0.56, priority: 7, near: 16, far: 200, exempt: true }, expect: { trend: 1 } }, s => {
    s.osc('sine', [[0, 640], [1.45, 3100]], 1.5).am(s.lfo([[0, 6], [1.45, 34]], 0.5)).env([[0, 0.05], [1.4, 0.72], [1.5, 0.0001]]).out(0.7);
    s.osc('triangle', [[0, 320], [1.45, 1550]], 1.5).env([[0, 0.02], [1.4, 0.32], [1.5, 0.0001]]).out(0.7);
  }),
  r('sniper_fire', { dur: 1.8, mix: 'enemyGun', over: { volume: 0.85, priority: 8, near: 24, far: 320, send: 0.42, family: undefined, airDelay: true }, expect: { attackMs: [0, 6] } }, s => {
    gunshot(s, { crack: 1, crackHp: 2500, body: 780, bodyDecay: 0.1, sub: 0.8, subFreq: 68, subDecay: 0.2, tail: 0.65, tailDecay: 1.5, drive: 5 });
    s.at(0.1, () => s.noise('brown', 1.3).lp(420).env(perc(1.1, 1)).gain(1.5).out(0.6));
  }),
  r('sniper_laser_loop', { dur: 1, mix: 'loop3d', loop: true, over: { volume: 0.2, near: 5, far: 50 } }, s => {
    s.osc('sine', 2200).am(s.lfo(9, 0.25)).out(0.2);
    s.osc('sine', 2203).out(0.16);
    s.noise('white').bp(5400, 12).out(0.12);
  }),

  r('enemy_swing', { dur: 0.32, n: 3, mix: 'enemyFx', over: { maxVoices: 4 } }, s => whoosh(s, { from: s.r(320, 520), to: s.r(1500, 2100), dur: 0.3, q: 1.1, peakAt: 0.55 })),
  r('enemy_lunge', { dur: 0.42, n: 2, mix: 'enemyFx' }, s => {
    whoosh(s, { from: 280, to: 1600, dur: 0.4, q: 0.9, peakAt: 0.6 });
    s.at(0.02, () => thump(s, 96, 0.07, 0.5, 2));
  }),
  r('enemy_blade', { dur: 0.38, n: 3, mix: 'enemyFx', over: { maxVoices: 3 }, expect: { centroid: [1200, 10000] } }, s => {
    s.noise('white', 0.32).bp([[0, 1900], [0.2, 6400]], 3).env(perc(0.22, 0.9, 0.02)).out();
    s.at(0.13, () => modal(s, { f0: s.r(2600, 3400), modes: MODES.bar, decay: 0.1, level: 0.3, strike: 0.2 }));
  }),
  r('riot_shield_hit', { dur: 0.4, n: 3, mix: 'impact', over: { volume: 0.52, near: 7, far: 80 } }, s => {
    modal(s, { f0: s.r(520, 760), modes: MODES.barrel, decay: 0.15, level: 0.8, strike: 1 });
    thump(s, 130, 0.07, 0.7, 2);
  }),
  r('riot_shield_break', { dur: 1, mix: 'enemyFx', over: { volume: 0.66 } }, s => {
    s.noise('white', 0.05).hp(1900).env(perc(0.02, 1)).drive(4).out();
    modal(s, { f0: 420, modes: MODES.barrel, decay: 0.32, level: 0.8, strike: 0.7 });
    for (let i = 0; i < 6; i++) s.at(s.r(0.02, 0.5), () => clank(s, s.r(900, 2400), s.r(0.14, 0.34), 0.05));
    thump(s, 90, 0.12, 0.8, 2);
  }),
  r('warden_shield_up', { dur: 0.8, mix: 'enemyFx', expect: { trend: 1 } }, s => {
    s.fm([[0, 200], [0.7, 820]], 2, [[0, 90], [0.7, 900]], 0.78).env(swell(0.05, 0.76, 0.3, 0.75)).out();
    s.noise('white', 0.7).bp([[0, 700], [0.6, 4000]], 3).env(swell(0.1, 0.7, 0.3, 0.4)).out();
  }),
  r('warden_shield_loop', { dur: 2, mix: 'loop3d', loop: true, over: { volume: 0.3, maxVoices: 3 } }, s => {
    s.osc('sawtooth', 82).lp(900, 3).am(s.lfo(3, 0.2)).out(0.34);
    s.osc('sine', 410).am(s.lfo(6, 0.3)).out(0.18);
    s.osc('sine', 412).out(0.1);
    s.grains(2.6, () => 22, 0.0012).hp(3200).out(0.3);
  }),
  r('warden_buff', { dur: 0.7, mix: 'enemyFx', over: { maxVoices: 2 } }, s => {
    [392, 523, 659].forEach((f, i) => s.at(i * 0.08, () => s.fm(f, 2, [[0, f], [0.4, 30]], 0.45).env(perc(0.4, 0.6, 0.004)).out()));
  }),
  r('bomber_beep', { dur: 0.16, mix: 'enemyFx', over: { volume: 0.4, pitchJitter: 0, maxVoices: 3, near: 8, far: 45 }, expect: { centroid: [1300, 5500] } }, s => {
    s.osc('square', 1870, 0.1).lp(5200).env(swell(0.002, 0.1, 0.02, 0.8)).out();
  }),
  r('bomber_tank_hiss_loop', { dur: 1.5, mix: 'loop3d', loop: true, over: { volume: 0.3, maxVoices: 3, near: 4, far: 35 } }, s => {
    s.noise('white').bp(5600, 0.9).am(s.wander(14, 0.3)).out(0.6);
    s.noise('pink').bp(1500, 3).out(0.3);
  }),
  r('burner_flame_loop', { dur: 2.2, mix: 'loop3d', loop: true, over: { volume: 0.5, maxVoices: 3, near: 8, far: 80 } }, s => {
    s.noise('pink').lp(1500).sweep(s.wander(3, 400)).am(s.wander(9, 0.34)).out(0.7);
    s.noise('brown').lp(360).gain(1.8).am(s.wander(5, 0.4)).out(0.7);
    s.grains(3, () => 30, 0.0025).bp(1500, 1.6).out(1);
  }),
  r('enemy_spawn', { dur: 0.9, mix: 'enemyFx', over: { maxVoices: 3, perFrame: 1, near: 8, far: 60 } }, s => {
    whoosh(s, { from: 2400, to: 300, dur: 0.6, q: 1.1, peakAt: 0.3 });
    s.at(0.32, () => { thump(s, 88, 0.14, 1, 2.2); s.noise('pink', 0.2).lp(1400).env(perc(0.13, 0.6)).out(); });
  }),
  r('armor_plate_off', { dur: 0.62, n: 3, mix: 'impact', over: { volume: 0.56, priority: 6, family: undefined }, expect: { attackMs: [0, 8] } }, s => {
    clank(s, s.r(620, 880), 1, 0.13);
    s.at(s.r(0.17, 0.27), () => clank(s, s.r(1000, 1400), 0.35, 0.07));
    s.at(s.r(0.34, 0.42), () => clank(s, s.r(1200, 1700), 0.2, 0.05));
  }),
  r('leaper_pounce', { dur: 0.55, mix: 'enemyFx' }, s => {
    click(s, 1100, 0.5);
    whoosh(s, { from: 400, to: 2400, dur: 0.48, q: 1.1, peakAt: 0.55 });
  }),
  r('leaper_cling', { dur: 0.26, mix: 'enemyFx', over: { volume: 0.34 } }, s => {
    for (let i = 0; i < 3; i++) s.at(i * 0.055, () => click(s, s.r(1300, 2100), 0.8 - i * 0.2, 0.01));
  }),

  // Machines. Rotor frequency is a whole number per loop so blade pulses wrap cleanly.
  r('drone_rotor_loop', { dur: 1, mix: 'loop3d', loop: true, over: { volume: 0.34, maxVoices: 5, near: 7, far: 80, family: 'rotor', familyMax: 6 } }, s => {
    s.osc('sawtooth', 112).lp(1500).am(s.lfo(56, 0.42)).out(0.36);
    s.osc('sawtooth', 171).lp(1200).am(s.lfo(57, 0.3)).out(0.24);
    s.noise('pink').bp(780, 1).am(s.lfo(56, 0.72)).out(0.5);
    s.noise('white').bp(3800, 2).out(0.05);
  }),
  r('drone_gun', { dur: 0.25, n: 3, mix: 'enemyGun', over: { volume: 0.36 }, expect: { attackMs: [0, 6] } }, s => {
    gunshot(s, { crack: 0.7, crackHp: 3200, body: 1700, bodyDecay: 0.035, sub: 0.2, subFreq: 170, subDecay: 0.04, drive: 3 });
    laser(s, 1900, 800, 0.05, 0.25);
  }),
  r('drone_alert', { dur: 0.42, mix: 'enemyFx' }, s => {
    s.osc('square', 1240, 0.1).lp(4400).env(swell(0.002, 0.09, 0.02, 0.7)).out();
    s.at(0.13, () => s.osc('square', 1660, 0.2).lp(4400).env(swell(0.002, 0.18, 0.05, 0.7)).out());
  }),
  r('drone_crash', { dur: 1.7, mix: 'blastSmall', over: { volume: 0.6, airDelay: false }, expect: { attackMs: [0, 8] } }, s => {
    clank(s, 480, 1, 0.26);
    thump(s, 72, 0.22, 1, 2.2);
    s.noise('white', 0.05).hp(1700).env(perc(0.02, 0.9)).drive(4).out();
    for (let i = 0; i < 9; i++) s.at(s.r(0.02, 1), () => clank(s, s.r(900, 2900), s.r(0.1, 0.36), 0.05));
    s.osc('sawtooth', [[0, 170], [0.65, 18]], 0.7).lp(1200).env(perc(0.6, 0.3)).out();
  }),
  r('skitter_legs_loop', { dur: 1, mix: 'loop3d', loop: true, over: { volume: 0.26, maxVoices: 3, near: 3, far: 30, family: 'skitter', familyMax: 4 } }, s => {
    s.grains(1.4, () => 70, 0.0014).bp(3000, 3).drive(1.6).out(1.5);
    s.grains(1.4, () => 26, 0.002).bp(1400, 2).out(1);
    s.osc('sawtooth', 62).lp(400).out(0.06);
  }),
  r('skitter_step', { dur: 0.09, n: 4, mix: 'machine', over: { volume: 0.18, maxVoices: 3, near: 3, far: 26 }, expect: { attackMs: [0, 8], centroid: [1000, 9000] } }, s => click(s, s.r(1800, 3400), 1, 0.006)),
  r('skitter_chirp', { dur: 0.28, n: 3, mix: 'machine', over: { volume: 0.36, maxVoices: 3, near: 6, far: 50 } }, s => {
    const f = s.r(1200, 2100);
    const hops = 3 + Math.floor(s.r(0, 3));
    for (let i = 0; i < hops; i++) s.at(i * 0.04, () => s.osc('square', [[0, f * s.r(0.9, 1.3)], [0.03, f * s.r(0.7, 1.1)]], 0.035).lp(5000).env(perc(0.03, 0.6)).out());
  }),
  r('skitter_explode', { dur: 1.2, n: 2, mix: 'blastSmall', over: { volume: 0.55 }, expect: { attackMs: [0, 12] } }, s => {
    blast(s, { size: 0.36, crackle: 0.55, tail: 0.15, bright: 8500 });
    for (let i = 0; i < 5; i++) s.at(s.r(0.02, 0.4), () => clank(s, s.r(1400, 3300), s.r(0.1, 0.3), 0.04));
  }),

  r('juggernaut_step', { dur: 0.8, n: 3, mix: 'giantStep', over: { volume: 0.66, near: 12, far: 140, send: 0.18 }, expect: { minSub: 0.18 } }, s => {
    thump(s, 46, 0.32, 1, 2.6);
    s.noise('brown', 0.3).lp(800).env(perc(0.2, 0.9)).gain(1.4).out();
    clank(s, s.r(240, 310), 0.34, 0.14);
  }),
  r('juggernaut_charge', { dur: 1.3, mix: 'voiceBig', over: { volume: 0.75 } }, s => {
    vox(s, { f0: [[0, 48], [1.1, 95]], vowels: [[0, 'o'], [1.2, 'a']], amp: swell(0.1, 1.28, 0.3, 1), rough: 1, sub: 1, drive: 4, tract: 0.65 });
    s.noise('pink', 1.28).bp([[0, 300], [1.2, 1400]], 1).env([[0, 0.0001], [1.15, 0.75], [1.28, 0.0001]]).out();
  }),
  r('juggernaut_slam', { dur: 2.1, mix: 'blast', over: { volume: 0.9, airDelay: false }, expect: { attackMs: [0, 8], minSub: 0.12 } }, s => {
    blast(s, { size: 0.72, crackle: 0.7, tail: 0.5, bright: 3600 });
    clank(s, 210, 0.7, 0.3);
  }),
  r('juggernaut_armor_break', { dur: 1.3, mix: 'blastSmall', over: { volume: 0.72, airDelay: false }, expect: { attackMs: [0, 8] } }, s => {
    clank(s, 320, 1, 0.34);
    s.noise('white', 0.06).hp(1600).env(perc(0.025, 1)).drive(4).out();
    thump(s, 66, 0.22, 1, 2.4);
    for (let i = 0; i < 9; i++) s.at(s.r(0.02, 0.8), () => clank(s, s.r(620, 2100), s.r(0.14, 0.4), 0.07));
  }),

  // Titan. It is 7 m tall, so the sub carries the weight and the tails take their time.
  r('titan_step', { dur: 1.7, n: 3, mix: 'giantStep', expect: { minSub: 0.25, centroid: [25, 700] } }, s => {
    s.osc('sine', [[0, 96], [0.05, 38], [1.2, 22]], 1.5).env(perc(1.2, 1, 0.002)).drive(2.6).out();
    s.noise('brown', 0.7).lp([[0, 900], [0.5, 150]]).env(perc(0.5, 1, 0.002)).gain(2).drive(2).out();
    s.grains(1.3, t => 100 * Math.exp(-t * 3.6) + 2, 0.004, t => 1 - t / 1.4).bp(800, 0.8).out(0.8);
    clank(s, 150, 0.3, 0.4);
  }),
  r('titan_roar', { dur: 3.6, n: 2, mix: 'voiceBig', over: { volume: 1, priority: 9, duck: [0.55, 3], send: 0.42, near: 40, far: 500 }, expect: { centroid: [120, 2500] } }, s => {
    const f = s.r(30, 37);
    const amp = swell(0.22, 3.5, 1.6, 1);
    vox(s, { f0: [[0, f * 0.82], [0.7, f * 1.65], [2.2, f * 1.3], [3.4, f * 0.66]], vowels: [[0, 'o'], [0.7, 'a'], [2.2, 'ae'], [3.4, 'uh']], amp, rough: 1, sub: 1.2, breath: 0.4, drive: 5, tract: 0.5, jitter: 85 });
    vox(s, { f0: [[0, f * 1.64], [0.7, f * 3.3], [2.2, f * 2.6], [3.4, f * 1.3]], vowels: [[0, 'o'], [0.7, 'a'], [2.2, 'e'], [3.4, 'u']], amp: swell(0.3, 3.4, 1.6, 0.42), rough: 0.9, drive: 3, tract: 0.72, jitter: 120 });
    s.noise('brown', 3.4).lp(320).am(s.wander(9, 0.4)).env(amp).gain(1.6).out(0.9);
  }),
  r('titan_stomp', { dur: 2.6, mix: 'blast', over: { volume: 1, airDelay: false, near: 30, duck: [0.45, 0.8] }, expect: { attackMs: [0, 8], minSub: 0.2 } }, s => {
    blast(s, { size: 1.05, crackle: 0.85, tail: 0.7, bright: 3000 });
    thump(s, 34, 0.9, 1, 2.6);
  }),
  r('titan_limb_break', { dur: 2.2, mix: 'blast', over: { volume: 0.95, duck: [0.45, 1], airDelay: false }, expect: { attackMs: [0, 8] } }, s => {
    clank(s, 180, 1, 0.5);
    s.noise('white', 0.08).hp(1000).env(perc(0.03, 1)).drive(5).out();
    thump(s, 42, 0.6, 1, 3);
    for (let i = 0; i < 10; i++) s.at(s.r(0.02, 1.2), () => clank(s, s.r(300, 1800), s.r(0.16, 0.45), 0.09));
    s.grains(1.6, t => 90 * Math.exp(-t * 2) + 6, 0.003, t => 1 - t / 1.8).bp(1300, 1).out(1);
  }),
  r('titan_fall', { dur: 4.4, mix: 'blastHuge', over: { volume: 0.95, near: 40 }, expect: { minSub: 0.15 } }, s => {
    s.osc('sawtooth', [[0, 60], [1.2, 28]], 1.3).lp(500).env(swell(0.2, 1.2, 0.2, 0.55)).out();
    s.at(1.15, () => blast(s, { size: 1.8, crack: 0.8, crackle: 1, tail: 0.9, bright: 3000 }));
    for (let i = 0; i < 12; i++) s.at(s.r(1.2, 3.2), () => clank(s, s.r(180, 1300), s.r(0.1, 0.34), 0.13));
  }),
  r('titan_charge', { dur: 2.6, mix: 'enemyFx', over: { volume: 0.85, priority: 8, near: 40, far: 400, exempt: true, send: 0.3 }, expect: { trend: 1 } }, s => {
    s.osc('sawtooth', [[0, 44], [2.5, 330]], 2.6).lp([[0, 300], [2.5, 3200]], 3).env([[0, 0.05], [2.45, 0.8], [2.6, 0.0001]]).out();
    s.noise('pink', 2.6).bp([[0, 200], [2.5, 3400]], 2.4).env([[0, 0.02], [2.4, 0.8], [2.6, 0.0001]]).out();
    s.grains(2.6, t => 6 + t * 70, 0.002, t => 0.08 + t * 0.34).hp(2600).out(0.7);
  }),
  r('titan_beam_loop', { dur: 2, mix: 'loop3d', loop: true, over: { volume: 0.72, priority: 8, maxVoices: 2, near: 30, far: 320, send: 0.3 } }, s => {
    s.osc('sawtooth', 55).drive(3).hp(130).lp(1800, 3).am(s.lfo(9, 0.2)).out(0.55);
    s.osc('sawtooth', 83).hp(150).lp(2200, 2).am(s.lfo(13, 0.2)).out(0.34);
    s.osc('sine', 55).out(0.22);
    s.noise('pink').bp(2000, 1.1).am(s.wander(22, 0.4)).out(0.9);
    s.grains(2.6, () => 110, 0.0012).hp(2800).out(0.5);
  }),
];
