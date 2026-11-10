/**
 * Effects gallery: a dark, cold test room with stand-in enemies at 3, 10 and 30 m.
 *
 * URL:
 *   ?effect=<name>   fires one effect once, then again every 2.5 s
 *   ?cycle=1         walks the whole gallery
 *   ?sheet=1         steps the clock by hand and shows frames 1, 3, 6, 15, 40, 90 as a contact sheet
 *   ?frames=1,3,6    frames for the sheet
 *   ?dist=12         camera distance from the effect
 *   ?h=1.6 ?yaw=0    camera height, orbit angle in degrees
 *   ?list=1          prints every effect name
 *   ?slowmo=1        runs the world at 0.25x
 *   ?sheetonly=1     builds the room and waits to be driven from outside
 *
 * In the page: __fx.fire(name), __fx.step(frames), __fx.names, __fx.capture(effects, frames, columns),
 * __fx.placeCamera(dist, height, look, yawDegrees), and __fx.bench(name, seconds) for relative frame cost.
 */
import * as THREE from 'three';
import { createRenderSystem, type Renderer } from '../render';
import { Physics } from '../physics/Physics';
import { createFx } from '../fx';
import { makeCtx, runLoop } from './harness';
import type {
  BakedLight, BeamKind, Ctx, ExplosionKind, FxSystem, MuzzleKind, SlashKind, SurfaceKind, TracerKind, EmitterPreset,
} from '../core/contracts';

type Fx = ReturnType<typeof createFx>;

interface Scene {
  ctx: Ctx;
  fx: Fx;
  target: THREE.Vector3;
  mover: THREE.Object3D;
  cam: THREE.PerspectiveCamera;
}

interface Effect {
  /** Runs once at frame zero. */
  fire(s: Scene): void;
  /** Runs every frame after that. Omit for one-shots. */
  tick?(s: Scene, frame: number): void;
}

const RADIUS: Partial<Record<ExplosionKind, number>> = {
  rocket: 8, grenade: 6, hellfire: 20, hellfireBullet: 2, shell: 5, plasma: 6, enemy: 5, barrel: 7, finisher: 8, nuke: 60,
  // One link of the chain a full Lance beam leaves.
  plasmaBurst: 2.8,
};

const UP = new THREE.Vector3(0, 1, 0);
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function buildGallery(): Record<string, Effect> {
  const g: Record<string, Effect> = {};

  for (const kind of Object.keys(RADIUS) as ExplosionKind[]) {
    g[kind] = { fire: s => s.fx.explosion(s.target.clone().setY(0.6), { radius: RADIUS[kind]!, kind }) };
  }

  const surfaces: SurfaceKind[] = ['concrete', 'metal', 'grate', 'dirt', 'glass', 'flesh', 'armor', 'energy', 'lava'];
  for (const k of surfaces) {
    g[`impact-${k}`] = { fire: s => s.fx.impact(s.target.clone().setY(0.02), UP, k) };
    g[`wall-${k}`] = { fire: s => s.fx.impact(v(0, 1.6, -3.98), v(0, 0, 1), k) };
  }

  g.bloodJet = { fire: s => s.fx.bloodJet(s.target.clone().setY(1.3), v(0.6, 0.35, 0.2).normalize()) };
  g.bloodJetUp = { fire: s => s.fx.bloodJet(s.target.clone().setY(1.5), UP) };
  g.bloodHit = { fire: s => s.fx.bloodHit(s.target.clone().setY(1.2), v(0.7, 0.1, 0.5).normalize()) };
  g.bloodMist = { fire: s => s.fx.bloodMist(s.target.clone().setY(1.3), 1) };
  g.headBurst = { fire: s => s.fx.headBurst(s.target.clone().setY(1.7), v(-0.5, 0.2, 0.3).normalize()) };
  g.gibBurst = { fire: s => s.fx.gibBurst(s.target.clone().setY(1), v(0.5, 0.5, 0.2).normalize(), 12) };

  const muzzles: MuzzleKind[] = ['smg', 'rifle', 'shotgun', 'rocket', 'autocannon', 'plasma', 'railgun', 'minigun', 'revolver', 'flame', 'enemy', 'carbine', 'pistol', 'sabot', 'quiver'];
  for (const k of muzzles) {
    g[`muzzle-${k}`] = { fire: s => s.fx.muzzleFlash(s.target.clone().setY(1.4), v(1, 0, 0.25).normalize(), k) };
  }
  g['smg-burst'] = {
    fire: s => s.fx.muzzleFlash(s.target.clone().setY(1.4), v(1, 0, 0.25).normalize(), 'smg'),
    tick(s, frame) {
      if (frame % 3 !== 0 || frame > 60) return;
      const from = s.target.clone().setY(1.4);
      const dir = v(1, 0, 0.25).normalize();
      s.fx.muzzleFlash(from, dir, 'smg');
      s.fx.tracer(from, from.clone().addScaledVector(dir, 25), 'bullet');
      s.fx.shellCasing(from, v(-1.5, 3, 2), 'pistol');
    },
  };

  const tracers: TracerKind[] = ['bullet', 'heavy', 'hellfire', 'bloodthirst', 'berserk', 'plasma', 'rail', 'enemy', 'carbine', 'pistol', 'sabot'];
  for (const k of tracers) {
    g[`tracer-${k}`] = {
      fire: s => {
        for (let i = 0; i < 5; i++) s.fx.tracer(v(-16, 1.4 + i * 0.5, s.target.z - 2 + i), v(18, 1.2 + i * 0.3, s.target.z - 2 + i), k);
      },
    };
  }

  const emitters: EmitterPreset[] = ['rocketTrail', 'smokeTrail', 'fireTrail', 'sparkTrail', 'shellTrail', 'hellfireTrail', 'airstrikeTrail', 'bloodTrail'];
  for (const k of emitters) {
    g[k] = {
      fire(s) {
        s.mover.userData.speed = k === 'shellTrail' ? 200 : k === 'bloodTrail' ? 9 : 40;
        s.mover.position.set(-24, 2.2, s.target.z);
        s.fx.attachEmitter(s.mover, k, undefined, 2);
      },
    };
  }
  g.stumpSpray = {
    fire(s) {
      s.mover.userData.speed = 0;
      s.mover.position.set(0, 1.6, s.target.z);
      s.mover.rotation.set(0, 0, -0.5);
      s.fx.attachEmitter(s.mover, 'stumpSpray', undefined, 4);
    },
  };
  g.burning = {
    fire(s) {
      s.mover.userData.speed = 0;
      s.mover.position.set(0, 0.9, s.target.z);
      s.fx.attachEmitter(s.mover, 'burning', undefined, 3);
    },
  };

  const beams: BeamKind[] = ['rail', 'lance', 'laser', 'sniper', 'heal'];
  for (const k of beams) {
    g[`beam-${k}`] = {
      fire: s => s.fx.beam(s.target.clone().add(v(-11, 1.3, 0)), s.target.clone().add(v(12, 1.1, -2)), k),
    };
  }

  g.arc = {
    fire: s => {
      const t = s.target;
      s.fx.arc(v(t.x - 7, 2.2, t.z), v(t.x + 7, 1.2, t.z - 1));
      s.fx.arc(v(t.x + 7, 1.2, t.z - 1), v(t.x + 3, 1.6, t.z - 5), 0xc8a0ff);
    },
  };

  const slashes: SlashKind[] = ['light', 'heavy', 'sweep', 'finisher'];
  for (const k of slashes) {
    g[`slash-${k}`] = {
      fire: s => {
        const c = s.target.clone().setY(1.5);
        const n = v(0.25, 0.9, 0.2).normalize();
        const start = v(-1, 0.25, 0).normalize();
        start.addScaledVector(n, -start.dot(n)).normalize();
        s.fx.slash(c, n, start, 2.4, 2.4, k);
      },
    };
  }

  g.flame = {
    fire() {},
    tick(s, frame) {
      if (frame < 90) s.fx.flame(s.target.clone().add(v(-3, 1.4, 0)), v(1, 0.03, 0).normalize());
    },
  };
  g.frost = { fire: s => s.fx.frostShatter(s.target.clone().setY(1.1), v(0.4, 0.1, 0.3).normalize()) };
  g.dust = { fire: s => s.fx.dust(s.target.clone().setY(0.05), UP, 1) };
  g.slam = { fire: s => s.fx.slam(s.target.clone().setY(0.02), 0.9) };
  g.dash = { fire: s => s.fx.dashStreaks(s.target.clone().setY(0.1), v(1, 0, 0)) };
  g.pad = { fire: s => s.fx.jumpPad(s.target.clone().setY(0.03), UP) };
  g.pickup = { fire: s => s.fx.pickupSparkle(s.target.clone().setY(0.8), 0x44ff99) };
  g.spawn = { fire: s => s.fx.spawnIn(s.target.clone().setY(0.02), 0xff3344) };
  g.wallSparks = {
    fire() {},
    tick(s, frame) {
      if (frame < 60 && frame % 2 === 0) s.fx.wallSparks(v(-8 + frame * 0.27, 1.4, -3.95), v(0, 0, 1), v(1, 0, 0));
    },
  };
  g.lens = { fire: s => s.fx.lensBlood(1) };
  g.casings = {
    fire() {},
    tick(s, frame) {
      if (frame % 4 === 0 && frame < 60) s.fx.shellCasing(s.target.clone().setY(1.5), v(-1.5 + Math.random(), 3, 2 + Math.random()), frame % 8 ? 'rifle' : 'shotgun');
    },
  };
  g.embers = { fire: s => s.fx.embers(s.target.clone().setY(0.6), 60, 2) };
  g.shimmer = { fire: s => s.fx.heatShimmer(v(-9, 3.4, -3.9), 5, 2) };
  g.sparks = { fire: s => s.fx.sparks(s.target.clone().setY(1), v(0.4, 0.9, 0).normalize(), 30) };
  g.smoke = {
    fire: s => {
      for (let i = 0; i < 8; i++) s.fx.smoke(s.target.clone().add(v(i - 4, 1, 0)));
    },
  };
  g.ring = {
    fire: s => {
      for (let i = 0; i < 6; i++) s.fx.ring(s.target.clone().add(v(i * 1.2 - 3, 1.4, 0)), v(1, 0, 0), 0xffff00, 1);
    },
  };
  g.chips = {
    fire: s => {
      s.fx.chips(s.target.clone().setY(1), 0xffff00, 20);
      s.fx.chips(s.target.clone().add(v(3, 1, 0)), 0xff4444, 15);
      s.fx.chips(s.target.clone().add(v(-3, 1, 0)), 0x888888, 8);
    },
  };

  g.stress = {
    fire(s) {
      const t = s.target;
      s.fx.explosion(v(t.x - 8, 0.6, t.z), { radius: 20, kind: 'hellfire' });
      s.fx.explosion(v(t.x, 0.6, t.z - 6), { radius: 20, kind: 'hellfire' });
      s.fx.explosion(v(t.x + 8, 0.6, t.z), { radius: 20, kind: 'hellfire' });
      const dummies = s.mover.userData.dummies as THREE.Object3D[];
      for (const d of dummies) s.fx.attachEmitter(d, 'stumpSpray', undefined, 4);
    },
  };
  return g;
}

function buildRoom(render: Renderer, physics: Physics): THREE.Object3D[] {
  const unit = new THREE.BoxGeometry(1, 1, 1);
  const add = (c: [number, number, number], h: [number, number, number], m: Parameters<Renderer['materials']['world']>[0], surface: SurfaceKind = 'concrete') => {
    const mesh = new THREE.Mesh(unit, render.materials.world(m));
    mesh.position.set(...c);
    mesh.scale.set(h[0] * 2, h[1] * 2, h[2] * 2);
    render.scene.add(mesh);
    physics.addStaticBox(v(...c), v(...h), null, surface);
  };
  const W = 44, D = 44, H = 16;
  add([0, -0.5, 0], [W, 0.5, D], 'concrete');
  add([-W, H / 2, 0], [0.5, H / 2, D], 'concreteDark');
  add([W, H / 2, 0], [0.5, H / 2, D], 'concreteDark');
  add([0, H / 2, -D], [W, H / 2, 0.5], 'concreteDark');
  add([0, H / 2, D], [W, H / 2, 0.5], 'concreteDark');
  add([0, 2.5, -4.5], [9, 2.5, 0.5], 'concrete');
  for (const x of [-20, 20]) add([x, H / 2, -12], [1.2, H / 2, 1.2], 'concrete');

  // Stand-in enemies: a capsule's worth of cold grey at 3, 10 and 30 m from the default camera.
  const dummyMat = render.materials.patch(new THREE.MeshStandardMaterial({ color: 0x5a6878, roughness: 0.6, metalness: 0.2 }));
  const body = new THREE.CapsuleGeometry(0.34, 1.1, 4, 10);
  const dummies: THREE.Object3D[] = [];
  for (let i = 0; i < 20; i++) {
    const row = Math.floor(i / 10);
    const mesh = new THREE.Mesh(body, dummyMat);
    mesh.position.set((i % 10 - 4.5) * 2.6, 0.95, -2.5 - row * 1.2);
    render.scene.add(mesh);
    dummies.push(mesh);
  }
  return dummies;
}

const LIGHTS: BakedLight[] = [
  { position: v(0, 10, 0), color: 0x4a7cff, intensity: 22, radius: 40 },
  { position: v(-18, 8, 12), color: 0x30c0ff, intensity: 14, radius: 26 },
  { position: v(18, 8, -10), color: 0x30c0ff, intensity: 14, radius: 26 },
];

export default async function fxSandbox(params: URLSearchParams): Promise<void> {
  const physics = await Physics.create();
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const render = (await createRenderSystem(canvas)) as Renderer;
  const ctx = makeCtx({ render, physics });
  render.init(ctx);
  if (params.get('q')) render.setQuality(Number(params.get('q')));

  const dummies = buildRoom(render, physics);
  physics.flushQueries();
  await render.bakeLightVolume({
    bounds: new THREE.Box3(v(-45, -1, -45), v(45, 17, 45)),
    lights: LIGHTS,
    isSolid: (_x, y) => y < 0,
  });

  const dist = Number(params.get('dist') ?? 12);
  const height = Number(params.get('h') ?? 1.7);
  const yaw = (Number(params.get('yaw') ?? 0) * Math.PI) / 180;
  const target = v(0, 1.2, 0);
  const cam = render.camera;
  cam.position.set(Math.sin(yaw) * dist, height, Math.cos(yaw) * dist);
  cam.lookAt(0, Number(params.get('look') ?? 1.6), 0);

  const fx = createFx(ctx);
  ctx.fx = fx as FxSystem;

  const mover = new THREE.Object3D();
  mover.userData.speed = 0;
  mover.userData.dummies = dummies;
  render.scene.add(mover);

  const s: Scene = { ctx, fx, target, mover, cam };
  const gallery = buildGallery();
  const names = Object.keys(gallery);
  if (params.get('list')) console.log(names.join(' '));

  let current: Effect | null = null;
  let frame = 0;
  const fire = (name: string): void => {
    const e = gallery[name];
    if (!e) throw new Error(`Unknown effect ${name}. Try: ${names.join(' ')}`);
    current = e;
    frame = 0;
    e.fire(s);
  };

  const tick = (dt: number, realDt: number): void => {
    frame++;
    (current as Effect | null)?.tick?.(s, frame);
    const speed = mover.userData.speed as number;
    if (speed) mover.position.x += speed * dt;
    fx.update();
    void realDt;
  };

  const step = (n: number): void => {
    for (let i = 0; i < n; i++) {
      ctx.time.tick(1 / 60);
      tick(ctx.time.dt, ctx.time.realDt);
      if (i === n - 1) {
        render.render();
      } else {
        // A full render per skipped frame is slow, but lights and post pulses must still age.
        (render.lights as unknown as { update(dt: number, a: THREE.Camera, b: THREE.Camera): void }).update(ctx.time.dt, render.camera, render.viewCamera);
        (render.post as unknown as { update(dt: number): void }).update(ctx.time.realDt);
      }
    }
  };

  if (params.get('slowmo')) {
    ctx.time.pushScale('sandbox', 0.25, 0, 0);
  }

  const placeCamera = (d: number, h: number, look: number, deg: number): void => {
    const a = (deg * Math.PI) / 180;
    cam.position.set(Math.sin(a) * d, h, Math.cos(a) * d);
    cam.lookAt(0, look, 0);
    cam.updateMatrixWorld();
  };

  /** Runs an effect on the real clock for `seconds` and reports frame cost, for relative comparison. */
  const bench = (name: string | null, seconds: number): Promise<Record<string, number>> => new Promise(resolve => {
    fx.clear();
    const t0 = performance.now();
    if (name) fire(name);
    const emitMs = performance.now() - t0;
    let frames = 0;
    let updateMs = 0;
    let renderMs = 0;
    let peak = 0;
    let last = performance.now();
    let total = 0;
    const loop = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      total += dt;
      ctx.time.tick(dt);
      const a = performance.now();
      tick(ctx.time.dt, ctx.time.realDt);
      const b = performance.now();
      render.render();
      renderMs += performance.now() - b;
      updateMs += b - a;
      frames++;
      if (frames % 20 === 0) peak = Math.max(peak, fx.stats().particles);
      if (total < seconds) {
        requestAnimationFrame(loop);
        return;
      }
      resolve({
        emitMs: +emitMs.toFixed(2), fxUpdateMs: +(updateMs / frames).toFixed(3), renderCallMs: +(renderMs / frames).toFixed(2),
        frameMs: +((total * 1000) / frames).toFixed(2), frames, peakParticles: peak, drawCalls: render.drawCalls(),
      });
    };
    requestAnimationFrame(loop);
  });

  const contact = new ContactSheet(render, fx, fire, step);
  (window as unknown as { __fx: unknown }).__fx = {
    fire, step, names, fx, ctx, capture: contact.capture, placeCamera, bench,
  };

  const effect = params.get('effect') ?? 'rocket';

  // Driven from outside through __fx.capture: nothing runs on its own.
  if (params.get('sheetonly')) return;

  if (params.get('sheet')) {
    await contact.warmUp();
    const frames = (params.get('frames') ?? '1,3,6,15,40,90').split(',').map(Number);
    const effects = (params.get('effects') ?? effect).split(',');
    await contact.capture(effects, frames, Number(params.get('cols') ?? 3));
    const w = window as unknown as { __op2: unknown; __fxDone: boolean };
    w.__op2 = { ctx, stats: () => ({ effect, frames, ...fx.stats(), drawCalls: render.drawCalls() }) };
    w.__fxDone = true;
    return;
  }

  let wait = 0.4;
  let index = 0;
  const cycle = !!params.get('cycle');
  runLoop(ctx, () => {
    wait -= ctx.time.realDt;
    if (wait <= 0) {
      wait = cycle ? 2 : 2.5;
      if (cycle) index = (index + 1) % names.length;
      fire(cycle ? names[index]! : effect);
    }
    tick(ctx.time.dt, ctx.time.realDt);
    render.render();
  }, () => ({
    effect: cycle ? names[index] : effect,
    ...fx.stats(),
    drawCalls: render.drawCalls(),
    triangles: render.triangles(),
  }));
}

/**
 * Steps the clock by hand and tiles chosen frames, so one image shows the whole life of an effect.
 * Several effects give one row each, which is the fastest way to review a family.
 */
class ContactSheet {
  private readonly out = document.createElement('canvas');
  private readonly g = this.out.getContext('2d')!;

  constructor(
    private readonly render: Renderer, private readonly fx: Fx,
    private readonly fire: (name: string) => void, private readonly step: (n: number) => void,
  ) {
    this.out.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:10;background:#000;display:none';
    document.body.appendChild(this.out);
  }

  /** A few frames so the depth texture exists and shaders are compiled before the clock matters. */
  warmUp(): Promise<void> {
    return new Promise(resolve => {
      let warm = 0;
      const loop = () => {
        this.step(1);
        if (++warm < 6) requestAnimationFrame(loop);
        else resolve();
      };
      requestAnimationFrame(loop);
    });
  }

  readonly capture = async (effects: string[], frames: number[], columns = 3): Promise<void> => {
    const { out, g, fx } = this;
    const canvas = this.render.renderer.domElement;
    const single = effects.length === 1;
    const cols = single ? columns : frames.length;
    const rows = single ? Math.ceil(frames.length / cols) : effects.length;
    out.width = innerWidth;
    out.height = innerHeight;
    out.style.display = 'block';
    const tw = Math.floor(out.width / cols);
    const th = Math.floor(out.height / rows);
    for (let row = 0; row < effects.length; row++) {
      const name = effects[row]!;
      await new Promise<void>(resolve => requestAnimationFrame(() => {
        fx.clear();
        this.fire(name);
        let at = 0;
        frames.forEach((f, i) => {
          this.step(f - at);
          at = f;
          const x = (single ? i % cols : i) * tw;
          const y = (single ? Math.floor(i / cols) : row) * th;
          g.drawImage(canvas, x, y, tw, th);
          g.fillStyle = '#fff';
          g.font = 'bold 13px monospace';
          g.fillText(`${name} f${f} ${((f / 60) * 1000).toFixed(0)}ms live ${fx.stats().particles}`, x + 6, y + 15);
        });
        resolve();
      }));
    }
  };
}
