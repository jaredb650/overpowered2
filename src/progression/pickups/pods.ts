/**
 * Weapon caches: a drop pod falls from the sky every second wave. It marks its landing zone first, hits hard enough to
 * flatten whatever is under it, then opens and waits. The map is big and this is what pulls the player across it.
 *
 * Supply pods (`supply`, where the Crucible sells its guns: contracts/shop): the same pod at the start of every break, but it is
 * not a pickup. It carries no gun and lands nearer (`SUPPLY`), with a beacon of light over its spot from the call; once open, E within reach opens
 * the shop (`shop:open`), and it is gone when the break ends, whoever reached it.
 *
 * Co-op: one pod for everyone. The host calls it (the spot, the turn it lands with, a number) and tells every guest (`pod`,
 * net/world/pods.ts); a guest never calls its own and flies the host's from the same spot on the same clock. A supply pod's shop
 * is each player's own purse at the shared pod. A weapon cache gives each player their own share once (the gun their own
 * arsenal is due), and stays for the others until all have taken or it times out: the host says when it goes (`gone`).
 */
import * as THREE from 'three';
import type { Ctx, EmitterHandle } from '../../core/contracts';
import type { WeaponId } from '../../core/gameplay';
import { lerp, pick, rand, smoothstep, TAU } from '../../core/math';
import { GroundProbe, GroundRing } from '../callins/ground';
import { aboveFloor } from '../callins/shared';
import { SHOP_ANYTIME } from '../../contracts/shop/data';
import { CACHE_ORDER, DROP_POD as D, PICKUP, PICKUP_LOOK } from '../data';
import { ModelBuilder, type ModelMaterials } from '../modelkit';
import type { PodEvent } from '../../net/world/pods';

const COLOR = '#39e0ff';
const COLLECT_RADIUS = 3;
const REFILL_FRACTION = 0.5;
const DOOR_OPEN = 1.5;
const MIN_SPOT_DISTANCE = 30;
/** Seconds from touch-down to doors down. */
const OPENING = 1.3;
/** Co-op guest: seconds a pod outlives what the host should have ended (a lost `gone` must not leave it standing for ever). */
const GUEST_GRACE = 10;

/** The supply pod: its colour, and the spots it prefers, near enough to run to in a break (12.5 m/s on foot). */
export const SUPPLY = {
  color: '#ffb400',
  label: 'SUPPLY POD',
  /** Metres from the player to the spot it would rather land on. */
  near: 25,
  far: 110,
  /** Metres from the pod at which E opens the shop. */
  reach: COLLECT_RADIUS + 1,
  beaconHeight: 70,
} as const;

const _up = new THREE.Vector3(0, 1, 0);
const _p = new THREE.Vector3();

function hull(): ModelBuilder {
  const b = new ModelBuilder();
  const steel = '#4a535d';
  const dark = '#262b31';
  const burnt = '#1a1715';
  // Three-sided armoured column on a heavy thruster skirt.
  b.cyl(1.05, 1.5, 0.6, 6, burnt, { at: [0, 0.3, 0] });
  b.cyl(0.68, 0.68, 3.1, 6, dark, { at: [0, 2.0, 0] });
  b.cyl(0.25, 1.15, 1.1, 6, steel, { at: [0, 4.15, 0] });
  b.cyl(0.14, 0.14, 0.6, 6, dark, { at: [0, 4.95, 0] });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU + Math.PI / 6;
    b.box(0.14, 1.9, 0.9, steel, { at: [Math.cos(a) * 1.3, 0.95, Math.sin(a) * 1.3], rot: [0, -a, 0] });
    b.box(0.24, 0.3, 0.4, burnt, { at: [Math.cos(a) * 1.45, 0.15, Math.sin(a) * 1.45], rot: [0, -a, 0] });
    b.glow(new THREE.BoxGeometry(0.03, 1.5, 0.05), COLOR, 3, { at: [Math.cos(a) * 1.38, 1.0, Math.sin(a) * 1.38], rot: [0, -a, 0] });
  }
  // The weapon crate inside, seen once the doors drop.
  b.box(0.8, 0.5, 0.5, '#2f353b', { at: [0, 1.25, 0] });
  b.glow(new THREE.BoxGeometry(0.84, 0.04, 0.54), COLOR, 4, { at: [0, 1.5, 0] });
  b.glow(new THREE.BoxGeometry(0.34, 0.2, 0.02), COLOR, 2.2, { at: [0, 1.25, 0.26] });
  return b;
}

function door(): ModelBuilder {
  const b = new ModelBuilder();
  // Hinged at its base, so it can fall open like a petal.
  b.box(1.08, 3.0, 0.12, '#59636e', { at: [0, 1.5, 0] });
  b.box(0.86, 2.6, 0.04, '#333a42', { at: [0, 1.5, 0.08] });
  b.box(0.9, 0.08, 0.14, '#7a848f', { at: [0, 2.9, 0] });
  b.glow(new THREE.BoxGeometry(0.5, 0.05, 0.02), COLOR, 3, { at: [0, 2.5, 0.1] });
  return b;
}

type PodPhase = 'warning' | 'falling' | 'landed' | 'open' | 'spent';

interface Pod {
  phase: PodPhase;
  weapon: WeaponId | null;
  /** HUD minimap entry, kept live while there is something to fetch. */
  entry: { kind: 'weaponCache'; position: THREE.Vector3; active: boolean };
  group: THREE.Group;
  doors: THREE.Group[];
  ring: GroundRing;
  timer: number;
  trail: EmitterHandle | null;
  marker: (() => void) | null;
  /** Co-op: the host's number for this pod (0 solo), the turn it lands with, seconds since it was called. */
  id: number;
  yaw: number;
  age: number;
  /** Co-op cache: this player has had their share; the pod stays for the others. */
  taken: boolean;
  /** Co-op host, a cache: the lobby ids of who has had their share. */
  takers: Set<string>;
  /** Co-op guest: seconds the break has been over with this supply pod still standing. */
  stale: number;
}

export class DropPods {
  /** Minimap entries. */
  readonly entries: Pod['entry'][] = [];
  private readonly pods: Pod[] = [];
  private readonly probe: GroundProbe;
  private readonly nextDoorAngles = [0, TAU / 3, (2 * TAU) / 3];
  /** Supply mode: the pod that is open and within reach now, if any; and the prompt over it. */
  private near: Pod | null = null;
  private unprompt: (() => void) | null = null;
  private readonly beacons: THREE.Mesh[] = [];
  private serial = 0;
  private readonly center = new THREE.Vector3();
  /** Co-op: `performance.now()` at the last update (0 before the first), and the seconds the pods' clock is behind the wall's. */
  private wall = 0;
  private behind = 0;

  constructor(private readonly ctx: Ctx, materials: ModelMaterials, readonly supply = false) {
    this.probe = new GroundProbe(ctx);
    for (let i = 0; i < 2; i++) {
      const group = materials.group(hull());
      const doors: THREE.Group[] = [];
      for (const a of this.nextDoorAngles) {
        const pivot = new THREE.Group();
        pivot.rotation.y = a;
        const hinge = new THREE.Group();
        hinge.position.z = 0.82;
        hinge.position.y = 0.46;
        hinge.add(materials.group(door()));
        pivot.add(hinge);
        group.add(pivot);
        doors.push(hinge);
      }
      if (supply) {
        // A column of light over its landing spot from the moment it is called, seen across the map: where to run.
        const beacon = new THREE.Mesh(
          new THREE.CylinderGeometry(0.22, 0.6, SUPPLY.beaconHeight, 10, 1, true),
          new THREE.MeshBasicMaterial({
            color: new THREE.Color(SUPPLY.color).multiplyScalar(2.4), transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending,
            depthWrite: false, side: THREE.DoubleSide, fog: false, toneMapped: false,
          }),
        );
        beacon.visible = false;
        ctx.render.scene.add(beacon);
        this.beacons.push(beacon);
      }
      group.visible = false;
      ctx.render.scene.add(group);
      const entry = { kind: 'weaponCache' as const, position: new THREE.Vector3(), active: false };
      this.pods.push({
        phase: 'spent', weapon: null, entry, group, doors, ring: new GroundRing(ctx), timer: 0, trail: null, marker: null,
        id: 0, yaw: 0, age: 0, taken: false, takers: new Set(), stale: 0,
      });
      this.entries.push(entry);
    }
  }

  /** The co-op session with a world, or null solo and in free roam. */
  private get session() {
    const s = this.ctx.coop;
    return s?.world ? s : null;
  }

  /** Co-op: a guest, whose pods are the host's. */
  private get guest(): boolean {
    const s = this.session;
    return !!s && !s.hosting;
  }

  private tell(event: Omit<PodEvent, 't' | 'supply'>, to?: string): void {
    this.session?.world?.sendPod({ t: 'pod', supply: this.supply, ...event }, to);
  }

  /** Every second wave clear sends one. A supply pod comes every break. In co-op the host's is everyone's. */
  onWaveClear(wave: number): void {
    if (this.guest) return;
    if (this.supply || wave % D.everyWaves === 0) this.call();
  }

  /** Supply mode: an open pod within `SUPPLY.reach` of the player. */
  get supplyNear(): boolean {
    return this.near !== null;
  }

  private nextWeapon(): WeaponId | null {
    if (this.supply) return null;
    const owned = this.ctx.weapons.owned;
    for (const id of CACHE_ORDER) {
      if (owned.has(id)) continue;
      // Two pods in the air must not carry the same gun.
      if (!this.pods.some(p => p.weapon === id && p.phase !== 'spent')) return id;
    }
    return null;
  }

  private landingSpot(): THREE.Vector3 | null {
    const spots = this.ctx.world.pickupSpots;
    if (!spots || spots.length === 0) return null;
    const me = this.middle();
    let fallback: THREE.Vector3 | null = null;
    for (let i = 0; i < 16; i++) {
      const spot = pick(spots);
      // A pod needs open sky. Indoor spots are skipped unless nothing else turns up.
      if (this.probe.headroom(spot.x, spot.y + 1, spot.z, D.height) < D.height) {
        fallback ??= spot;
        continue;
      }
      const d = spot.distanceTo(me);
      if (this.supply ? d >= SUPPLY.near && d <= SUPPLY.far : d >= MIN_SPOT_DISTANCE) return spot;
      fallback = spot;
    }
    return fallback;
  }

  /** Where the pod is measured from: the player, or in co-op the middle of everyone in the world, so it is a fair run for all. */
  private middle(): THREE.Vector3 {
    const s = this.session;
    const c = this.center.copy(this.ctx.player.position);
    if (!s) return c;
    let n = 1;
    for (const remote of s.remotes.values()) {
      if (!remote.char.root.visible) continue;
      c.add(remote.char.root.position);
      n++;
    }
    return c.divideScalar(n);
  }

  /** Calls a pod down at `at`, or at a spot of its own choosing. A co-op guest calls none: the host's reaches it as `pod`. */
  call(at?: THREE.Vector3): void {
    if (this.guest) return;
    const pod = this.pods.find(p => p.phase === 'spent');
    const spot = at ?? this.landingSpot();
    if (!pod || !spot) return;
    const floor = this.probe.heightAt(spot.x, spot.y + 2, spot.z, 40);
    pod.entry.position.copy(spot);
    if (!Number.isNaN(floor)) pod.entry.position.y = floor;
    pod.id = this.session ? ++this.serial : 0;
    pod.yaw = rand(0, TAU);
    this.begin(pod, 0);
    if (pod.id) this.tell({ op: 'call', id: pod.id, at: pod.entry.position.toArray() as [number, number, number], yaw: pod.yaw, age: 0 });
  }

  /**
   * The pod is on its way to `pod.entry.position`: the marker, the beacon, the ring and the call. `age` is how long ago it was
   * called (co-op: a guest who arrives in a break gets the pod where it is in its fall, or standing open, not from the top).
   */
  private begin(pod: Pod, age: number): void {
    const { audio, hud } = this.ctx;
    pod.weapon = this.nextWeapon();
    pod.phase = 'warning';
    pod.timer = 0;
    pod.age = 0;
    pod.taken = false;
    pod.stale = 0;
    pod.takers.clear();
    pod.entry.active = true;
    this.beacons[this.pods.indexOf(pod)]?.position.copy(pod.entry.position).setY(pod.entry.position.y + SUPPLY.beaconHeight / 2 + 1);
    this.beaconOf(pod, true);
    const color = this.supply ? SUPPLY.color : COLOR;
    pod.ring.setColor(color, 2);
    pod.marker = hud.marker(_p.copy(pod.entry.position).setY(pod.entry.position.y + 3), this.supply ? SUPPLY.label : PICKUP_LOOK.weaponCache.label, color);
    if (age < 1) audio.play('cache_incoming');
    hud.feed(this.supply ? 'SUPPLY POD INBOUND: THE SHOP IS IN IT UNTIL THE BREAK ENDS' : 'WEAPON CACHE INBOUND', color);
    if (age > 0) this.skipTo(pod, age);
  }

  /** Puts a pod just called where it would be `age` seconds on, without the landing: what a late guest missed has happened. */
  private skipTo(pod: Pod, age: number): void {
    const fall = D.height / D.speed;
    pod.age = age;
    if (age < D.warnSeconds) {
      pod.timer = age;
      return;
    }
    this.startFall(pod, age < D.warnSeconds + 0.5);
    pod.timer = age - D.warnSeconds;
    if (pod.timer < fall) return;
    // Down already: stood there, no blast, the doors as far open as they would be.
    pod.trail?.stop();
    pod.trail = null;
    pod.ring.hide();
    pod.group.position.copy(pod.entry.position);
    pod.phase = 'landed';
    pod.timer -= fall;
    if (pod.timer < OPENING) return;
    for (const d of pod.doors) d.rotation.x = DOOR_OPEN;
    pod.phase = 'open';
    pod.timer -= OPENING;
  }

  /** Co-op: the host's word on a pod (a guest), or a guest's on its share of a cache (the host). */
  netIn(value: PodEvent, from: string): void {
    const s = this.session;
    if (!s || value.supply !== this.supply || !Number.isInteger(value.id) || value.id <= 0) return;
    if (s.hosting) {
      if (value.op !== 'took' || this.supply) return;
      const pod = this.pods.find(p => p.id === value.id && p.phase === 'open');
      if (pod) { pod.takers.add(from); this.settle(pod); }
      return;
    }
    if (value.op === 'gone') {
      const pod = this.pods.find(p => p.id === value.id && p.phase !== 'spent');
      if (pod) this.retire(pod);
      return;
    }
    if (value.op !== 'call' || this.pods.some(p => p.id === value.id && p.phase !== 'spent')) return;
    const at = value.at;
    if (!Array.isArray(at) || at.length !== 3 || !at.every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) < 1e5)) return;
    const pod = this.pods.find(p => p.phase === 'spent');
    if (!pod) return;
    pod.entry.position.set(at[0], at[1], at[2]);
    pod.id = value.id;
    pod.yaw = typeof value.yaw === 'number' && Number.isFinite(value.yaw) ? value.yaw : 0;
    this.begin(pod, typeof value.age === 'number' && Number.isFinite(value.age) ? Math.min(Math.max(0, value.age), 3600) : 0);
  }

  /** Co-op host: every pod out now, for a guest whose world has just come up (joined late, loaded slowly, came back). */
  catchUp(to: string): void {
    for (const pod of this.pods) {
      if (pod.phase === 'spent' || !pod.id) continue;
      this.tell({ op: 'call', id: pod.id, at: pod.entry.position.toArray() as [number, number, number], yaw: pod.yaw, age: pod.age }, to);
    }
  }

  /** Co-op host, a cache: gone once every player in the match has had their share. */
  private settle(pod: Pod): void {
    const s = this.session;
    if (!s?.hosting || !pod.taken) return;
    for (const p of s.lobby.players) if (!p.host && !pod.takers.has(p.id)) return;
    this.retire(pod);
  }

  update(dt: number): void {
    // Co-op: the pod is one clock on every screen, so it runs on the wall clock. The game's `realDt` is capped at 50 ms a frame,
    // and a page that hitched (a slow frame as the banner and the pod first draw) would fly its pod that much behind the others for good.
    if (this.session) {
      const now = performance.now();
      // What the frames' own `dt` has fallen short of the wall clock is paid back; being a little ahead is only frame jitter.
      if (this.wall > 0) this.behind = Math.max(-0.1, this.behind + Math.min(2, (now - this.wall) / 1000) - dt);
      this.wall = now;
      if (this.behind > 0.03) {
        dt += this.behind;
        this.behind = 0;
      }
    }
    // A supply pod lasts the break it came in. Retraining's stays (SHOP_ANYTIME). In co-op the host ends it for everyone: a guest's
    // own copy of the waves can lag the break by a snapshot, and only stands in if the host's word never comes.
    if (this.supply && !SHOP_ANYTIME && this.ctx.waves.phase !== 'intermission') {
      for (const pod of this.pods) {
        if (pod.phase === 'spent') continue;
        if (this.guest && (pod.stale += dt) < GUEST_GRACE) continue;
        this.retire(pod);
      }
    } else if (this.guest) for (const pod of this.pods) pod.stale = 0;
    for (const pod of this.pods) if (pod.phase !== 'spent') this.step(pod, dt);
    if (this.supply) this.readSupply();
  }

  /** Supply mode: the prompt at an open pod within reach, and E there opens the shop. */
  private readSupply(): void {
    const { player, input, hud, events } = this.ctx;
    let near: Pod | null = null;
    if (player.alive) {
      for (const pod of this.pods) {
        if (pod.phase === 'open' && player.position.distanceTo(_p.copy(pod.entry.position).setY(pod.entry.position.y + 0.5)) < SUPPLY.reach) near = pod;
      }
    }
    if (near !== this.near) {
      this.unprompt?.();
      this.unprompt = null;
      this.near = near;
      if (near) {
        const key = input.labelFor?.('interact') ?? 'E';
        this.unprompt = hud.follow(_p.copy(near.entry.position).setY(near.entry.position.y + 1.4).clone(), `${key} SHOP`, SUPPLY.color);
      }
    }
    if (near && input.pressed('interact')) events.emit('shop:open', {});
  }

  private step(pod: Pod, dt: number): void {
    pod.timer += dt;
    pod.age += dt;
    const target = pod.entry.position;
    switch (pod.phase) {
      case 'warning':
        pod.ring.show(target, D.impactRadius);
        pod.ring.setOpacity(0.6 + Math.sin(pod.timer * 9) * 0.3);
        pod.ring.tick(pod.timer);
        if (pod.timer >= D.warnSeconds) this.startFall(pod);
        break;
      case 'falling': {
        const fall = D.height / D.speed;
        const y = lerp(target.y + D.height, target.y, Math.min(1, pod.timer / fall));
        pod.group.position.set(target.x, y, target.z);
        pod.ring.show(target, D.impactRadius);
        pod.ring.setOpacity(0.9);
        pod.ring.tick(pod.timer);
        if (pod.timer >= fall) this.land(pod);
        break;
      }
      case 'landed': {
        const open = smoothstep(0.7, OPENING, pod.timer);
        // Peak on the first frame of the fall, then a small bounce: heavy doors dropping onto concrete.
        const swing = open * DOOR_OPEN + Math.sin(open * Math.PI) * 0.12;
        for (const d of pod.doors) d.rotation.x = swing;
        if (pod.timer >= 0.7 && pod.timer - dt < 0.7) this.ctx.audio.play('cache_open', { position: target });
        if (pod.timer >= OPENING) {
          pod.phase = 'open';
          pod.timer = 0;
        }
        break;
      }
      case 'open': {
        this.ctx.render.lights.flash(_p.copy(target).setY(target.y + 2), this.supply ? SUPPLY.color : COLOR, 6, 12, 0.09);
        // A supply pod waits for E (readSupply) and the break's end, not for the player to walk in.
        if (this.supply) break;
        if (!pod.taken && this.ctx.player.alive && this.ctx.player.position.distanceTo(_p.copy(target).setY(target.y + 0.5)) < COLLECT_RADIUS + 1) this.collect(pod);
        // A guest's cache goes on the host's word; its own clock only stands in for a word that never came.
        else if (pod.timer >= D.life + (this.guest ? GUEST_GRACE : 0)) this.retire(pod);
        break;
      }
    }
  }

  private startFall(pod: Pod, loud = true): void {
    const { audio, fx } = this.ctx;
    pod.phase = 'falling';
    pod.timer = 0;
    pod.group.visible = true;
    for (const d of pod.doors) d.rotation.x = 0;
    pod.group.rotation.y = pod.yaw;
    pod.group.position.copy(pod.entry.position).setY(pod.entry.position.y + D.height);
    pod.trail = fx.attachEmitter(pod.group, 'hellfireTrail', new THREE.Vector3(0, 0.2, 0), D.height / D.speed + 0.2);
    if (loud) audio.play('missile_incoming', { position: pod.entry.position });
  }

  private land(pod: Pod): void {
    const { audio, camera, combat, fx, player, render } = this.ctx;
    const p = pod.entry.position;
    pod.phase = 'landed';
    pod.timer = 0;
    pod.group.position.copy(p);
    pod.ring.hide();
    pod.trail?.stop();
    pod.trail = null;
    // Co-op: the pod lands once, on the host. Its blast is the host's to count, and reaches a guest's screen as that explosion
    // (net/world/booms.ts) at the moment its own copy touches down; a second blast here would hit the enemies again.
    if (!this.guest) {
      combat.explode(aboveFloor(p), {
        radius: D.impactRadius, damage: D.impactDamage, kind: 'rocket', source: 'drop_pod', team: 'player', selfDamage: 0, playerPush: 10,
      });
    }
    audio.play('cache_land', { position: p });
    fx.dust(p, _up, 4);
    fx.ring(p, _up, this.supply ? SUPPLY.color : COLOR, D.impactRadius * 2);
    render.decals.add('crack', p, _up, D.impactRadius * 1.1, rand(0, TAU));
    const d = player.position.distanceTo(p);
    camera.addTrauma(Math.max(0, 0.6 - d / 90));
  }

  private collect(pod: Pod): void {
    const { audio, events, fx, hud, render, weapons } = this.ctx;
    const p = _p.copy(pod.entry.position).setY(pod.entry.position.y + 1.5);
    audio.play('weapon_unlock');
    fx.pickupSparkle(p, COLOR);
    fx.ring(p, _up, COLOR, 8);
    render.post.flash(COLOR, 0.35, 0.3);
    render.post.chromatic(0.5, 0.3);
    const id = pod.weapon;
    if (id) {
      // The HUD stamps the unlock itself, off the event this fires.
      weapons.give(id);
      weapons.switchTo(id);
    } else {
      // Arsenal complete: a pod still pays out.
      weapons.addAmmo(REFILL_FRACTION);
      weapons.addGrenades(PICKUP.grenades * 3);
      weapons.refillMagazines();
      hud.feed('FULL RESUPPLY', COLOR);
    }
    events.emit('pickup:collected', { kind: 'weaponCache', position: p });
    const s = this.session;
    if (!s || !pod.id) return this.retire(pod);
    // Co-op: that was this player's share. The pod stands for the others, unmarked here, until the host says it is gone.
    pod.taken = true;
    pod.entry.active = false;
    pod.marker?.();
    pod.marker = null;
    if (s.hosting) this.settle(pod);
    else this.tell({ op: 'took', id: pod.id });
  }

  private retire(pod: Pod): void {
    if (pod.id && pod.phase !== 'spent' && this.session?.hosting) this.tell({ op: 'gone', id: pod.id });
    pod.id = 0;
    pod.phase = 'spent';
    pod.weapon = null;
    pod.entry.active = false;
    pod.marker?.();
    pod.marker = null;
    pod.group.visible = false;
    pod.ring.hide();
    pod.trail?.stop();
    pod.trail = null;
    this.beaconOf(pod, false);
    if (this.near === pod) {
      this.unprompt?.();
      this.unprompt = null;
      this.near = null;
    }
  }

  private beaconOf(pod: Pod, on: boolean): void {
    const b = this.beacons[this.pods.indexOf(pod)];
    if (b) b.visible = on;
  }

  clear(): void {
    for (const pod of this.pods) this.retire(pod);
  }
}
