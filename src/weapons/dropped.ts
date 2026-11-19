/**
 * Guns on the ground. The drop key (`dropWeapon`) throws the gun in hand down with its mods and rounds (handover.ts), and anyone
 * takes it with E. It comes to rest on the ground under where it was thrown (down off a ledge, short of a wall), and lies there
 * `LIFE` seconds, until the run is reset, or until somebody takes it. Solo, walking over a gun you do not own takes it too.
 *
 * Co-op: this is how players share guns. The host owns every drop.
 *  - A guest's drop leaves its arsenal at once and shows at once as a drop of its own (not yet numbered), and goes to the host
 *    as `drop`. The host numbers it and tells everyone (`add`). If the host refuses it (`back`), or never answers, the gun
 *    returns to the guest's hands: a drop is never lost.
 *  - A take is the host's call: a guest asks (`take`), the host gives it to the first who asked (`give` to them, `gone` to all,
 *    naming who took it), so two players never get one gun.
 *  - Taking is always a press of E: nobody hoovers up a friend's gift by walking over it.
 *  - A light column and a ring mark every drop, and the feed says who dropped what.
 *  - A guest whose world comes up late (loading, a late join, a rejoin) is sent every gun lying out, with its age.
 * On a dev page every message is logged at info level (`[coop gun]`), which the drops proof keeps as evidence. The built
 * site logs none of it.
 */
import * as THREE from 'three';
import { CG, type Ctx } from '../core/contracts';
import { DEV_TOOLS } from '../core/devflags';
import type { WeaponId } from '../core/gameplay';
import type { GunEvent } from '../net/world/guns';
import { WEAPONS } from './data';
import { cleanKit, cleanWire, keepsAGun, type GunKit, type WireGun } from './handover';
import type { ViewDef } from './viewmodels/def';
import { dressModel, restingModel } from './viewmodels/rest';

/** Seconds a dropped gun lies there. */
export const LIFE = 150;
/** Metres from the feet: E takes within `REACH`; walking over takes within `WALK` (solo only). */
const REACH = 2.2;
const WALK = 1.1;
/** Seconds of the throw down from the hands to level ground. */
const THROW = 0.35;
/** Metres above the feet the gun leaves the hands, and the fall's gravity: `HANDS` takes `THROW` seconds. */
const HANDS = 0.9;
const GRAVITY = (2 * HANDS) / (THROW * THROW);
/** How far ahead of the feet it lands, how high it floats, and how fast it turns. */
const AHEAD = 1.3;
const FLOAT = 0.45;
const SPIN = 1.1;
/** A drop keeps this far off a wall in front of the player, and falls at most this far to the ground. */
const WALL_GAP = 0.4;
const MAX_FALL = 80;
/** Seconds a guest waits on the host's answer to a take before asking again. */
const ASK = 1.5;
/** Co-op guest: seconds a drop waits for the host's number before the gun comes back to the hands. */
const RETURN = 4;
/** Co-op host: guns lying out at once, at most; the oldest goes. And how far from a guest's body its drop or take may be. */
const MAX_DROPS = 24;
const HOST_SLACK = 8;
/** The longest a gun is drawn on the ground, in metres. */
const MAX_LEN = 1.1;
const COLOR = '#ffc14a';
/** The marker over a drop in co-op: a thin column of light and a ring on the ground. */
const MARK = { height: 7, ring: 0.62 } as const;

/** What the drops need of the arsenal (Weapons). */
export interface Arsenal {
  readonly owned: ReadonlySet<WeaponId>;
  readonly current: WeaponId;
  dropHeld(): GunKit | null;
  receive(kit: GunKit): void;
}

interface Drop extends WireGun {
  age: number;
  /** Co-op: `performance.now()` when it was dropped (on this screen: when the news arrived, less its age). */
  born: number;
  /** Mine: dropped by this player, which walking over never takes back. */
  mine: boolean;
  /** Co-op: the roster slot of who dropped it (-1 unknown). */
  slot: number;
  /** Metres it falls from the hands to its rest. */
  fall: number;
  /** A guest's take in flight since this age, or -1. */
  asked: number;
  /** Co-op guest: this drop's request number while the host has not numbered it yet, else 0. */
  pending: number;
  root: THREE.Object3D | null;
  mark: THREE.Object3D | null;
  /** Where the prompt hangs. */
  tag: THREE.Vector3;
}

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const DOWN = new THREE.Vector3(0, -1, 0);

/** Dev pages only (`log?.(...)`: off, not even the line's words are put together). */
const log = DEV_TOOLS ? (...parts: unknown[]): void => console.info('[coop gun]', ...parts) : null;
const brief = (gun?: WireGun | GunKit): string => (gun ? `${gun.weapon} mods[${gun.fitted.join(',')}] ${gun.mag}+${gun.reserve}` : '');

export class DroppedGuns {
  private readonly drops: Drop[] = [];
  private serial = 0;
  private asks = 0;
  /** Co-op guest: requests the host never answered in time, whose guns went back to the hands. */
  private readonly voided = new Set<number>();
  private prompt: { id: number; off: () => void } | null = null;
  private markGeo: { column: THREE.BufferGeometry; ring: THREE.BufferGeometry; columnMat: THREE.Material; ringMat: THREE.Material } | null = null;

  constructor(private readonly ctx: Ctx, private readonly arms: Arsenal) {}

  /** The guns lying out now. */
  get list(): readonly WireGun[] {
    return this.drops;
  }

  /** The co-op session with a world (the host's), or null solo and in free roam. */
  private get session() {
    const s = this.ctx.coop;
    return s?.world ? s : null;
  }

  private get mySlot(): number {
    return this.session?.lobby.me?.slot ?? -1;
  }

  private tell(event: Omit<GunEvent, 't'>, to?: string): void {
    log?.('send', event.op, event.id ?? '', event.q ? `q${event.q}` : '', brief(event.gun), to ? `to ${to}` : '');
    this.session?.world?.sendGun({ t: 'gun', ...event }, to);
  }

  update(dt: number): void {
    const { player, input } = this.ctx;
    const s = this.session;
    const judge = !s || s.hosting;
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i]!;
      // Co-op: a gun's age is read off the wall clock, the same on every screen. The game's `dt` here is capped at 50 ms a frame,
      // so a page drawing slowly would have the gun still falling, and lying there longer than the host's.
      d.age = s ? Math.max(d.age, (performance.now() - d.born) / 1000) : d.age + dt;
      // The host never numbered this guest's drop: the gun comes back to the hands rather than vanish.
      if (d.pending && d.age > RETURN) {
        this.voided.add(d.pending);
        this.giveBack(d, 'NO ANSWER FROM THE HOST: GUN RETURNED');
        continue;
      }
      // The host's `gone` ends a drop on a guest; the guest's own clock is the backstop.
      if (d.age > LIFE + (judge ? 0 : 10)) {
        this.remove(d.id);
        if (s && judge) this.tell({ op: 'gone', id: d.id });
        continue;
      }
      this.pose(d);
    }
    if (!player.alive || player.parked) return this.unprompt();
    if (input.pressed('dropWeapon')) this.dropHeld();
    let near: Drop | null = null;
    let best = REACH;
    for (const d of this.drops) {
      if (d.pending || (d.asked >= 0 && d.age - d.asked < ASK)) continue;
      const far = Math.hypot(d.at[0] - player.position.x, d.at[2] - player.position.z);
      if (far < best && Math.abs(d.at[1] - player.position.y) < 2) { best = far; near = d; }
    }
    if (this.prompt && this.prompt.id !== near?.id) this.unprompt();
    if (!near) return;
    if (!this.prompt) {
      const from = near.by && !near.mine ? ` (from ${near.by})` : '';
      this.prompt = { id: near.id, off: this.ctx.hud.follow(near.tag, `[${input.labelFor?.('interact') ?? 'E'}] Take ${WEAPONS[near.weapon].name}${from}`, COLOR) };
    }
    // Solo, a gun you do not own is taken by walking over it. In co-op a take is always E: a gun on the ground may be a gift for
    // someone else.
    const walked = !s && best < WALK && near.age > this.landed(near) && !near.mine && !this.arms.owned.has(near.weapon);
    if (input.pressed('interact') || walked) this.take(near);
  }

  /** The drop key: the gun in hand goes down ahead of the feet, unless it is the last gun or the hands are busy. */
  private dropHeld(): void {
    const { ctx } = this;
    const id = this.arms.current;
    if (!keepsAGun(this.arms.owned, id)) {
      ctx.hud.callout?.('YOUR LAST GUN');
      return;
    }
    const kit = this.arms.dropHeld();
    if (!kit) return;
    const p = ctx.player;
    const { at, fall } = this.settle(p.position, p.forward);
    ctx.audio.play('weapon_holster');
    const s = this.session;
    const by = s?.lobby.me?.name ?? '';
    if (s && !s.hosting) {
      // A guest's drop is the host's to number. It lies here at once as its own, and takes the host's number when `add` comes back.
      const q = ++this.asks;
      this.add({ ...kit, id: -q, at, by }, true, this.mySlot, fall, 0).pending = q;
      return this.tell({ op: 'drop', q, fall, gun: { ...kit, id: 0, at, by: '' } });
    }
    const d = this.add({ ...kit, id: ++this.serial, at, by }, true, this.mySlot, fall, 0);
    if (s) this.announce(d);
  }

  /**
   * Where a gun thrown from `feet` towards `forward` comes to rest: `AHEAD` metres on, short of a wall in the way, on the ground
   * below (off a ledge it falls to the floor under it). `fall` is how far it drops from the hands.
   */
  private settle(feet: THREE.Vector3, forward: THREE.Vector3): { at: [number, number, number]; fall: number } {
    const physics = this.ctx.physics;
    const flat = Math.hypot(forward.x, forward.z) || 1;
    const dir = _w.set(forward.x / flat, 0, forward.z / flat);
    const hands = _v.set(feet.x, feet.y + HANDS, feet.z);
    const wall = physics.raycast(hands, dir, AHEAD + WALL_GAP, CG.World);
    const ahead = wall ? Math.max(0, wall.distance - WALL_GAP) : AHEAD;
    hands.addScaledVector(dir, ahead);
    const floor = physics.raycast(hands, DOWN, MAX_FALL, CG.World);
    // No floor in reach (a pit, the edge of the map): it stays at the feet's height, as it always has.
    const y = floor ? hands.y - floor.distance : feet.y;
    return { at: [hands.x, y, hands.z], fall: Math.max(0, hands.y - y) };
  }

  /** E or a walk-over on `d`. A guest asks the host; the host and a solo player take it. */
  private take(d: Drop): void {
    const s = this.session;
    if (s && !s.hosting) {
      d.asked = d.age;
      this.unprompt();
      return this.tell({ op: 'take', id: d.id });
    }
    this.remove(d.id);
    if (s) this.tell({ op: 'gone', id: d.id, to: s.lobby.me?.name ?? '' });
    this.taken(d);
  }

  private taken(kit: GunKit): void {
    const { ctx } = this;
    this.arms.receive(kit);
    ctx.fx.pickupSparkle(ctx.player.position, COLOR);
    ctx.audio.play('pickup_generic');
  }

  /** A guest's drop that the host refused or never numbered: off the ground here and back in the hands. */
  private giveBack(d: Drop, why: string): void {
    log?.('returned to the hands', brief(d), why);
    const kit: GunKit = { weapon: d.weapon, mods: d.mods, fitted: d.fitted, mag: d.mag, reserve: d.reserve };
    this.remove(d.id);
    this.arms.receive(kit);
    this.ctx.hud.feed(why, COLOR);
  }

  /** Lays a drop down here. `age` is how long it has lain already (a late guest sees it at rest, not thrown again). */
  private add(gun: WireGun, mine: boolean, slot: number, fall: number, age: number): Drop {
    const d: Drop = {
      ...gun, age, born: performance.now() - age * 1000, mine, slot, fall, asked: -1, pending: 0, root: this.model(gun), mark: null,
      tag: new THREE.Vector3(gun.at[0], gun.at[1] + FLOAT + 0.55, gun.at[2]),
    };
    if (this.session) d.mark = this.marker(d);
    this.drops.push(d);
    this.pose(d);
    return d;
  }

  private wire(d: Drop): WireGun {
    return { weapon: d.weapon, mods: d.mods, fitted: d.fitted, mag: d.mag, reserve: d.reserve, id: d.id, at: d.at, by: d.by };
  }

  /** Host: `d` as every guest is told of it; `q` is the request number of the guest in `slot` whose drop it answers. */
  private announce(d: Drop, to?: string, q?: number): void {
    this.tell({ op: 'add', gun: this.wire(d), slot: d.slot, fall: d.fall, age: d.age, ...(q ? { q } : {}) }, to);
  }

  /** Host: a guest's drop, take or withdrawal. `at` is where the host sees that guest stand, `slot` and `name` who they are. */
  hostIn(value: GunEvent, from: string, at: THREE.Vector3, name: string, slot = -1): void {
    log?.('host got', value.op, value.id ?? '', value.q ? `q${value.q}` : '', brief(value.gun), `from ${name}`);
    if (value.op === 'drop') {
      const q = Number.isInteger(value.q) && value.q! > 0 ? value.q! : 0;
      const kit = cleanKit(value.gun);
      // Refused: the guest still has the gun as a drop of its own, and takes it back on this word.
      if (!kit) return this.tell({ op: 'back', q }, from);
      const said = cleanWire({ ...value.gun, id: 0 })?.at;
      // Where the guest says it came to rest, if that is beside or below them on the host's screen; else at their feet.
      const near = said && Math.hypot(said[0] - at.x, said[2] - at.z) < HOST_SLACK && said[1] < at.y + 3 && said[1] > at.y - MAX_FALL;
      const spot: [number, number, number] = near ? said : [at.x, at.y, at.z];
      const fall = near && typeof value.fall === 'number' && Number.isFinite(value.fall) ? Math.min(MAX_FALL, Math.max(0, value.fall)) : HANDS;
      while (this.drops.length >= MAX_DROPS) {
        const oldest = this.drops[0]!;
        this.remove(oldest.id);
        this.tell({ op: 'gone', id: oldest.id });
      }
      const d = this.add({ ...kit, id: ++this.serial, at: spot, by: name }, false, slot, fall, 0);
      this.said(d);
      // The request number rides along: the guest in that slot knows its own drop by it, and gives it the host's number.
      this.announce(d, undefined, q);
    } else if (value.op === 'take') {
      const d = this.drops.find(x => x.id === value.id);
      // Gone already (another player was first): the asker hears nothing more than the `gone` everyone got.
      if (!d || Math.hypot(d.at[0] - at.x, d.at[2] - at.z) > REACH + HOST_SLACK) return void log?.('host refused the take', value.id ?? '', d ? 'too far' : 'not there');
      this.remove(d.id);
      this.tell({ op: 'gone', id: d.id, to: name });
      this.tell({ op: 'give', gun: this.wire(d) }, from);
      this.ctx.hud.feed(`${name} took the ${WEAPONS[d.weapon].name}`, COLOR);
    } else if (value.op === 'void') {
      // The guest gave up waiting and has the gun back in hand: the drop it numbered late must not make a second gun.
      const d = this.drops.find(x => x.id === value.id);
      if (!d || d.slot !== slot) return;
      this.remove(d.id);
      this.tell({ op: 'gone', id: d.id });
    }
  }

  /** Guest: the host's word on a drop. */
  guestIn(value: GunEvent): void {
    log?.('guest got', value.op, value.id ?? '', value.q ? `q${value.q}` : '', brief(value.gun), value.to ? `taken by ${value.to}` : '');
    if (value.op === 'add') {
      const gun = cleanWire(value.gun);
      if (!gun || gun.id <= 0) return;
      const slot = Number.isInteger(value.slot) ? value.slot! : -1;
      // A request number is mine only on a drop from my own slot.
      const q = Number.isInteger(value.q) && slot === this.mySlot ? value.q! : 0;
      // Too late: this player already has that gun back in hand.
      if (q && this.voided.delete(q)) return this.tell({ op: 'void', id: gun.id });
      const mine = q ? this.drops.find(d => d.pending === q) : undefined;
      if (mine) {
        // My own drop, numbered. It lies where the host put it: the same spot unless the host saw this player somewhere else
        // (a stale pose) and laid it at their feet there. One spot on every screen matters more than which.
        if (this.prompt?.id === mine.id) this.unprompt();
        mine.id = gun.id;
        mine.pending = 0;
        mine.by = gun.by;
        mine.at = gun.at;
        if (typeof value.fall === 'number' && Number.isFinite(value.fall)) mine.fall = Math.min(MAX_FALL, Math.max(0, value.fall));
        mine.tag.set(gun.at[0], gun.at[1] + FLOAT + 0.55, gun.at[2]);
        mine.mark?.position.set(gun.at[0], gun.at[1] + 0.03, gun.at[2]);
        return;
      }
      if (this.drops.some(d => d.id === gun.id)) return;
      const fall = typeof value.fall === 'number' && Number.isFinite(value.fall) ? Math.min(MAX_FALL, Math.max(0, value.fall)) : HANDS;
      const age = typeof value.age === 'number' && Number.isFinite(value.age) ? Math.min(LIFE, Math.max(0, value.age)) : 0;
      const d = this.add(gun, slot >= 0 && slot === this.mySlot, slot, fall, age);
      if (age < 2) this.said(d);
    } else if (value.op === 'gone' && typeof value.id === 'number') {
      const d = this.drops.find(x => x.id === value.id);
      if (!d) return;
      const me = this.session?.lobby.me?.name;
      const to = typeof value.to === 'string' ? value.to.slice(0, 24) : '';
      if (to && to !== me) this.ctx.hud.feed(d.asked >= 0 ? `${to} got to the ${WEAPONS[d.weapon].name} first` : `${to} took the ${WEAPONS[d.weapon].name}`, COLOR);
      this.remove(d.id);
    } else if (value.op === 'give') {
      const kit = cleanKit(value.gun);
      if (kit) this.taken(kit);
    } else if (value.op === 'back') {
      const d = this.drops.find(x => x.pending !== 0 && x.pending === value.q);
      if (d) this.giveBack(d, 'THE HOST REFUSED THAT DROP: GUN RETURNED');
    }
  }

  /** Host: every gun lying out, for a guest whose world has just come up. Sent every time one arrives; a gun is added once, by id. */
  catchUp(to: string): void {
    for (const d of this.drops) this.announce(d, to);
  }

  /** The feed line for a gun another player has just put down. */
  private said(d: Drop): void {
    if (d.by && !d.mine) this.ctx.hud.feed(`${d.by} dropped a ${WEAPONS[d.weapon].name}`, COLOR);
  }

  /** The gun as it looks in the hands, its mods on, at most `MAX_LEN` long; null where there is no rig (tests). */
  private model(gun: GunKit): THREE.Object3D | null {
    const def = (this.ctx.viewmodel as unknown as { allDefs?: Record<string, ViewDef> } | undefined)?.allDefs?.[gun.weapon];
    if (!def || !this.ctx.render?.scene) return null;
    const { root, size } = restingModel(gun.weapon, def);
    dressModel(root, def, new Set(gun.fitted));
    root.scale.setScalar(Math.min(1, MAX_LEN / size));
    this.ctx.render.scene.add(root);
    return root;
  }

  /** Co-op: a column of light over the drop's resting spot and a ring on the ground, so it is seen from across a room. */
  private marker(d: Drop): THREE.Object3D | null {
    if (!this.ctx.render?.scene) return null;
    if (!this.markGeo) {
      const tint = new THREE.Color(COLOR);
      const glow = (opacity: number): THREE.Material => new THREE.MeshBasicMaterial({
        color: tint.clone().multiplyScalar(2.2), transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false,
        side: THREE.DoubleSide, fog: false, toneMapped: false,
      });
      const column = new THREE.CylinderGeometry(0.02, 0.09, MARK.height, 8, 1, true);
      column.translate(0, MARK.height / 2, 0);
      const ring = new THREE.RingGeometry(MARK.ring - 0.05, MARK.ring, 40);
      ring.rotateX(-Math.PI / 2);
      this.markGeo = { column, ring, columnMat: glow(0.42), ringMat: glow(0.8) };
    }
    const g = new THREE.Group();
    g.add(new THREE.Mesh(this.markGeo.column, this.markGeo.columnMat), new THREE.Mesh(this.markGeo.ring, this.markGeo.ringMat));
    g.position.set(d.at[0], d.at[1] + 0.03, d.at[2]);
    g.visible = false;
    this.ctx.render.scene.add(g);
    return g;
  }

  /** Seconds from the hands to its rest. */
  private landed(d: Drop): number {
    return Math.sqrt((2 * Math.max(HANDS, d.fall)) / GRAVITY);
  }

  /** Thrown down from the hands, falling to its rest, then floating and turning over its spot. */
  private pose(d: Drop): void {
    const rest = this.landed(d);
    const down = Math.min(1, d.age / rest);
    if (d.mark) {
      // The marker comes up as the gun lands, and the ring breathes.
      d.mark.visible = d.age >= rest;
      d.mark.children[1]!.scale.setScalar(1 + Math.sin(d.age * 3) * 0.08);
    }
    if (!d.root) return;
    const height = Math.max(0, Math.max(HANDS, d.fall) - 0.5 * GRAVITY * d.age * d.age);
    d.root.position.set(d.at[0], d.at[1] + FLOAT + height + Math.sin(d.age * 2.2) * 0.04 * down, d.at[2]);
    d.root.rotation.y = d.age * SPIN;
  }

  private remove(id: number): void {
    const i = this.drops.findIndex(d => d.id === id);
    if (i < 0) return;
    if (this.prompt?.id === id) this.unprompt();
    this.drops[i]!.root?.removeFromParent();
    this.drops[i]!.mark?.removeFromParent();
    this.drops.splice(i, 1);
  }

  private unprompt(): void {
    this.prompt?.off();
    this.prompt = null;
  }

  /** A new run: the ground is cleared. */
  reset(): void {
    while (this.drops.length > 0) this.remove(this.drops[0]!.id);
    this.voided.clear();
  }
}
