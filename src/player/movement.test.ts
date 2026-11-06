/**
 * The real controller on real Rapier, driven through input.simulate. These are the movement targets from
 * DESIGN sections 6 and 13 stated as tests, plus the edge cases that used to eat momentum.
 */
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { BOTS } from './testkit/bots';
import { LANES } from './testkit/course';
import { createHeadlessGame, type HeadlessGame } from './testkit/headless';
import { MOVE, VIEW } from './tuning';

let game: HeadlessGame;
beforeAll(async () => {
  game = await createHeadlessGame();
});

const metrics = (name: string, fps = 60) => game.run(BOTS[name]!, fps) as Record<string, number & string & boolean>;

function place(x: number, y: number, z: number, yaw = 0): void {
  for (const a of ['forward', 'back', 'left', 'right', 'jump', 'dash', 'slide'] as const) game.input.simulate(a, false);
  game.input.consumeLook();
  game.player.reset();
  game.player.teleport(new THREE.Vector3(x, y, z), yaw);
  for (let i = 0; i < 4; i++) game.frame(1 / 60);
}

const frames = (n: number, fps = 60) => {
  for (let i = 0; i < n; i++) game.frame(1 / fps);
};

describe('design targets', () => {
  it('reaches ground top speed inside the first game\'s 0.25 s and stops faster than it starts', () => {
    const m = metrics('ground');
    expect(m.top_speed).toBeCloseTo(MOVE.runSpeed, 1);
    expect(m.accel_t100_s).toBeLessThanOrEqual(0.25);
    expect(m.stop_s).toBeLessThanOrEqual(0.15);
  });

  it('holds speed exactly through hops timed for the landing', () => {
    const m = metrics('bhop');
    expect(m.timed_hops).toBeGreaterThanOrEqual(8);
    expect(m.timed_loss).toBeLessThan(0.01);
    expect(m.timed_end_speed).toBeCloseTo(MOVE.runSpeed, 0);
  });

  it('jumps about 1.4 m, and the double jump adds about as much again', () => {
    const m = metrics('jump');
    expect(m.jump_height).toBeGreaterThan(1.3);
    expect(m.jump_height).toBeLessThan(1.5);
    expect(m.double_jump_height).toBeGreaterThan(2.3);
  });

  it('pays for strafe skill, and tops out near 27 m/s rather than running away', () => {
    const m = metrics('strafe');
    expect(m.strafe_final).toBeGreaterThan(24);
    expect(m.strafe_final).toBeLessThan(30);
    expect(metrics('side').side_strafe_final).toBeGreaterThan(20);
    expect(metrics('side').side_strafe_final).toBeLessThan(30);
  });

  it('dash matches the table and keeps momentum', () => {
    const m = metrics('dash');
    expect(m.dash_peak).toBeCloseTo(MOVE.dashSpeed, 0);
    expect(m.dash_time).toBeGreaterThan(0.1);
    expect(m.dash_time).toBeLessThan(0.15);
    expect(m.dash_fall_during).toBeGreaterThanOrEqual(0);
    expect(m.dash_momentum_out).toBeGreaterThanOrEqual(m.dash_momentum_in - 0.1);
  });

  it('slide boosts once on a cooldown, carries, and accelerates downhill', () => {
    const m = metrics('slide');
    expect(m.slide_boosted / m.slide_entry).toBeGreaterThan(1.2);
    expect(m.slide_retap_ratio).toBeLessThan(1.02);
    expect(m.slide_jump_out).toBeGreaterThanOrEqual(m.slide_jump_in - 0.05);
    expect(m.slide_downhill_peak).toBeGreaterThan(m.slide_downhill_in + 8);
    expect(m.slide_distance).toBeGreaterThan(12);
    expect(m.slide_distance).toBeLessThan(16);
  });

  it('slam drops hard and scales with height; jump on impact bounces', () => {
    const m = metrics('slam');
    expect(m.slam_v).toBeLessThan(-30);
    expect(m.slam_impact_12m).toBeGreaterThan(10);
    expect(m.slam_bounce_v).toBeGreaterThan(MOVE.jumpSpeed * 1.5);
  });

  it('wall run holds for about 0.9 s without falling, then falls slowly', () => {
    const m = metrics('wall');
    expect(m.wallrun_started).toBe(true);
    expect(m.wallrun_hold).toBeGreaterThan(MOVE.wallRunHold - 0.1);
    expect(m.wallrun_time).toBeGreaterThan(1.2);
    expect(m.wallrun_exit_speed).toBeGreaterThanOrEqual(m.wallrun_entry_speed);
    expect(m.wall_zigzag_kicks).toBeGreaterThanOrEqual(3);
  });

  it('mantles every ledge in reach from a jump, and keeps speed', () => {
    const m = metrics('mantle');
    for (const result of String(m.mantle_results).split(' ')) {
      const height = parseFloat(result);
      expect(result.includes(':ok')).toBe(height <= 3.2);
    }
  });

  it('chains slide, jump, wall run, kick, dash and slam without dropping below run speed', () => {
    const m = metrics('chain');
    const links = String(m.chain).split(' > ').map(s => s.split(':'));
    expect(String(m.chain)).not.toContain('NO_WALLRUN');
    for (const [name, value] of links) {
      if (!name!.startsWith('post')) expect(Number(value)).toBeGreaterThanOrEqual(MOVE.runSpeed - 0.5);
    }
  });
});

describe('planted feet', () => {
  it('carries almost nothing the old way through a turn or reversal', () => {
    const m = metrics('feel', 240);
    expect(m.stop_distance_m).toBeLessThan(1);
    expect(m.turn90_keys_drift_m).toBeLessThan(0.45);
    expect(m.turn90_mouse_drift_m).toBeLessThan(0.45);
    expect(m.reverse_overrun_m).toBeLessThan(0.45);
    expect(m.strafe_flip_time_s).toBeLessThan(0.26);
  });

  it('has the player running again within 0.25 s of any overspeed', () => {
    const m = metrics('feel', 240);
    expect(m.overspeed_28_recover_s).toBeLessThanOrEqual(0.25);
    expect(m.dash_exit_speed).toBeLessThan(MOVE.runSpeed + 1);
    expect(m.dash_total_m).toBeLessThan(6);
  });

  it('skates no further on a landing than on a plain stop', () => {
    const m = metrics('feel', 240);
    expect(m.land_no_keys_skate_m).toBeLessThanOrEqual(m.stop_distance_m + 0.05);
  });

  it('gives the same feet at any frame rate', () => {
    const at60 = metrics('feel', 60);
    const at144 = metrics('feel', 144);
    const at30 = metrics('feel', 30);
    for (const k of ['stop_distance_m', 'turn90_keys_drift_m', 'reverse_overrun_m'] as const) {
      expect(Math.abs(at144[k] - at60[k])).toBeLessThan(0.12);
      expect(Math.abs(at30[k] - at60[k])).toBeLessThan(0.12);
    }
  });
});

describe('walls', () => {
  const leans = [1, 3, 6, 10, 15, 20, 30, 45, 60, 75];

  it.each([30, 60, 144])('slides along a wall at run speed times cos(lean) at %i fps, and reports what it really covers', fps => {
    const m = metrics('wallslide', fps);
    for (const lean of leans) {
      // The shallow case first: it once lost 72% of the speed while player.speed stayed at 12.4.
      expect(m[`lean_${lean}_real`], `real at ${lean} degrees`).toBeGreaterThan(m[`lean_${lean}_ideal`] * 0.97);
      expect(m[`lean_${lean}_real`], `real at ${lean} degrees`).toBeLessThan(m[`lean_${lean}_ideal`] * 1.02);
      expect(Math.abs(m[`lean_${lean}_reported`] - m[`lean_${lean}_real`]), `reported at ${lean} degrees`).toBeLessThan(0.25);
    }
  });

  it('claims no speed when a wall or a corner has stopped the player', () => {
    const m = metrics('wallslide');
    expect(m.head_on_real).toBeLessThan(0.05);
    expect(m.head_on_reported).toBeLessThan(0.05);
    expect(m.corner_real).toBeLessThan(0.05);
    // In a corner the second wall is inside the skin gap, so a tick can end before it clips. Under one tick of accel.
    expect(m.corner_reported).toBeLessThan(0.5);
  });

  it('is back to full speed at once when the wall ends', () => {
    expect(metrics('wallslide').wall_end_speed).toBeGreaterThan(MOVE.runSpeed * 0.95);
  });

  it('stops at a wall across the top of a ramp instead of climbing it', () => {
    const p = game.player;
    place(LANES.ramp, 0.1, -5);
    game.input.simulate('forward', true);
    let top = 0;
    for (let i = 0; i < 60 * 8 && p.position.z > -110; i++) {
      game.frame(1 / 60);
      top = Math.max(top, p.velocity.y);
    }
    expect(top).toBeLessThan(MOVE.runSpeed);
    expect(p.grounded).toBe(true);
  });
});

describe('nothing happens by accident', () => {
  it('leaves a player alone who brushes a wall', () => {
    const m = metrics('intent', 120);
    expect(m.hug_jump_wallruns).toBe(0);
    expect(m.strafe_into_wallruns).toBe(0);
    expect(m.view_parallel_wallruns).toBe(0);
    expect(m.door_jamb_wallruns).toBe(0);
  });

  it('wall runs when the player steers into the wall on purpose', () => {
    const m = metrics('intent', 120);
    expect(m.steer_jump_wallruns).toBe(1);
    expect(m.angled_jump_wallruns).toBe(1);
  });

  it('never lifts a player who did not jump', () => {
    const m = metrics('intent', 120);
    expect(m.crate_no_jump_mantles).toBe(0);
    expect(m.crate_strafe_mantles).toBe(0);
    const ground = metrics('mantle');
    for (const result of String(ground.mantle_ground_top_y).split(' ')) expect(Number(result.split(':')[1])).toBeLessThan(0.05);
    expect(ground.mantle_from_slide_y).toBeLessThan(0.05);
  });

  it('climbs a ledge on a jump, over a visible time', () => {
    const m = metrics('intent', 120);
    expect(m.ledge_jump_mantles).toBe(1);
    expect(m.ledge_jump_climb_s).toBeGreaterThan(0.12);
    expect(m.ledge_jump_vy).toBeLessThanOrEqual(MOVE.mantleRiseSpeed + 0.01);
  });

  it('keeps a double jump a double jump beside a wall', () => {
    const m = metrics('intent', 120);
    expect(m.corridor_double_jumps).toBe(1);
    expect(m.corridor_wall_kicks).toBe(0);
  });

  it('starts a slide only from a press', () => {
    const m = metrics('intent', 120);
    expect(m.held_crouch_landing_slides).toBe(0);
    expect(m.air_press_landing_slides).toBe(1);
  });
});

describe('level view', () => {
  it('has no roll at rest, strafing, or turning at a run, and returns to exactly 0 after everything else', () => {
    const m = metrics('roll');
    expect(m.roll_rest).toBe(0);
    expect(m.roll_strafe_left_peak_deg).toBe(0);
    expect(m.roll_strafe_right_peak_deg).toBe(0);
    expect(m.roll_run_turn_peak_deg).toBe(0);
    expect(m.roll_slide_peak_deg).toBeGreaterThan(0);
    expect(m.roll_wall_peak_deg).toBeGreaterThan(0);
    for (const k of ['strafe_left', 'strafe_right', 'run_turn', 'kick', 'shake', 'slide', 'wall']) expect(m[`roll_after_${k}`]).toBe(0);
  });

  it('adds no FOV at run speed and at most fovSpeedAdd at the strafe ceiling', () => {
    const p = game.player;
    place(LANES.strafe, 0.1, 0);
    game.input.simulate('forward', true);
    frames(120);
    expect(game.camera.fov).toBeCloseTo(VIEW.baseFov, 3);
    place(LANES.strafe, 200, 0);
    p.launch(new THREE.Vector3(0, 0, -40));
    frames(180);
    expect(game.camera.fov).toBeLessThanOrEqual(VIEW.baseFov + VIEW.fovSpeedAdd + 0.01);
    expect(game.camera.fov).toBeGreaterThan(VIEW.baseFov + VIEW.fovSpeedAdd - 1);
  });

  it('sends mouse look to the camera in the same frame at exactly sensitivity per pixel', () => {
    const p = game.player;
    place(LANES.strafe, 0.1, 0);
    const cam = game.ctx.render.camera;
    const yaw = p.yaw;
    const pitch = p.pitch;
    for (const [dx, dy] of [[37, 0], [-211, 15], [1, -1], [0, 0], [503, 90]] as const) {
      const before = { yaw: p.yaw, pitch: p.pitch };
      game.input.simulateLook(dx, dy);
      game.frame(1 / 60);
      expect(p.yaw).toBeCloseTo(before.yaw - dx * p.sensitivity, 12);
      expect(p.pitch).toBeCloseTo(before.pitch - dy * p.sensitivity, 12);
      expect(cam.rotation.y).toBeCloseTo(p.yaw, 12);
      expect(cam.rotation.x).toBeCloseTo(p.pitch, 12);
    }
    expect(p.yaw - yaw).not.toBe(0);
    expect(p.pitch - pitch).not.toBe(0);
  });
});

describe('geometry at speed', () => {
  it('climbs and descends stairs without losing speed or leaving the ground', () => {
    const m = metrics('stairs');
    expect(m.stairs_up_min).toBeGreaterThanOrEqual(MOVE.runSpeed - 0.1);
    expect(m.stairs_up_airframes).toBe(0);
    expect(m.stairs_down_airframes).toBe(0);
  });

  it('runs up ramps at full speed, launches off ramp tops, and cannot walk a steep face', () => {
    const m = metrics('ramp');
    expect(m.ramp_run_speed3d).toBeCloseTo(MOVE.runSpeed, 0);
    expect(m.ramp_run_grounded).toBe(true);
    expect(m.launch_ramp_top).toBeGreaterThan(10);
    expect(m.steep_grounded).toBe(false);
  });

  it('rolls over curbs with no speed spike or launch', () => {
    const m = metrics('curbs');
    expect(m.curbs_run_reached).toBe(true);
    expect(m.curbs_fast_reached).toBe(true);
    expect(m.curbs_run_max_vy).toBeLessThan(1);
    expect(m.curbs_fast_max_vy).toBeLessThan(1);
  });

  it('survives the edge cases', () => {
    const m = metrics('edge');
    expect(m.tunnel_60_side).toBe('safe');
    expect(m.tunnel_150_side).toBe('safe');
    expect(m.ceiling_max_feet_y).toBeLessThan(0.85);
    expect(m.ceiling_speed_out).toBeGreaterThanOrEqual(m.ceiling_speed_in - 0.1);
    expect(m.tunnel_crouched_inside).toBe(true);
    expect(m.tunnel_stood_after).toBe(true);
    expect(m.slide_wall_x_ok).toBe(true);
    expect(m.corner_safe).toBe(true);
    expect(m.corner_can_jump).toBe(true);
    expect(m.corner_wr_after).toBeGreaterThanOrEqual(m.corner_wr_in);
    expect(m.round_started).toBe(true);
    expect(m.round_turn_deg).toBeGreaterThan(60);
  });
});

describe('very large colliders', () => {
  // Rapier's shape casts overshoot by up to 25 cm on a slab this size. A ray-backed ground check has to hide that.
  it('stands, runs, hops and lands level on a 2 km slab', async () => {
    const big = await createHeadlessGame(physics => {
      physics.addStaticBox(new THREE.Vector3(30, -0.5, -50), new THREE.Vector3(1000, 0.5, 1000), null, 'concrete');
    });
    const p = big.player;
    p.teleport(new THREE.Vector3(10, 3, -20), 0);
    big.input.simulate('forward', true);
    let lowest = Infinity;
    let highestOnGround = -Infinity;
    for (let i = 0; i < 60 * 6; i++) {
      big.frame(1 / 60);
      if (p.grounded) {
        lowest = Math.min(lowest, p.position.y);
        highestOnGround = Math.max(highestOnGround, p.position.y);
      }
      if (i === 60 * 3) big.input.simulate('jump', true);
    }
    expect(lowest).toBeGreaterThan(-0.005);
    expect(highestOnGround).toBeLessThan(0.15);
    expect(p.speed).toBeCloseTo(MOVE.runSpeed, 0);
  });
});

describe('jump timing', () => {
  it('takes a press inside the buffer as a hop, not a double jump', () => {
    const p = game.player;
    place(LANES.strafe, 0.1, 0);
    game.input.simulate('forward', true);
    frames(20);
    game.input.simulate('jump', true);
    frames(1);
    game.input.simulate('jump', false);
    let jumps = 0;
    let doubles = 0;
    const off = game.ctx.events.on('player:jumped', e => {
      jumps++;
      if (e.double) doubles++;
    });
    // Fall until about 60 ms from the ground, then press.
    while (p.position.y > 0.5 || p.velocity.y > 0) game.frame(1 / 60);
    game.input.simulate('jump', true);
    frames(1);
    game.input.simulate('jump', false);
    frames(12);
    off();
    expect(doubles).toBe(0);
    expect(jumps).toBe(1);
    expect(p.speed).toBeGreaterThanOrEqual(MOVE.runSpeed - 0.01);
  });

  it('allows a jump for 100 ms after walking off a ledge, and still has the double jump', () => {
    const p = game.player;
    place(LANES.gaps, 4.1, -36);
    game.input.simulate('forward', true);
    let airFrames = 0;
    while (p.grounded || airFrames === 0) {
      game.frame(1 / 120);
      if (!p.grounded) airFrames++;
      if (p.position.z < -60) break;
    }
    expect(p.grounded).toBe(false);
    frames(4, 60);
    let fired = 0;
    const off = game.ctx.events.on('player:jumped', e => {
      if (!e.double) fired++;
    });
    game.input.simulate('jump', true);
    frames(2);
    game.input.simulate('jump', false);
    off();
    expect(fired).toBe(1);
    expect(p.velocity.y).toBeGreaterThan(MOVE.jumpSpeed - 2);
  });

  it('jumps once while Space is held, unless the player opts in to hold-to-hop', () => {
    const p = game.player;
    const count = () => {
      place(LANES.strafe, 0.1, 0);
      let doubles = 0;
      let jumps = 0;
      const off = game.ctx.events.on('player:jumped', e => {
        jumps++;
        if (e.double) doubles++;
      });
      game.input.simulate('jump', true);
      frames(180);
      game.input.simulate('jump', false);
      off();
      return { jumps, doubles };
    };
    expect(count()).toEqual({ jumps: 1, doubles: 0 });
    p.holdToHop = true;
    const held = count();
    p.holdToHop = false;
    expect(held.jumps).toBeGreaterThanOrEqual(3);
    expect(held.doubles).toBe(0);
  });
});

describe('momentum', () => {
  /** Puts the player in the air at `speed`, about to land. */
  function fastFall(speed: number): void {
    place(LANES.strafe, 3, 0);
    game.player.velocity.set(0, -4, -speed);
    frames(2);
  }

  it('persists in the air with no keys held', () => {
    const p = game.player;
    place(LANES.strafe, 30, 0);
    p.velocity.set(0, 0, -20);
    frames(60);
    expect(p.speed).toBeCloseTo(20, 3);
  });

  it('costs nothing to land with a queued jump', () => {
    const p = game.player;
    fastFall(20);
    let landed = false;
    const off = game.ctx.events.on('player:landed', () => { landed = true; });
    // Press inside the jump buffer: about 60 ms from the ground at this fall speed.
    while (p.position.y > 0.7) game.frame(1 / 120);
    game.input.simulate('jump', true);
    frames(1);
    game.input.simulate('jump', false);
    for (let i = 0; i < 120 && !landed; i++) game.frame(1 / 60);
    off();
    frames(2);
    expect(landed).toBe(true);
    expect(p.grounded).toBe(false);
    expect(p.speed).toBeGreaterThan(19.99);
  });

  it('forgives a hop pressed just after landing, and only just after', () => {
    const m = metrics('bhop');
    expect(m.hop_late_30ms).toBeGreaterThan(23.9);
    expect(m.hop_late_50ms).toBeGreaterThan(23.9);
    expect(m.hop_late_100ms).toBeLessThan(18);
    expect(m.hop_late_200ms).toBeLessThan(MOVE.runSpeed + 0.1);
  });

  it('settles a landing with a short stumble that is gone in a quarter second', () => {
    const p = game.player;
    place(LANES.strafe, 0.1, 0);
    game.input.simulate('forward', true);
    frames(30);
    game.input.simulate('jump', true);
    frames(1);
    game.input.simulate('jump', false);
    while (!p.grounded) game.frame(1 / 120);
    let low = Infinity;
    for (let i = 0; i < 15; i++) {
      game.frame(1 / 120);
      low = Math.min(low, p.speed);
    }
    expect(low).toBeLessThan(MOVE.runSpeed * 0.95);
    expect(low).toBeGreaterThan(MOVE.runSpeed * 0.7);
    frames(15);
    expect(p.speed).toBeCloseTo(MOVE.runSpeed, 1);
  });

  it('scrubs overspeed off the ground in under a quarter second', () => {
    const p = game.player;
    fastFall(28);
    game.input.simulate('forward', true);
    for (let i = 0; i < 240 && !p.grounded; i++) game.frame(1 / 120);
    frames(15);
    expect(p.speed).toBeCloseTo(MOVE.runSpeed, 1);
  });

  it('does not drag a throw from a pad or a blast until the player lands', () => {
    const p = game.player;
    place(LANES.strafe, 30, 0);
    p.launch(new THREE.Vector3(0, 8, -40));
    frames(60);
    expect(p.speed).toBeCloseTo(40, 3);
  });
});

describe('frame-rate independence', () => {
  /** One scripted run: W+strafe with a steady mouse sweep and hops. Every input is keyed to elapsed time. */
  function run(fps: number): { x: number; z: number; speed: number; path: number } {
    const p = game.player;
    place(LANES.strafe, 0.1, 0);
    p.holdToHop = true;
    game.input.consumeLook();
    const dt = 1 / fps;
    let t = 0;
    game.input.simulate('forward', true);
    game.input.simulate('jump', true);
    game.input.simulate('left', true);
    const turnRate = 0.9;
    const pixelsPerRad = 1 / (p.sensitivity * p.lookScale);
    let path = 0;
    let lastX = p.position.x;
    let lastZ = p.position.z;
    while (t < 6) {
      game.input.simulateLook(-turnRate * dt * pixelsPerRad, 0);
      if (t > 3 && t < 3 + dt * 1.5) game.input.simulate('left', false);
      game.frame(dt);
      t += dt;
      path += Math.hypot(p.position.x - lastX, p.position.z - lastZ);
      lastX = p.position.x;
      lastZ = p.position.z;
    }
    p.holdToHop = false;
    return { x: p.position.x, z: p.position.z, speed: p.speed, path };
  }

  it('gives near-identical results at 30, 60 and 144 fps', () => {
    const a = run(30);
    const b = run(60);
    const c = run(144);
    const dist = (p: typeof a, q: typeof a) => Math.hypot(p.x - q.x, p.z - q.z);
    expect(b.path).toBeGreaterThan(70);
    expect(dist(a, b)).toBeLessThan(b.path * 0.02);
    expect(dist(c, b)).toBeLessThan(b.path * 0.02);
    expect(Math.abs(a.path - b.path)).toBeLessThan(b.path * 0.01);
    expect(Math.abs(c.path - b.path)).toBeLessThan(b.path * 0.01);
    expect(Math.abs(a.speed - b.speed)).toBeLessThan(0.6);
    expect(Math.abs(c.speed - b.speed)).toBeLessThan(0.6);
  });

  it('slide distance matches across frame rates', () => {
    const slide = (fps: number) => {
      place(LANES.strafe, 0.1, 0);
      game.input.simulate('forward', true);
      frames(Math.round(fps * 0.4), fps);
      const z0 = game.player.position.z;
      game.input.simulate('slide', true);
      frames(Math.round(fps * 1.5), fps);
      return z0 - game.player.position.z;
    };
    const d30 = slide(30);
    const d60 = slide(60);
    const d144 = slide(144);
    expect(Math.abs(d30 - d60)).toBeLessThan(d60 * 0.02);
    expect(Math.abs(d144 - d60)).toBeLessThan(d60 * 0.02);
  });
});

describe('health', () => {
  it('follows the first game: 5 HP/s after 3 s, armor absorbs, death and reset', () => {
    const m = metrics('health');
    expect(m.hp_after_30_with_armor).toBe(90);
    expect(m.armor_after_30).toBe(10);
    expect(m.hp_before_regen).toBe(90);
    expect(m.hp_after_regen_1s).toBeGreaterThan(94);
    expect(m.alive_after_lethal).toBe(false);
    expect(m.alive_after_reset).toBe(true);
    expect(m.hp_after_reset).toBe(MOVE.maxHealth);
  });

  it('honours invulnerability and the damage modifier', () => {
    const p = game.player;
    place(LANES.strafe, 0.1, 0);
    p.modifiers.invulnerable = true;
    p.takeDamage({ amount: 50, type: 'bullet', source: 'test' });
    expect(p.health).toBe(100);
    p.modifiers.invulnerable = false;
    p.modifiers.damageTaken = 0.5;
    p.takeDamage({ amount: 50, type: 'bullet', source: 'test' });
    expect(p.health).toBe(75);
  });
});
