/**
 * Outpost Defense at run time (docs/proposals/outpost-defense.md, piece 5): the credits, the loadout at the start, the three
 * shops as places to walk up to, breaks between waves, a shop's loss and rebuild. `ctx.contracts.defense` on that
 * contract, null on every other. The rules are economy.ts and the prices data.ts; this file only reads the run and
 * carries purchases out.
 *
 * The wave hook for piece 7 is `DefenseWaves`: whatever `ctx.waves` is, this reads `wave` and `phase`, listens to
 * `wave:start` and `wave:clear`, writes `nextWaveIn` when a break begins, and asks it for `preview` and `breakSeconds` if
 * it has them. Until the director lands, Endless Humans' own waves run (enemies/index.ts gives this contract the Outpost's).
 */
import * as THREE from 'three';
import { ALLY_SOURCE } from '../../allies/data';
import type { Ctx } from '../../core/contracts';
import { DEV_TOOLS } from '../../core/devflags';
import type { WaveSystem, WeaponId } from '../../core/gameplay';
import type { Emplacement } from '../../vehicles/emplacement';
import { MOUNT_LEVELS } from '../../vehicles/emplacement';
import { TUNING } from '../../weapons/data';
import { ACTIVE } from '../select';
import {
  ECONOMY, LOADOUT_MELEE, SHOPS, SHOP_ORDER, WEAPON_PRICES, killPay, placeholderPreview, wavePay, type ShopId,
} from './data';
import { ShopState, checkLoadout, offers, sameAct, type Act, type Offer, type ShopView } from './economy';

/**
 * What Outpost Defense needs from whatever runs its waves. Endless Humans' `OutpostWaves` is all of this but the optional
 * two. The wave director (piece 7) is `ctx.waves` on this contract, and adds `preview` and `breakSeconds` to steer breaks.
 */
export interface DefenseWaves extends WaveSystem {
  /** Written once as each break begins. */
  nextWaveIn: number;
  /** The break's line about the wave that is coming. */
  preview?(wave: number): string;
  /** Seconds of the break before `wave`. */
  breakSeconds?(wave: number): number;
}

/** Where a shop stands. The fort map exports these; until it does, the Test Range's stand in. */
export interface ShopAnchor {
  position: THREE.Vector3;
  /** Which way the counter faces, as a camera's yaw. */
  yaw: number;
}

export interface ShopAnchors {
  barracks: ShopAnchor;
  armoury: ShopAnchor;
  infirmary: ShopAnchor;
  /** Where a new hire takes his post. */
  rally: THREE.Vector3;
}

const anchor = (x: number, z: number, yaw: number): ShopAnchor => ({ position: new THREE.Vector3(x, 0, z), yaw });

/** The Test Range: behind the spawn, clear of the gallery and the guns. Swap for the fort's export when it lands. */
export const RANGE_ANCHORS: ShopAnchors = {
  barracks: anchor(-16, 21, 0),
  armoury: anchor(-8, 23, 0),
  infirmary: anchor(0, 24, 0),
  rally: new THREE.Vector3(0, 0, 4),
};

declare module '../../core/contracts' {
  interface GameEvents {
    /** The HUD puts up the loadout or a shop's menu, and pauses the run under it. */
    'defense:open': { screen: 'loadout' | ShopId };
  }
}

declare module '../../core/gameplay' {
  interface ContractSystem {
    /** Outpost Defense's economy. Null on any other contract. */
    readonly defense?: Defense | null;
  }
}

/** Metres from a counter at which E opens it. */
const REACH = 2.6;
const SIGN_HEIGHT = 2.3;
const LOST_COLOR = '#ff3a2a';

interface Kiosk {
  id: ShopId;
  root: THREE.Group;
  sign: THREE.MeshBasicMaterial;
  label: THREE.Vector3;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

export class Defense {
  credits = 0;
  /** Credits earned this run, for the report and the tests. */
  earned = 0;
  readonly shops: Record<ShopId, ShopState> = { barracks: new ShopState('barracks'), armoury: new ShopState('armoury'), infirmary: new ShopState('infirmary') };
  /** Set by a new run, cleared by `deploy`. The run waits paused on the loadout screen until then. */
  needLoadout = false;
  anchors: ShopAnchors = RANGE_ANCHORS;

  private kiosks: Kiosk[] = [];
  private prompted: Kiosk | null = null;
  private unprompt: (() => void) | null = null;
  private asked = false;
  /** The wave whose break has had its length set, or -1 while a wave is on. */
  private breakFor = -1;

  constructor(private readonly ctx: Ctx) {}

  init(): void {
    const { events } = this.ctx;
    events.on('enemy:killed', e => {
      if (!ALLY_SOURCE.test(e.damage.source)) this.earn(killPay(e.headshot));
    });
    events.on('wave:clear', e => {
      const pay = wavePay(e.wave);
      this.earn(pay);
      this.ctx.hud.feed(`+${pay} CREDITS: WAVE ${e.wave} HELD`, '#ffc14a');
    });
    this.build();
    if (DEV_TOOLS) this.debug();
  }

  reset(): void {
    this.credits = this.earned = 0;
    for (const id of SHOP_ORDER) this.shops[id].restore();
    this.paint();
    this.needLoadout = true;
    this.asked = false;
    this.breakFor = -1;
    this.prompt(null);
    // Each gun starts the run as a heavy machine gun (proposal: Mounted guns).
    for (const gun of this.mounts()) gun.upgrade(1);
  }

  update(): void {
    if (this.needLoadout) {
      if (!this.asked) {
        this.asked = true;
        this.ctx.events.emit('defense:open', { screen: 'loadout' });
      }
      return;
    }
    this.hookBreak();
    this.readCounter();
  }

  // --- Waves -----------------------------------------------------------------------------------

  get waves(): DefenseWaves {
    return this.ctx.waves as DefenseWaves;
  }

  get inBreak(): boolean {
    return this.waves.phase === 'intermission';
  }

  /** The line under the break's countdown. */
  get preview(): string {
    const next = this.waves.wave + 1;
    return this.waves.preview?.(next) ?? placeholderPreview(next);
  }

  /** A break's length is set once, as it begins: the director's if it has one, else the table's. */
  private hookBreak(): void {
    const w = this.waves;
    const key = w.phase === 'intermission' ? w.wave : -1;
    if (key === this.breakFor) return;
    this.breakFor = key;
    if (key < 0) return;
    w.nextWaveIn = w.breakSeconds?.(key + 1) ?? (key === 0 ? ECONOMY.firstBreak : ECONOMY.breakSeconds);
  }

  /** Ends the break now. For the lab and bots; the player waits it out. */
  skipBreak(): void {
    if (this.inBreak) this.waves.nextWaveIn = 0;
  }

  // --- Credits and the loadout -----------------------------------------------------------------

  earn(amount: number): void {
    this.credits += amount;
    this.earned += amount;
  }

  /** Arms the player from the loadout screen. The budget not spent becomes credits. Returns why not, or null. */
  deploy(primary: WeaponId | null, secondary: WeaponId | null): string | null {
    const check = checkLoadout(primary, secondary);
    if (check.why) return check.why;
    this.ctx.weapons.setLoadout([primary!, secondary!, LOADOUT_MELEE], 0);
    this.credits = check.left;
    this.needLoadout = false;
    return null;
  }

  // --- Shops -----------------------------------------------------------------------------------

  /** The run as the rules read it, now. */
  view(): ShopView {
    const { weapons, progression } = this.ctx;
    const pieces = this.ctx.world.objects.structures ?? [];
    return {
      credits: this.credits,
      inBreak: this.inBreak,
      owned: weapons.owned,
      ammo: id => weapons.ammo(id),
      grenades: weapons.grenades,
      grenadesMax: TUNING.grenade.max,
      stims: progression.stims.count,
      stimsMax: progression.stims.max,
      squad: this.ctx.allies?.allies.length ?? 0,
      held: progression.callIns,
      cooldown: id => progression.callInCooldown(id),
      mounts: this.mounts().map(g => ({ level: g.levelNumber, names: MOUNT_LEVELS.map(l => l.name.split(' //')[0]!) })),
      pieces,
      lost: id => this.shops[id].lost,
    };
  }

  offers(shop: ShopId): Offer[] {
    return offers(shop, this.view());
  }

  /** Buys `act` at `shop` if the rules allow it now. Returns why not, or null once it is done and paid for. */
  buy(shop: ShopId, act: Act): string | null {
    const offer = this.offers(shop).find(o => sameAct(o.act, act));
    if (!offer) return 'Not sold here';
    if (offer.why) return offer.why;
    const failed = this.carryOut(act);
    if (failed) return failed;
    this.credits -= offer.price;
    return null;
  }

  /** Does it. Returns why it could not, before anything is paid. */
  private carryOut(act: Act): string | null {
    const { ctx } = this;
    switch (act.kind) {
      case 'weapon':
        ctx.weapons.give(act.id);
        return null;
      case 'ammo': {
        const a = ctx.weapons.ammo(act.id);
        a.reserve = Math.min(a.maxReserve, a.reserve + Math.ceil(a.maxReserve / 2));
        return null;
      }
      case 'refill':
        for (const id of ctx.weapons.owned) {
          if (WEAPON_PRICES[id]?.ammo !== 'basic') continue;
          const a = ctx.weapons.ammo(id);
          a.reserve = Math.min(a.maxReserve, a.reserve + Math.ceil(a.maxReserve / 2));
        }
        return null;
      case 'grenade':
        ctx.weapons.addGrenades(1);
        return null;
      case 'stim':
        return ctx.progression.stims.give(1) > 0 ? null : 'Full';
      case 'callin':
        ctx.progression.grantCallIn(act.id);
        return null;
      case 'mount': {
        const gun = this.mounts()[act.index];
        if (!gun) return 'No such gun';
        gun.upgrade(gun.levelNumber + 1);
        return null;
      }
      case 'repair': {
        const piece = ctx.world.objects.structures?.[act.index];
        return piece?.repair(ECONOMY.repairSeconds) ? null : 'Nothing to repair';
      }
      case 'ally':
        return this.hire(act.type);
      case 'rebuild':
        this.shops[act.shop].restore();
        this.paint();
        ctx.hud.banner(`${SHOPS[act.shop].name.toUpperCase()} REBUILT`, '', SHOPS[act.shop].color);
        return null;
      case 'mortar':
        return 'Coming later';
    }
  }

  /** A new man at the barracks, posted at the rally point with his own patch of it. */
  private hire(type: Parameters<NonNullable<Ctx['allies']>['spawn']>[0]): string | null {
    const allies = this.ctx.allies;
    if (!allies) return 'No troops on this page';
    const { nav } = this.ctx.world;
    const n = allies.allies.length;
    const from = this.anchors.barracks.position;
    _a.set(from.x, from.y + 1, from.z - 2);
    if (!nav.nearest(_a, 8, _a)) return 'No room at the barracks';
    const rally = this.anchors.rally;
    _b.set(rally.x + ((n % 5) - 2) * 3.5, rally.y + 1, rally.z - Math.floor(n / 5) * 3);
    if (!nav.nearest(_b, 8, _b)) _b.copy(_a);
    return allies.spawn(type, _a.clone(), _b.clone()) ? null : 'No room for him';
  }

  /**
   * Hurts a shop. Nothing calls this yet but the lab: a later agent wires attackers in its ring to it (Q1). A lost shop sells
   * nothing until it is rebuilt in a break (Q7).
   */
  damageShop(id: ShopId, amount: number): void {
    if (!this.shops[id].damage(amount)) return;
    this.paint();
    if (this.prompted?.id === id) this.prompt(null);
    this.ctx.hud.banner(`${SHOPS[id].name.toUpperCase()} LOST`, 'rebuild it in a break', LOST_COLOR);
  }

  /** The guns on the walls. They hang off the call-in manager, which has no public way to them; the lab reads them the same way. */
  private mounts(): Emplacement[] {
    const p = this.ctx.progression as unknown as { callInsManager?: { emplacements?: { all: Emplacement[] } } };
    return p.callInsManager?.emplacements?.all ?? [];
  }

  // --- The counters in the world -----------------------------------------------------------------

  /** A steel counter and a lit sign at each anchor. The fort's buildings replace the counter; the sign and prompt stay. */
  private build(): void {
    const { render } = this.ctx;
    if (!render?.scene) return;
    const steel = render.materials.world('steelDark');
    const base = new THREE.BoxGeometry(1.6, 1.05, 0.8);
    const post = new THREE.BoxGeometry(0.12, SIGN_HEIGHT, 0.12);
    const board = new THREE.BoxGeometry(1.5, 0.42, 0.06);
    for (const id of SHOP_ORDER) {
      const at = this.anchors[id];
      const root = new THREE.Group();
      root.position.copy(at.position);
      root.rotation.y = at.yaw;
      const counter = new THREE.Mesh(base, steel);
      counter.position.y = 0.525;
      const pole = new THREE.Mesh(post, steel);
      pole.position.set(0.7, SIGN_HEIGHT / 2, 0);
      const sign = new THREE.MeshBasicMaterial({ color: SHOPS[id].color });
      const plate = new THREE.Mesh(board, sign);
      plate.position.set(0, SIGN_HEIGHT, 0);
      root.add(counter, pole, plate);
      render.scene.add(root);
      this.kiosks.push({ id, root, sign, label: at.position.clone().setY(at.position.y + SIGN_HEIGHT + 0.5) });
    }
  }

  /** Signs go red while their shop is lost. */
  private paint(): void {
    for (const k of this.kiosks) k.sign.color.set(this.shops[k.id].lost ? LOST_COLOR : SHOPS[k.id].color);
  }

  /** E at a counter opens its menu. An ally the player is looking at keeps E, as a mounted gun lets him. */
  private readCounter(): void {
    const { input, player } = this.ctx;
    const ally = Number.isFinite(this.ctx.allies?.focusDistance ?? Infinity);
    let near: Kiosk | null = null;
    if (player.alive && !player.parked && !ally) {
      let best = REACH;
      for (const k of this.kiosks) {
        const p = k.root.position;
        const d = Math.hypot(player.position.x - p.x, player.position.z - p.z);
        if (d < best && Math.abs(player.position.y - p.y) < 1.5) {
          best = d;
          near = k;
        }
      }
    }
    this.prompt(near);
    if (near && input.pressed('interact')) {
      this.prompt(null);
      this.ctx.events.emit('defense:open', { screen: near.id });
    }
  }

  private prompt(k: Kiosk | null): void {
    if (k === this.prompted) return;
    this.unprompt?.();
    this.unprompt = null;
    this.prompted = k;
    if (!k) return;
    const key = this.ctx.input.labelFor?.('interact') ?? 'E';
    const lost = this.shops[k.id].lost;
    this.unprompt = this.ctx.hud.follow(k.label, `${key} ${lost ? 'REBUILD ' : ''}${SHOPS[k.id].name.toUpperCase()}`, lost ? LOST_COLOR : SHOPS[k.id].color);
  }

  // --- Dev ---------------------------------------------------------------------------------------

  /** `window.__defense` for bots, and a DEFENSE section on the lab's panel. */
  private debug(): void {
    (window as unknown as { __defense: Defense }).__defense = this;
    this.ctx.events.on('run:start', () => setTimeout(() => this.panel(), 300));
  }

  private panel(): void {
    const host = document.querySelector('.lab-panel');
    if (!host || host.querySelector('.lab-defense')) return;
    const section = document.createElement('div');
    section.className = 'lab-defense';
    const h = document.createElement('h2');
    h.textContent = 'DEFENSE';
    const row = document.createElement('div');
    row.className = 'lab-row';
    const button = (label: string, run: () => void): void => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.addEventListener('click', run);
      row.appendChild(b);
    };
    button('+1000 credits', () => this.earn(1000));
    button('Skip break', () => this.skipBreak());
    for (const id of SHOP_ORDER) button(`Hit ${SHOPS[id].name} 500`, () => this.damageShop(id, 500));
    section.append(h, row);
    for (const type of ['mousedown', 'wheel', 'keydown'] as const) section.addEventListener(type, e => e.stopPropagation());
    host.insertBefore(section, host.querySelector('.lab-keys'));
  }
}

/** Only on a contract with an economy. */
export const createDefense = (ctx: Ctx): Defense | null => (ACTIVE.def.economy ? new Defense(ctx) : null);

