import { perc } from '../dsl';
import { MODES, blast, bubble, clank, modal, slap, snap, thump, wetBurst, whoosh, zap } from '../instruments';
import { r } from '../recipe';

/** Every impact starts with the attack on sample one, the same frame as the particle burst. */
const sharp = { attackMs: [0, 8] } as const;

export const impacts = [
  r('impact_concrete', { dur: 0.42, n: 4, mix: 'impact', expect: { ...sharp, centroid: [500, 4500] } }, s => {
    s.noise('white', 0.04).bp(s.r(1700, 2500), 1.1).env(perc(0.012, 1)).drive(2).lp(6500).out();
    s.osc('sine', [[0, 340], [0.04, 130]], 0.08).env(perc(0.05, 0.9)).out();
    s.noise('pink', 0.3).bp(s.r(1100, 1500), 0.8).env(perc(0.16, 0.42, 0.004)).out();
    s.grains(0.32, t => 300 * Math.exp(-t * 14), 0.0015, t => 1 - t * 2.4).bp(2600, 0.9).out(0.8);
  }),
  r('impact_metal', { dur: 0.5, n: 4, mix: 'impact', expect: { ...sharp, centroid: [1200, 9000] } }, s => {
    modal(s, { f0: s.r(1500, 2600), decay: 0.2, level: 0.85, strike: 1, damping: 0.8 });
    s.noise('white', 0.03).hp(2600).env(perc(0.01, 0.8)).drive(3).out();
  }),
  r('impact_grate', { dur: 0.5, n: 4, mix: 'impact', expect: sharp }, s => {
    modal(s, { f0: s.r(900, 1500), modes: MODES.barrel, decay: 0.16, level: 0.7, strike: 0.9, spread: 0.03 });
    s.grains(0.34, t => 380 * Math.exp(-t * 9), 0.002, t => 1 - t * 2.6).bp(s.r(1800, 2800), 3).drive(2).out(1.3);
  }),
  r('impact_dirt', { dur: 0.36, n: 4, mix: 'impact', expect: { ...sharp, centroid: [150, 2500] } }, s => {
    s.osc('sine', [[0, 240], [0.05, 90]], 0.1).env(perc(0.06, 1)).out();
    s.noise('brown', 0.22).lp(1500).env(perc(0.11, 1)).gain(1.6).out();
    s.grains(0.3, t => 170 * Math.exp(-t * 13), 0.003, t => 1 - t * 3).bp(900, 1).out(0.8);
  }),
  r('impact_glass', { dur: 0.6, n: 4, mix: 'impact', expect: { ...sharp, centroid: [2500, 12000] } }, s => {
    modal(s, { f0: s.r(3000, 4200), modes: MODES.glass, decay: 0.12, level: 0.7, strike: 0.9 });
    s.grains(0.5, t => 340 * Math.exp(-t * 8), 0.0008, t => 1 - t * 1.8).hp(4500).out(1.2);
  }),
  r('impact_flesh', { dur: 0.34, n: 4, mix: 'gore', over: { maxVoices: 5, volume: 0.5 }, expect: { ...sharp, centroid: [150, 3000] } }, s => {
    slap(s, 1, s.r(800, 1200));
    wetBurst(s, 8, 0.16, 460, 0.45);
  }),
  r('impact_armor', { dur: 0.42, n: 4, mix: 'impact', over: { volume: 0.5, priority: 5 }, expect: sharp }, s => {
    clank(s, s.r(980, 1420), 1, 0.11);
    thump(s, 150, 0.07, 0.6, 2);
    s.grains(0.18, t => 220 * Math.exp(-t * 18), 0.001).hp(3600).out(0.7);
  }),
  r('impact_energy', { dur: 0.36, n: 4, mix: 'impact', expect: sharp }, s => {
    zap(s, 0.17, 0.75, s.r(160, 240));
    s.osc('sine', [[0, 2500], [0.2, 800]], 0.22).env(perc(0.18, 0.5)).out();
  }),
  r('impact_lava', { dur: 0.6, n: 4, mix: 'impact', expect: { attackMs: [0, 40] } }, s => {
    s.osc('sine', [[0, 150], [0.08, 70]], 0.14).env(perc(0.1, 0.7, 0.002)).out();
    wetBurst(s, 12, 0.32, 240, 0.8);
    s.noise('white', 0.5).hp(3800).env(perc(0.4, 0.3, 0.01)).out();
  }),

  r('ricochet', { dur: 0.7, n: 4, mix: 'impact', over: { maxVoices: 4, volume: 0.36, near: 6, far: 70 }, expect: { trend: -1 } }, s => {
    const f = s.r(2800, 4600);
    s.noise('white', 0.03).hp(2400).env(perc(0.008, 1)).drive(2).out();
    s.osc('sine', [[0, f], [0.06, f * 0.72], [0.55, f * s.r(0.26, 0.4)]], 0.6).detune(s.lfo(s.r(16, 30), 50))
      .env([[0, 0.0001], [0.012, 0.7], [0.58, 0.0001]]).out();
  }),
  r('bullet_flyby', { dur: 0.4, n: 3, mix: 'enemyFx', over: { maxVoices: 3, volume: 0.42, send: 0.02, near: 6, far: 16 }, expect: { trend: -1 } }, s => {
    whoosh(s, { from: s.r(3300, 4400), to: 620, dur: 0.36, q: 2.2, peakAt: 0.3, color: 'white' });
    s.at(0.09, () => s.noise('white', 0.02).hp(3400).env(perc(0.006, 0.34)).out());
  }),

  r('explosion_barrel', { dur: 3.1, n: 2, mix: 'blast', expect: { attackMs: [0, 6], minSub: 0.08 } }, s => {
    blast(s, { size: 1.05, crackle: 0.7, tail: 0.6 });
    s.at(0.01, () => modal(s, { f0: s.r(240, 300), modes: MODES.barrel, decay: 0.6, level: 0.5, strike: 0 }));
  }),
  r('explosion_tank', { dur: 4.4, mix: 'blast', over: { volume: 1, duck: [0.5, 1.2] }, expect: { attackMs: [0, 12], minSub: 0.1 } }, s => {
    blast(s, { size: 1.5, crack: 1.4, crackle: 0.8, tail: 0.8, bright: 5200 });
    // The tank's second rupture, well under the first so the hit still peaks on frame one.
    s.at(0.16, () => blast(s, { size: 0.7, crack: 0.3, fireball: 0.35, sub: 0.3, crackle: 0.4, tail: 0 }));
    s.at(0.02, () => modal(s, { f0: 128, modes: MODES.barrel, decay: 1.1, level: 0.5, strike: 0 }));
  }),
  r('explosion_small', { dur: 1.5, n: 3, mix: 'blastSmall', expect: { attackMs: [0, 6] } }, s => {
    blast(s, { size: 0.45, crackle: 0.5, tail: 0.3 });
  }),
  // Far away only the lows survive, and the sky keeps talking after the blast.
  r('explosion_distant', { dur: 3.2, n: 2, mix: 'blast', over: { volume: 0.55, duck: undefined, near: 30, far: 600 }, expect: { centroid: [30, 700] } }, s => {
    s.noise('brown', 1.6).lp([[0, 620], [1.4, 150]]).env(perc(1.2, 1, 0.012)).gain(2.2).out();
    s.osc('sine', [[0, 72], [1.5, 30]], 1.8).env(perc(1.5, 0.75, 0.01)).out();
    s.at(0.5, () => s.noise('brown', 2.5).lp(240).am(s.wander(3, 0.6)).env(perc(2.3, 1, 0.3)).gain(2).out(0.6));
  }),
  r('explosion_debris', { dur: 1.7, n: 3, mix: 'impact', over: { volume: 0.36, maxVoices: 3, near: 8, far: 80, family: undefined }, expect: { attackMs: [0, 1000] } }, s => {
    s.grains(1.6, t => 34 * Math.exp(-t * 1.5) + 3, 0.003, t => 1 - t / 1.7).bp(s.r(1400, 2300), 1.4).drive(2).out(1.5);
    for (let i = 0; i < 6; i++) s.at(s.r(0.05, 1.2), () => clank(s, s.r(900, 2800), s.r(0.1, 0.34), 0.05));
    for (let i = 0; i < 3; i++) s.at(s.r(0.2, 1), () => thump(s, s.r(90, 170), 0.07, s.r(0.2, 0.45), 2));
  }),

  r('glass_break', { dur: 1.2, n: 3, mix: 'impact', over: { volume: 0.52, family: undefined }, expect: { attackMs: [0, 6], centroid: [2500, 12000] } }, s => {
    s.noise('white', 0.05).hp(2500).env(perc(0.018, 1)).drive(3).out();
    for (let i = 0; i < 9; i++) s.at(i === 0 ? 0 : s.r(0, 0.6), () => modal(s, { f0: s.r(2300, 6400), modes: MODES.glass, decay: s.r(0.05, 0.16), level: s.r(0.2, 0.55), strike: 0.3 }));
    s.grains(1.1, t => 360 * Math.exp(-t * 3.8) + 8, 0.0009, t => 1 - t / 1.2).hp(3600).out(1.3);
  }),
  r('metal_clang', { dur: 0.9, n: 4, mix: 'impact', over: { volume: 0.46, send: 0.22 }, expect: sharp }, s => {
    modal(s, { f0: s.r(340, 760), modes: MODES.plate, decay: 0.6, level: 0.9, strike: 0.7, damping: 0.84 });
    thump(s, 120, 0.09, 0.5, 2);
  }),
  r('concrete_crumble', { dur: 1.3, n: 3, mix: 'impact', over: { volume: 0.5, send: 0.2 } }, s => {
    s.noise('brown', 0.9).lp(900).env(perc(0.7, 1, 0.03)).gain(2).out(0.8);
    s.grains(1.2, t => 110 * Math.exp(-t * 2.7) + 6, 0.004, t => 1 - t / 1.3).bp(1000, 0.8).drive(2).out(1.6);
    for (let i = 0; i < 4; i++) s.at(s.r(0, 0.5), () => thump(s, s.r(70, 130), 0.09, s.r(0.3, 0.6), 2));
  }),
];

export const bodies = [
  // Wet tear with a bone pop: the reward noise for taking a limb off.
  r('limb_sever', { dur: 0.5, n: 4, mix: 'gore', over: { volume: 0.72, priority: 6 }, expect: sharp }, s => {
    s.noise('white', 0.09).bp([[0, 4200], [0.08, 1400]], 1.4).env(perc(0.06, 0.8, 0.0006)).drive(2).out();
    slap(s, 0.9, 950);
    snap(s, 3, 0.04, 0.7, 2400);
    s.at(0.02, () => wetBurst(s, 16, 0.3, 520, 0.6));
    s.at(0.015, () => s.noise('pink', 0.28).bp([[0, 700], [0.25, 2400]], 3).env(perc(0.2, 0.42)).out());
  }),
  r('bone_crack', { dur: 0.24, n: 4, mix: 'gore', over: { volume: 0.56 }, expect: { ...sharp, centroid: [700, 7000] } }, s => {
    snap(s, 6, 0.06, 1, 2000);
    s.osc('sine', [[0, 480], [0.03, 180]], 0.06).env(perc(0.03, 0.65)).out();
  }),
  r('gib_squelch', { dur: 0.8, n: 4, mix: 'gore', over: { volume: 0.72, priority: 6, maxVoices: 3 } }, s => {
    slap(s, 1, 700);
    thump(s, 80, 0.12, 0.85, 2.4);
    wetBurst(s, 30, 0.55, 300, 0.65);
    s.at(0.04, () => s.noise('pink', 0.42).bp([[0, 480], [0.2, 1500], [0.4, 520]], 4).env(perc(0.36, 0.7)).drive(2).out());
  }),
  r('blood_splat', { dur: 0.42, n: 4, mix: 'gore', over: { volume: 0.4, maxVoices: 4 }, expect: { attackMs: [0, 12] } }, s => {
    slap(s, 0.75, 1500);
    const drops = 8 + Math.floor(s.r(0, 6));
    for (let i = 0; i < drops; i++) {
      s.at(s.r(0, 0.26), () => s.noise('white', 0.015).bp(s.r(1400, 4200), 3).env(perc(s.r(0.003, 0.01), s.r(0.25, 0.75))).out());
    }
  }),
  r('flesh_slice', { dur: 0.42, n: 3, mix: 'gore', over: { volume: 0.68, priority: 6 }, expect: sharp }, s => {
    s.noise('white', 0.2).bp([[0, 6200], [0.15, 2000]], 2.4).env(perc(0.13, 0.9, 0.0006)).out(1.4);
    slap(s, 0.7, 1100);
    s.at(0.01, () => wetBurst(s, 12, 0.22, 620, 0.5));
  }),
  r('head_pop', { dur: 0.45, n: 3, mix: 'gore', over: { volume: 0.76, priority: 7, maxVoices: 3 }, expect: sharp }, s => {
    s.osc('sine', [[0, 620], [0.02, 170], [0.08, 80]], 0.12).env(perc(0.07, 1, 0.0004)).drive(2).out();
    snap(s, 7, 0.05, 0.9, 2700);
    s.at(0.006, () => { slap(s, 0.8, 1300); wetBurst(s, 18, 0.3, 700, 0.55); });
  }),
  r('body_thud', { dur: 0.38, n: 4, mix: 'body', expect: { centroid: [60, 1500] } }, s => {
    thump(s, s.r(66, 92), 0.15, 1, 2.3);
    s.noise('pink', 0.09).lp(900).env(perc(0.05, 0.6)).out();
    s.at(s.r(0.05, 0.1), () => thump(s, s.r(90, 130), 0.07, 0.42, 1.6));
  }),
  r('gib_land', { dur: 0.22, n: 4, mix: 'body', over: { maxVoices: 3, volume: 0.32 } }, s => {
    slap(s, 0.8, s.r(700, 1300));
    for (let i = 0; i < 3; i++) s.at(s.r(0.01, 0.1), () => bubble(s, s.r(260, 700), 0.03, 0.3));
  }),
  r('blood_spurt', { dur: 0.7, n: 3, mix: 'gore', over: { volume: 0.34, maxVoices: 3 } }, s => {
    for (let i = 0; i < 4; i++) {
      s.at(i * 0.15, () => s.noise('white', 0.14).bp(s.r(2200, 3400), 1).env(perc(0.11, 1 / (1 + i * 0.4), 0.004)).out(0.7));
      s.at(i * 0.15, () => wetBurst(s, 4, 0.1, 460, 0.32));
    }
  }),
  r('frozen_shatter', { dur: 1.3, n: 3, mix: 'gore', over: { volume: 0.72, family: undefined, send: 0.24 }, expect: { attackMs: [0, 6], centroid: [1800, 12000] } }, s => {
    s.noise('white', 0.05).hp(1800).env(perc(0.02, 1)).drive(4).out();
    thump(s, 150, 0.08, 0.7, 2);
    for (let i = 0; i < 10; i++) s.at(s.r(0, 0.5), () => modal(s, { f0: s.r(1800, 5200), modes: MODES.glass, decay: s.r(0.06, 0.2), level: s.r(0.2, 0.5), strike: 0.4, damping: 0.6 }));
    s.grains(1.2, t => 300 * Math.exp(-t * 3.6) + 6, 0.0012, t => 1 - t / 1.3).hp(3000).out(1.3);
  }),
  r('freeze_crackle', { dur: 1, mix: 'enemyFx', over: { volume: 0.4 } }, s => {
    s.grains(0.95, t => 40 + 160 * t, 0.0012, t => 0.5 + t * 0.5).bp(4600, 2).drive(2).out(1.4);
    s.osc('sine', [[0, 900], [0.9, 2600]], 1).env([[0, 0.0001], [0.8, 0.14], [1, 0.0001]]).out();
  }),
  r('char_sizzle', { dur: 1.1, n: 2, mix: 'enemyFx', over: { volume: 0.32 } }, s => {
    s.noise('white', 1).bp(5400, 0.8).am(s.wander(12, 0.6)).env(perc(0.95, 0.6, 0.01)).out();
    s.grains(1, () => 55, 0.0018, t => 1 - t).bp(2300, 1.6).out(1.1);
  }),
];
