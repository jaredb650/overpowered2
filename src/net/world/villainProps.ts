/**
 * The villain's props are real for everyone (enemies/commander/): his devices (mines, tripwires, claymores, snares, beacons,
 * charges, mortar tubes), the steel shutters he drops across doors, and his smoke. They are the host's: laid, lit, tripped and
 * blown there, by and under any player. A guest draws each one where the host put it, with the same blink and tick, and its
 * shutters are real colliders; a guest's round on a device is sent to the host, which decides what it did. A player who arrives
 * late gets everything standing.
 */
import * as THREE from 'three';
import type { Barricades, Doorway } from '../../enemies/commander/barricades';
import type { Device, DeviceKind, Devices, Walker } from '../../enemies/commander/devices';
import type { Smoke } from '../../enemies/commander/smoke';
import type { WorldContext, WorldModule } from './context';
import type { PlayerTarget, Targeting } from './targeting';
import { validVec, type Vec } from './wire';

/** One device on the wire: [id, kind index, x, y, z, end x, end y, end z, facing x, facing z, model yaw, fuse left or -1]. */
type DeviceRow = number[];
/** One doorway on the wire: [x, z, dx, dz, width, floor]. */
type DoorRow = number[];

export type VillainPropsEvent =
  /** Host: devices laid (`add`), a fuse lit (`lit`), one gone (`gone`: 0 quietly, 1 shot apart, 2 gone off). */
  | { t: 'dev'; add?: DeviceRow[]; lit?: [number, number]; gone?: [number, number]; full?: boolean }
  /** Guest to host: my round found device `id`. */
  | { t: 'devshot'; id: number }
  /** Host to one guest: a cable took your legs at `at`. The stop is yours to feel; the hurt comes as `hurt`. */
  | { t: 'snared'; at: Vec }
  /** Host: a shutter came down across a doorway (`put`, `settled` when it fell before you arrived) or went (`take`, `blown`). */
  | { t: 'shutter'; put?: DoorRow; settled?: boolean; take?: DoorRow; blown?: boolean }
  /** Host: a smoke cloud at `at` with `left` seconds to run. */
  | { t: 'smoke'; at: Vec; left: number };

const KINDS: readonly DeviceKind[] = ['mine', 'tripwire', 'claymore', 'snare', 'beacon', 'charge', 'tube'];
/** A guest's rounds on devices a second, and how far from its body a shot may start. */
const SHOTS_PER_SECOND = 30;
const SHOT_RANGE = 400;

interface CommanderParts { devices: Devices; barricades: Barricades; smoke: Smoke }

const _dir = new THREE.Vector3();

export class VillainProps implements WorldModule {
  private parts: CommanderParts | null = null;
  private readonly walkers = new Map<string, Walker>();
  private readonly list: Walker[] = [];
  private readonly feet: THREE.Vector3[] = [];
  private readonly shots = new Map<string, { second: number; n: number }>();

  constructor(private readonly w: WorldContext, private readonly targeting: Targeting) {
    const { router } = w;
    router.guest('dev', value => this.devIn(value));
    router.host('devshot', (value, from, now) => this.shotIn(value.id, from, now));
    router.guest('snared', value => {
      // The same stop the host's own player gets (devices.ts `stop`); the damage is the host's `hurt`.
      if (!validVec(value.at) || !this.find()) return;
      const { ctx } = this.w;
      ctx.camera.addTrauma(0.6);
      ctx.player.push(ctx.player.velocity.clone().multiplyScalar(-0.85));
      ctx.audio.play('metal_clang', { position: new THREE.Vector3(...value.at), pitch: 0.7 });
    });
    router.guest('shutter', value => this.shutterIn(value));
    router.guest('smoke', value => {
      if (validVec(value.at) && Number.isFinite(value.left) && value.left > 0) this.find()?.smoke.show(new THREE.Vector3(...value.at), Math.min(60, value.left));
    });
  }

  /** The Commander is built with the enemies, after the world: found on first use and linked once. Null where there is none. */
  private find(): CommanderParts | null {
    if (this.parts) return this.parts;
    const commander = (this.w.manager as unknown as { outpost?: { commander?: CommanderParts } } | undefined)?.outpost?.commander;
    if (!commander?.devices) return null;
    this.parts = commander;
    const guest = !this.w.hosting;
    const { w } = this;
    commander.devices.link = {
      guest,
      added: d => { if (!guest && w.ready) w.send({ t: 'dev', add: [this.row(d)] }); },
      lit: d => { if (!guest && w.ready) w.send({ t: 'dev', lit: [d.id, d.fuse] }); },
      gone: (d, how) => { if (!guest && w.ready) w.send({ t: 'dev', gone: [d.id, how] }); },
      shot: d => { if (guest && w.ready) w.send({ t: 'devshot', id: d.id }); },
      walkers: () => this.everyone(),
    };
    const door = (d: Doorway, floor: number): DoorRow => [d.x, d.z, d.dx, d.dz, d.w, floor];
    commander.barricades.link = {
      guest,
      dropped: (d, floor) => { if (!guest && w.ready) w.send({ t: 'shutter', put: door(d, floor) }); },
      gone: (d, blown) => { if (!guest && w.ready) w.send({ t: 'shutter', take: door(d, 0), blown }); },
      feet: () => this.everyone().map(p => p.position),
    };
    commander.smoke.link = {
      guest,
      popped: at => { if (!guest && w.ready) w.send({ t: 'smoke', at: at.toArray() as Vec, left: 13 }); },
      feet: () => { this.feet.length = 0; for (const p of this.everyone()) this.feet.push(p.position); return this.feet; },
    };
    return this.parts;
  }

  /** Host: every living player as a device reads them. A remote player's snare is felt on their own screen. */
  private everyone(): readonly Walker[] {
    const { list } = this;
    list.length = 0;
    const you = this.w.session.lobby.you;
    for (const target of this.targeting.players()) {
      let walker = this.walkers.get(target.id);
      if (!walker) this.walkers.set(target.id, walker = this.walker(target, target.id === you));
      list.push(walker);
    }
    return list;
  }

  private walker(target: PlayerTarget, own: boolean): Walker {
    const { w } = this;
    const { player } = target;
    return {
      get position() { return player.position; },
      get velocity() { return player.velocity; },
      get alive() { return player.alive; },
      snared: (at, damage, cause) => {
        if (own) { this.parts?.devices.stop(at, damage, cause); return; }
        w.send({ t: 'snared', at: at.toArray() as Vec }, target.id);
        player.takeDamage({ amount: damage, from: at, type: 'crush', source: cause });
      },
    };
  }

  private row(d: Device): DeviceRow {
    const r = (n: number) => Math.round(n * 1000) / 1000;
    return [d.id, KINDS.indexOf(d.kind), r(d.position.x), r(d.position.y), r(d.position.z), r(d.end.x), r(d.end.y), r(d.end.z),
      r(d.facing.x), r(d.facing.z), r(d.model?.rotation.y ?? 0), d.lit ? r(d.fuse) : -1];
  }

  /** Host: everything standing, for a player who has just arrived. */
  catchUp(id: string): void {
    const parts = this.find();
    if (!parts || !this.w.hosting) return;
    this.w.send({ t: 'dev', add: parts.devices.live.map(d => this.row(d)), full: true }, id);
    for (const s of parts.barricades.standing) this.w.send({ t: 'shutter', put: [s.door.x, s.door.z, s.door.dx, s.door.dz, s.door.w, s.floor], settled: true }, id);
    for (const k of parts.smoke.standing) this.w.send({ t: 'smoke', at: k.at.toArray() as Vec, left: k.left }, id);
  }

  update(): void {
    const parts = this.find();
    if (!parts) return;
    if (this.w.hosting) {
      for (const id of this.walkers.keys()) if (!this.w.session.lobby.players.some(p => p.id === id)) this.walkers.delete(id);
      return;
    }
    // A guest's Commander never runs: his props are animated from here.
    const dt = this.w.ctx.time.dt;
    parts.devices.animate();
    parts.barricades.update(dt);
    parts.smoke.update(dt);
  }

  forgetPeer(id: string): void {
    this.shots.delete(id);
    this.walkers.delete(id);
  }

  /** Guest: the host's devices. */
  private devIn(value: Extract<VillainPropsEvent, { t: 'dev' }>): void {
    const devices = this.find()?.devices;
    if (!devices) return;
    if (value.full === true) {
      const keep = new Set((Array.isArray(value.add) ? value.add : []).map(row => row?.[0]));
      for (const d of [...devices.live]) if (!keep.has(d.id)) devices.take(d.id, 0);
    }
    if (Array.isArray(value.add)) for (const row of value.add.slice(0, 64)) {
      if (!Array.isArray(row) || row.length !== 12 || !row.every(Number.isFinite)) continue;
      const [id, kind, x, y, z, ex, ey, ez, fx, fz, yaw, fuse] = row as number[];
      const name = KINDS[kind!];
      if (!name || !Number.isInteger(id) || !validVec([x, y, z]) || !validVec([ex, ey, ez])) continue;
      devices.put(id!, name, new THREE.Vector3(x, y, z), new THREE.Vector3(ex, ey, ez), new THREE.Vector3(fx, 0, fz), yaw!, fuse!);
    }
    if (Array.isArray(value.lit) && value.lit.length === 2 && value.lit.every(Number.isFinite)) devices.light(value.lit[0], Math.max(0, Math.min(1e4, value.lit[1])));
    if (Array.isArray(value.gone) && value.gone.length === 2 && value.gone.every(Number.isFinite)) devices.take(value.gone[0], value.gone[1]);
  }

  /** Host: a guest's round on a device. Theirs if the device is live, in range of their body, and nothing of the world is between. */
  private shotIn(id: unknown, from: string, now: number): void {
    const devices = this.find()?.devices;
    const remote = this.w.sender(from, now);
    if (!devices || !remote || this.w.life(from).down) return;
    let s = this.shots.get(from);
    if (!s) this.shots.set(from, s = { second: 0, n: 0 });
    const second = Math.floor(now / 1000);
    if (second !== s.second) { s.second = second; s.n = 0; }
    if (++s.n > SHOTS_PER_SECOND) return;
    const d = devices.live.find(x => x.id === id);
    if (!d) return;
    const eye = remote.char.root.position.clone();
    eye.y += 1.6;
    // A wire can be cut at either post.
    const seen = (p: THREE.Vector3) => eye.distanceTo(p) <= SHOT_RANGE && this.w.visible(eye.toArray() as Vec, [p.x, p.y + 0.15, p.z]);
    if (!seen(d.position) && !(d.post && seen(d.end))) return;
    devices.shoot(d, _dir.subVectors(d.position, eye).normalize());
  }

  /** Guest: the host's shutters. */
  private shutterIn(value: Extract<VillainPropsEvent, { t: 'shutter' }>): void {
    const barricades = this.find()?.barricades;
    if (!barricades) return;
    const door = (row: unknown): (Doorway & { floor: number }) | null => {
      if (!Array.isArray(row) || row.length !== 6 || !row.every(n => Number.isFinite(n) && Math.abs(n) < 1e5)) return null;
      const [x, z, dx, dz, w, floor] = row as number[];
      return w! > 0 && w! < 40 ? { x: x!, z: z!, dx: dx!, dz: dz!, w: w!, floor: floor! } : null;
    };
    const put = door(value.put), take = door(value.take);
    if (put) barricades.put(put, put.floor, value.settled === true);
    if (take) barricades.take(take, value.blown === true);
  }
}

/** For a peer that is behind: which of this module's events may be left out (net/pressure.ts). A fact never is. */
export const VILLAIN_PROPS_WIRE: import('../pressure').WireClasses<VillainPropsEvent> = { dev: 'fact', devshot: 'fact', snared: 'fact', shutter: 'fact', smoke: 'fact' };
