/**
 * Guns on the ground. The drop key (`dropWeapon`) throws the gun in hand down with its mods and rounds (handover.ts), and anyone
 * takes it with E, or by walking over it when they do not own one and did not drop it. It lies there `LIFE` seconds, until the
 * run is reset, or until somebody takes it.
 *
 * Co-op: the host owns every drop. A guest's drop leaves its arsenal at once and goes to the host as `drop`; the host numbers
 * it and tells everyone (`add`). A take is the host's call: a guest asks (`take`), the host gives it to the first who asked
 * (`give` to them, `gone` to all), so two players never get one gun. The host's own drops and takes go the same way, locally.
 */
import * as THREE from 'three';
import type { Ctx } from '../core/contracts';
import type { WeaponId } from '../core/gameplay';
import type { WorldEvent } from '../net/worldProtocol';
import { WEAPONS } from './data';
import { cleanKit, cleanWire, keepsAGun, type GunKit, type WireGun } from './handover';
import type { ViewDef } from './viewmodels/def';
import { dressModel, restingModel } from './viewmodels/rest';

/** Seconds a dropped gun lies there. */
export const LIFE = 150;
/** Metres from the feet: E takes within `REACH`; walking over takes within `WALK`. */
const REACH = 2.2;
const WALK = 1.1;
/** Seconds of the throw down from the hands to the ground. */
const THROW = 0.35;
/** How far ahead of the feet it lands, how high it floats, and how fast it turns. */
const AHEAD = 1.3;
const FLOAT = 0.45;
const SPIN = 1.1;
/** Seconds a guest waits on the host's answer to a take before asking again. */
const ASK = 1.5;
/** The longest a gun is drawn on the ground, in metres. */
const MAX_LEN = 1.1;
const COLOR = '#ffc14a';

type GunEvent = Extract<WorldEvent, { t: 'gun' }>;

/** What the drops need of the arsenal (Weapons). */
export interface Arsenal {
  readonly owned: ReadonlySet<WeaponId>;
  readonly current: WeaponId;
  dropHeld(): GunKit | null;
  receive(kit: GunKit): void;
}

interface Drop extends WireGun {
  age: number;
  /** Mine: dropped by this player, which walking over never takes back. */
  mine: boolean;
  /** A guest's take in flight since this age, or -1. */
  asked: number;
  root: THREE.Object3D | null;
  /** Where the prompt hangs. */
  tag: THREE.Vector3;
}

const _v = new THREE.Vector3();

export class DroppedGuns {
  private readonly drops: Drop[] = [];
  private serial = 0;
  private prompt: { id: number; off: () => void } | null = null;

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

  private tell(event: Omit<GunEvent, 't'>, to?: string): void {
    this.session?.world?.sendGun({ t: 'gun', ...event }, to);
  }

  update(dt: number): void {
    const { player, input } = this.ctx;
    const s = this.session;
    const judge = !s || s.hosting;
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i]!;
      d.age += dt;
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
      if (d.asked >= 0 && d.age - d.asked < ASK) continue;
      const far = Math.hypot(d.at[0] - player.position.x, d.at[2] - player.position.z);
      if (far < best && Math.abs(d.at[1] - player.position.y) < 2) { best = far; near = d; }
    }
    if (this.prompt && this.prompt.id !== near?.id) this.unprompt();
    if (!near) return;
    if (!this.prompt) {
      const from = near.by && !near.mine ? ` (from ${near.by})` : '';
      this.prompt = { id: near.id, off: this.ctx.hud.follow(near.tag, `[${input.labelFor?.('interact') ?? 'E'}] Take ${WEAPONS[near.weapon].name}${from}`, COLOR) };
    }
    const walked = best < WALK && near.age > THROW && !near.mine && !this.arms.owned.has(near.weapon);
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
    const f = p.forward;
    const flat = Math.hypot(f.x, f.z) || 1;
    const at: [number, number, number] = [p.position.x + (f.x / flat) * AHEAD, p.position.y, p.position.z + (f.z / flat) * AHEAD];
    ctx.audio.play('weapon_holster');
    const s = this.session;
    // A guest's drop is the host's to number: it shows here when the host's `add` comes back.
    if (s && !s.hosting) return this.tell({ op: 'drop', gun: { ...kit, id: 0, at, by: '' } });
    this.add({ ...kit, id: ++this.serial, at, by: s?.lobby.me?.name ?? '' }, true);
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
    if (s) this.tell({ op: 'gone', id: d.id });
    this.taken(d);
  }

  private taken(kit: GunKit): void {
    const { ctx } = this;
    this.arms.receive(kit);
    ctx.fx.pickupSparkle(ctx.player.position, COLOR);
    ctx.audio.play('pickup_generic');
  }

  /** Lays a drop down here, and on the host tells every guest. */
  private add(gun: WireGun, mine: boolean): void {
    if (this.drops.some(d => d.id === gun.id)) return;
    const d: Drop = { ...gun, age: 0, mine, asked: -1, root: this.model(gun), tag: new THREE.Vector3(gun.at[0], gun.at[1] + FLOAT + 0.55, gun.at[2]) };
    this.drops.push(d);
    this.pose(d);
    if (this.session?.hosting) this.tell({ op: 'add', gun: this.wire(d) });
  }

  private wire(d: Drop): WireGun {
    return { weapon: d.weapon, mods: d.mods, fitted: d.fitted, mag: d.mag, reserve: d.reserve, id: d.id, at: d.at, by: d.by };
  }

  /** Host: a guest's drop or take. `at` is where the host sees that guest stand. */
  hostIn(value: GunEvent, from: string, at: THREE.Vector3, name: string): void {
    if (value.op === 'drop') {
      const kit = cleanKit(value.gun);
      if (!kit) return;
      const said = cleanWire({ ...value.gun, id: 0 })?.at;
      // Where the guest says it fell, if that is beside them on the host's screen; else at their feet.
      const spot: [number, number, number] = said && _v.set(...said).distanceTo(at) < 4 ? said : [at.x, at.y, at.z];
      this.add({ ...kit, id: ++this.serial, at: spot, by: name }, false);
    } else if (value.op === 'take') {
      const d = this.drops.find(x => x.id === value.id);
      if (!d || Math.hypot(d.at[0] - at.x, d.at[2] - at.z) > REACH + 1.5) return;
      this.remove(d.id);
      this.tell({ op: 'gone', id: d.id });
      this.tell({ op: 'give', gun: this.wire(d) }, from);
    }
  }

  /** Guest: the host's word on a drop. */
  guestIn(value: GunEvent): void {
    if (value.op === 'add') {
      const gun = cleanWire(value.gun);
      if (gun) this.add(gun, gun.by === (this.session?.lobby.me?.name ?? ''));
    } else if (value.op === 'gone' && typeof value.id === 'number') this.remove(value.id);
    else if (value.op === 'give') {
      const kit = cleanKit(value.gun);
      if (kit) this.taken(kit);
    }
  }

  /** Host: every gun lying out, for a guest who joined late. */
  catchUp(to: string): void {
    for (const d of this.drops) this.tell({ op: 'add', gun: this.wire(d) }, to);
  }

  /** The gun as it looks in the hands, its mods on, at most `MAX_LEN` long; null where there is no rig (tests). */
  private model(gun: GunKit): THREE.Object3D | null {
    const def = (this.ctx.viewmodel as unknown as { allDefs?: Record<string, ViewDef> }).allDefs?.[gun.weapon];
    if (!def || !this.ctx.render?.scene) return null;
    const { root, size } = restingModel(gun.weapon, def);
    dressModel(root, def, new Set(gun.fitted));
    root.scale.setScalar(Math.min(1, MAX_LEN / size));
    this.ctx.render.scene.add(root);
    return root;
  }

  /** Thrown down from chest height, then floating and turning over its spot. */
  private pose(d: Drop): void {
    if (!d.root) return;
    const fall = Math.min(1, d.age / THROW);
    const y = d.at[1] + FLOAT + (1 - fall * fall) * 0.9 + Math.sin(d.age * 2.2) * 0.04 * fall;
    d.root.position.set(d.at[0], y, d.at[2]);
    d.root.rotation.y = d.age * SPIN;
  }

  private remove(id: number): void {
    const i = this.drops.findIndex(d => d.id === id);
    if (i < 0) return;
    if (this.prompt?.id === id) this.unprompt();
    this.drops[i]!.root?.removeFromParent();
    this.drops.splice(i, 1);
  }

  private unprompt(): void {
    this.prompt?.off();
    this.prompt = null;
  }

  /** A new run: the ground is cleared. */
  reset(): void {
    while (this.drops.length > 0) this.remove(this.drops[0]!.id);
  }
}
