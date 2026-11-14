import { perc, swell } from '../dsl';
import { MODES, bubble, clank, click, modal, slap, thump, vox, whoosh, wind } from '../instruments';
import { r } from '../recipe';
import type { Recipe } from '../recipe';

function footstep(id: string, build: Recipe['build'], volume = 0.26): Recipe {
  return r(id, { dur: 0.22, n: 4, mix: 'step', over: { volume }, expect: { attackMs: [0, 14] } }, build);
}

export const player = [
  // Thruster burst. A short rising pitch under the air says "acceleration" without a word.
  r('dash', { dur: 0.48, n: 3, mix: 'player', over: { volume: 0.55, pitchJitter: 0.06 }, expect: { attackMs: [0, 14] } }, s => {
    whoosh(s, { from: 1500, to: 340, dur: 0.44, q: 0.75, peakAt: 0.04, level: 1.2 });
    s.osc('sawtooth', [[0, 130], [0.13, 420], [0.3, 180]], 0.32).lp(1600).env(perc(0.25, 0.42, 0.002)).out();
    s.noise('white', 0.06).hp(2800).env(perc(0.02, 0.5)).out();
    thump(s, 90, 0.08, 0.5, 2);
  }),
  r('double_jump', { dur: 0.32, mix: 'player' }, s => {
    whoosh(s, { from: 460, to: 1500, dur: 0.28, q: 1, peakAt: 0.14 });
    s.osc('sine', [[0, 220], [0.14, 500]], 0.18).env(perc(0.13, 0.32, 0.002)).out();
  }),
  r('wall_kick', { dur: 0.34, mix: 'player' }, s => {
    thump(s, 120, 0.09, 1, 2);
    click(s, 1400, 0.55);
    s.at(0.015, () => whoosh(s, { from: 600, to: 1600, dur: 0.26, q: 1, peakAt: 0.2, level: 0.75 }));
  }),
  r('wallrun_start', { dur: 0.28, mix: 'player' }, s => {
    thump(s, 150, 0.06, 0.6, 2);
    s.noise('white', 0.25).bp([[0, 1400], [0.2, 3000]], 1).env(perc(0.2, 0.75, 0.004)).out();
  }),
  r('wallrun_loop', { dur: 1.6, mix: 'loop2d', loop: true, over: { volume: 0.32 } }, s => {
    s.noise('white').bp(2800, 1.1).sweep(s.wander(4, 900)).am(s.wander(26, 0.5)).out(0.42);
    s.grains(2.2, () => 180, 0.0015).bp(3700, 2).drive(1.6).out(0.75);
    s.noise('brown').lp(240).gain(2).out(0.4);
  }),
  r('slide_start', { dur: 0.32, mix: 'player' }, s => {
    s.noise('pink', 0.3).bp([[0, 500], [0.2, 2200]], 0.8).env(perc(0.24, 1, 0.003)).out();
    thump(s, 100, 0.07, 0.5, 2);
  }),
  r('slide_loop', { dur: 1.6, mix: 'loop2d', loop: true, over: { volume: 0.34 } }, s => {
    s.noise('pink').bp(1050, 0.75).sweep(s.wander(5, 300)).am(s.wander(18, 0.3)).out(0.75);
    s.noise('brown').lp(300).gain(2.2).out(0.5);
    s.grains(2.2, () => 60, 0.0024).bp(2200, 1.2).out(0.8);
  }),
  r('slide_stop', { dur: 0.3, mix: 'player' }, s => {
    s.noise('pink', 0.27).bp([[0, 1500], [0.25, 500]], 0.8).env(perc(0.22, 0.7, 0.002)).out();
  }),
  r('slam_start', { dur: 0.38, mix: 'player', over: { volume: 0.55 }, expect: { trend: -1 } }, s => {
    whoosh(s, { from: 2600, to: 280, dur: 0.36, q: 1.1, peakAt: 0.2, level: 1.1 });
    s.osc('sine', [[0, 620], [0.34, 120]], 0.36).env(perc(0.3, 0.4, 0.02)).out();
  }),
  r('slam_fall_loop', { dur: 1.6, mix: 'loop2d', loop: true, over: { volume: 0.34 } }, s => {
    wind(s, 900, 1.8, 1);
    s.osc('sine', 1100).detune(s.wander(4, 40)).out(0.06);
    s.noise('brown').lp(320).gain(2).out(0.45);
  }),
  r('slam_impact', { dur: 1.6, n: 2, mix: 'blastSmall', over: { volume: 0.92, airDelay: false, duck: [0.3, 0.4] }, expect: { attackMs: [0, 8], minSub: 0.08 } }, s => {
    s.osc('sine', [[0, 180], [0.05, 58], [0.8, 26]], 1).env(perc(0.8, 1, 0.0008)).drive(3).out();
    s.noise('white', 0.05).hp(1200).env(perc(0.018, 0.9)).drive(4).out();
    s.noise('brown', 0.7).lp([[0, 2600], [0.5, 240]]).env(perc(0.5, 1, 0.002)).drive(3).gain(1.3).out();
    s.grains(1, t => 150 * Math.exp(-t * 4) + 3, 0.003, t => 1 - t).bp(1500, 1).out(0.9);
    clank(s, 310, 0.3, 0.2);
  }),
  r('slam_bounce', { dur: 0.42, mix: 'player' }, s => {
    thump(s, 130, 0.1, 0.9, 2);
    s.osc('sine', [[0, 240], [0.3, 760]], 0.34).env(perc(0.28, 0.5, 0.003)).out();
    s.at(0.012, () => whoosh(s, { from: 500, to: 2200, dur: 0.3, level: 0.6, peakAt: 0.25 }));
  }),
  r('mantle', { dur: 0.32, mix: 'player', over: { volume: 0.3 } }, s => {
    s.noise('pink', 0.18).bp(900, 1).env(perc(0.13, 0.7, 0.015)).out();
    s.at(0.11, () => { thump(s, 130, 0.05, 0.6, 2); click(s, 1000, 0.3); });
  }),
  // Hands and boots on the world, for the moves that put them there. Quiet on purpose: each sits under the move's own
  // sound and only says what touched what.
  r('hand_plant', { dur: 0.16, n: 3, mix: 'step', over: { volume: 0.22 }, expect: { attackMs: [0, 14] } }, s => {
    slap(s, 0.55, s.r(520, 820));
    s.osc('sine', [[0, 150], [0.04, 84]], 0.06).env(perc(0.05, 0.6)).out();
  }),
  r('boot_scuff', { dur: 0.2, n: 3, mix: 'step', over: { volume: 0.2 } }, s => {
    s.noise('pink', 0.16).bp([[0, s.r(900, 1300)], [0.14, 520]], 0.9).env(perc(0.12, 0.8, 0.004)).out();
    s.grains(0.1, t => 160 * Math.exp(-t * 20), 0.002).hp(1800).out(0.3);
  }),
  r('vault_over', { dur: 0.36, mix: 'player', over: { volume: 0.3 } }, s => {
    whoosh(s, { from: 520, to: 1400, dur: 0.3, q: 0.9, peakAt: 0.14, level: 0.8 });
    s.noise('pink', 0.12).bp(700, 1).env(perc(0.1, 0.5, 0.01)).out();
  }),
  r('gear_rustle', { dur: 0.24, n: 3, mix: 'step', over: { volume: 0.18 } }, s => {
    s.noise('pink', 0.2).bp(s.r(1800, 2600), 0.7).am(s.wander(30, 0.6)).env(perc(0.16, 0.7, 0.01)).out();
    s.at(s.r(0.02, 0.06), () => click(s, s.r(1800, 2600), 0.2));
  }),
  r('jump_pad', { dur: 0.7, mix: 'player', over: { volume: 0.65, send: 0.2 }, expect: { trend: 1 } }, s => {
    thump(s, 90, 0.12, 1, 3);
    s.osc('sawtooth', [[0, 150], [0.55, 950]], 0.6).lp([[0, 700], [0.5, 3900]], 2).env(perc(0.55, 0.42, 0.004)).out();
    s.at(0.02, () => whoosh(s, { from: 600, to: 3400, dur: 0.6, q: 1.1, level: 0.9, peakAt: 0.3 }));
  }),
  r('land_hard', { dur: 0.55, mix: 'player', over: { volume: 0.62 }, expect: { minSub: 0.08 } }, s => {
    thump(s, 62, 0.28, 1, 3);
    s.noise('brown', 0.25).lp(1000).env(perc(0.16, 1, 0.001)).gain(1.6).out();
    s.grains(0.28, t => 120 * Math.exp(-t * 12), 0.003).bp(1200, 1).out(0.6);
  }),
  r('speed_wind_loop', { dur: 3.2, mix: 'loop2d', loop: true, stereo: true, seam: 0.8, over: { volume: 0.4, send: 0, exempt: true } }, s => {
    s.noise('pink').bp(640, 0.6).sweep(s.wander(0.7, 220)).am(s.wander(1.6, 0.22)).out(0.72, -0.35);
    s.noise('pink').bp(1500, 1.1).sweep(s.wander(1, 480)).am(s.wander(1.9, 0.3)).out(0.5, 0.35);
    s.noise('white').hp(4800).am(s.wander(2.3, 0.4)).out(0.05);
    s.noise('brown').lp(170).gain(2).am(s.wander(1, 0.3)).out(0.42);
  }),

  footstep('footstep_concrete', s => {
    s.osc('sine', [[0, 170], [0.04, 90]], 0.08).env(perc(0.05, 1)).out();
    s.noise('pink', 0.06).bp(s.r(1100, 1600), 0.9).env(perc(0.03, 0.75)).out();
    s.grains(0.09, t => 180 * Math.exp(-t * 28), 0.002).hp(2200).out(0.32);
  }),
  footstep('footstep_metal', s => {
    s.osc('sine', [[0, 190], [0.04, 110]], 0.08).env(perc(0.05, 0.9)).out();
    modal(s, { f0: s.r(620, 880), modes: MODES.plate, decay: 0.09, level: 0.5, strike: 0.4, damping: 0.74 });
  }, 0.28),
  footstep('footstep_grate', s => {
    s.osc('sine', [[0, 200], [0.04, 120]], 0.07).env(perc(0.04, 0.8)).out();
    modal(s, { f0: s.r(900, 1400), modes: MODES.barrel, decay: 0.06, level: 0.45, strike: 0.5, spread: 0.03 });
    s.grains(0.12, t => 280 * Math.exp(-t * 18), 0.002).bp(2400, 2.2).out(0.8);
  }, 0.28),
  footstep('footstep_dirt', s => {
    s.osc('sine', [[0, 130], [0.05, 74]], 0.09).env(perc(0.06, 0.9)).out();
    s.noise('brown', 0.1).lp(1100).env(perc(0.06, 1)).gain(1.5).out();
    s.grains(0.12, t => 200 * Math.exp(-t * 22), 0.003).bp(1500, 1).out(0.5);
  }),
  footstep('footstep_glass', s => {
    s.osc('sine', [[0, 180], [0.04, 100]], 0.07).env(perc(0.04, 0.6)).out();
    s.grains(0.15, t => 340 * Math.exp(-t * 19), 0.0009).hp(3400).lp(9000).out(1);
    modal(s, { f0: s.r(3200, 4400), modes: MODES.glass, decay: 0.04, level: 0.24, strike: 0.2 });
  }, 0.24),
  footstep('footstep_flesh', s => {
    slap(s, 0.8, s.r(620, 950));
    for (let i = 0; i < 3; i++) s.at(s.r(0.01, 0.07), () => bubble(s, s.r(260, 620), 0.03, 0.34));
  }),

  r('player_hurt', { dur: 0.36, n: 4, mix: 'playerHurt', expect: { attackMs: [0, 50] } }, s => {
    thump(s, 100, 0.09, 0.85, 2);
    s.noise('pink', 0.05).bp(1200, 1).env(perc(0.03, 0.6)).out();
    const f = s.r(120, 150);
    s.at(0.012, () => vox(s, {
      f0: [[0, f * 1.35], [0.24, f]], vowels: [[0, 'uh'], [0.22, 'er']], amp: perc(0.24, 1, 0.012), rough: 0.25, breath: 0.08, drive: 2.2, jitter: 30,
    }));
  }),
  r('player_hurt_heavy', { dur: 0.6, n: 2, mix: 'playerHurt', over: { volume: 0.75 } }, s => {
    thump(s, 70, 0.18, 1, 2.5);
    s.noise('pink', 0.1).lp(1600).env(perc(0.07, 0.8)).drive(2).out();
    const f = s.r(130, 165);
    s.at(0.015, () => vox(s, {
      f0: [[0, f * 1.6], [0.1, f * 1.5], [0.48, f * 0.9]], vowels: [[0, 'a'], [0.45, 'uh']], amp: perc(0.45, 1, 0.012), rough: 0.4, breath: 0.1, drive: 3.2, jitter: 42,
    }));
  }),
  r('player_death', { dur: 2.2, mix: 'stinger', over: { volume: 0.85, duck: [0.65, 2] } }, s => {
    thump(s, 56, 0.5, 1, 3);
    vox(s, {
      f0: [[0, 195], [0.16, 180], [1, 80]], vowels: [[0, 'a'], [0.5, 'uh'], [0.95, 'u']], amp: perc(0.95, 0.9, 0.015), rough: 0.5, breath: 0.15, drive: 3, jitter: 55,
    });
    for (const t of [1.05, 1.62]) {
      s.at(t, () => { thump(s, 52, 0.15, t < 1.5 ? 0.42 : 0.24, 1.5); s.at(0.16, () => thump(s, 46, 0.14, t < 1.5 ? 0.3 : 0.16, 1.5)); });
    }
  }),
  r('armor_hit', { dur: 0.34, n: 3, mix: 'playerHurt', over: { volume: 0.5 } }, s => {
    clank(s, s.r(820, 1100), 0.85, 0.09);
    s.noise('white', 0.03).hp(3000).env(perc(0.012, 0.55)).out();
  }),
  r('armor_break', { dur: 0.95, mix: 'stinger', over: { volume: 0.7, duck: undefined, exempt: false }, expect: { attackMs: [0, 8] } }, s => {
    clank(s, 520, 1, 0.22);
    s.noise('white', 0.05).hp(2200).env(perc(0.02, 0.9)).drive(3).out();
    for (let i = 0; i < 7; i++) s.at(s.r(0.03, 0.42), () => clank(s, s.r(900, 2400), s.r(0.16, 0.38), 0.06));
    s.at(0.02, () => s.osc('sawtooth', [[0, 900], [0.5, 110]], 0.55).lp(2400).env(perc(0.45, 0.25)).out());
  }),
  r('shield_hit', { dur: 0.42, n: 3, mix: 'playerHurt', over: { volume: 0.5 }, expect: { attackMs: [0, 8] } }, s => {
    const f = s.r(520, 720);
    s.fm([[0, f * 2], [0.3, f]], 2.5, [[0, f * 3], [0.3, 20]], 0.36).env(perc(0.3, 0.8, 0.0008)).out();
    s.noise('white', 0.1).bp(4200, 2).env(perc(0.06, 0.55)).out();
    s.osc('sine', 110, 0.2).env(perc(0.14, 0.5)).out();
  }),
  r('heal_tick', { dur: 0.22, mix: 'reward', over: { volume: 0.24 }, expect: { centroid: [500, 5000] } }, s => {
    s.osc('sine', [[0, 880], [0.1, 1320]], 0.18).env(perc(0.15, 0.8, 0.002)).out();
    s.osc('sine', [[0, 1760], [0.1, 2640]], 0.14).env(perc(0.1, 0.25, 0.002)).out();
  }),
  // Stim: the cap snapping off and the spring arming, then the gas charge driving the plunger home.
  r('stim_click', { dur: 0.2, mix: 'player', over: { volume: 0.4 }, expect: { attackMs: [0, 8] } }, s => {
    click(s, 3200, 0.8, 0.008);
    s.at(0.07, () => clank(s, 2400, 0.35, 0.03));
  }),
  r('stim_hiss', { dur: 0.6, mix: 'player', over: { volume: 0.42 }, expect: { attackMs: [0, 12] } }, s => {
    click(s, 1800, 0.9, 0.01);
    thump(s, 160, 0.05, 0.4, 1.6);
    s.noise('white', 0.55).bp([[0, 6000], [0.5, 3600]], 1.4).env(perc(0.5, 0.7, 0.004)).out();
  }),
  r('low_health_warn', { dur: 0.7, mix: 'reward', over: { volume: 0.34 } }, s => {
    s.osc('square', 494, 0.16).lp(1800).env(swell(0.004, 0.15, 0.04, 0.6)).out();
    s.at(0.2, () => s.osc('square', 392, 0.26).lp(1800).env(swell(0.004, 0.25, 0.08, 0.6)).out());
  }),
  r('heartbeat', { dur: 0.6, mix: 'reward', over: { volume: 0.7, send: 0 }, expect: { centroid: [25, 400], minSub: 0.5 } }, s => {
    thump(s, 54, 0.11, 1, 1.5);
    s.at(0.21, () => thump(s, 46, 0.12, 0.7, 1.5));
  }),
  // Beats sit clear of the seam, so a crossfade cannot blunt the first thump.
  r('heartbeat_loop', { dur: 1, mix: 'reward', loop: true, seam: 0.01, over: { volume: 0.55, send: 0, maxVoices: 1 } }, s => {
    s.at(0.05, () => { thump(s, 54, 0.11, 1, 1.5); s.at(0.21, () => thump(s, 46, 0.12, 0.7, 1.5)); });
  }),
];
