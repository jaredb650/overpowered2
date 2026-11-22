/**
 * Unit tests for Lane K: the 3 custom Distraint Frame cockpit models (`cockpit-twin.ts`, `cockpit-open.ts`,
 * `cockpit-sensor.ts`), Sensor Cockpit wall-seeing outlines (`cockpitSensor.ts`), Open Frame exposed pilot seat hit
 * routing (`openSeat.ts`), and the rotating 3D mech preview + Frame Loadout screen (`frameLoadout.ts`, `framePreview.ts`).
 */
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { THERMAL } from '../contracts/chips';
import type { Ctx, PlayerDamage } from '../core/contracts';
import type { EnemyInstance } from '../core/gameplay';
import { ModelMaterials } from '../progression/modelkit';
import type { Hud } from '../ui/Hud';
import { FRAME_KEY_LINES, FrameLoadoutScreen, loadoutSummary, partSpecs } from '../ui/screens/frameLoadout';
import { FramePreview, PREVIEW_TURN_SPEED } from '../ui/screens/framePreview';
import type { Nav, NavItem } from '../ui/screens/nav';
import { StandIn } from './cockpit';
import { FrameCockpitSensor } from './cockpitSensor';
import { FRAME_PART_ORDER, FRAME_PARTS, defaultLoadout, fitPart } from './loadout';
import { buildOpenCockpit } from './models/cockpit-open';
import { buildSensorCockpit } from './models/cockpit-sensor';
import { buildTwinCockpit } from './models/cockpit-twin';
import { routeOpenSeatHit } from './openSeat';

function makeMaterials(): ModelMaterials {
  const ctx = {
    render: { materials: { patch: <T extends THREE.Material>(m: T): T => m } },
  } as unknown as Ctx;
  return new ModelMaterials(ctx);
}

/** Verifies a Group contains at least one mesh with finite vertex positions and normals. */
function assertValidGeometry(group: THREE.Group | undefined): number {
  expect(group).toBeDefined();
  let verts = 0;
  group!.traverse(obj => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const pos = mesh.geometry.getAttribute('position');
    expect(pos).toBeDefined();
    expect(pos.count).toBeGreaterThan(0);
    for (let i = 0; i < pos.count; i++) {
      expect(Number.isFinite(pos.getX(i))).toBe(true);
      expect(Number.isFinite(pos.getY(i))).toBe(true);
      expect(Number.isFinite(pos.getZ(i))).toBe(true);
    }
    verts += pos.count;
  });
  expect(verts).toBeGreaterThan(0);
  return verts;
}

describe('cockpit 3D models', () => {
  it('builds Twin-Mount Cockpit with valid exterior and interior geometry while keeping canopy cracks enabled', () => {
    const mat = makeMaterials();
    const vis = buildTwinCockpit(mat);
    expect(assertValidGeometry(vis.exterior)).toBeGreaterThan(100);
    expect(assertValidGeometry(vis.interior)).toBeGreaterThan(50);
    expect(vis.hideStandardInterior).toBe(false);
    expect(vis.hideStandardVisor).toBe(false);
  });

  it('builds Open Frame with valid roll-cage/seat/bridge geometry and hides both standard interior and visor', () => {
    const mat = makeMaterials();
    const vis = buildOpenCockpit(mat);
    expect(assertValidGeometry(vis.exterior)).toBeGreaterThan(100);
    expect(assertValidGeometry(vis.interior)).toBeGreaterThan(50);
    expect(vis.hideStandardInterior).toBe(true);
    expect(vis.hideStandardVisor).toBe(true);
  });

  it('builds Sensor Cockpit with valid cyclops optics/radar exterior and rangefinder interior, hiding standard visor', () => {
    const mat = makeMaterials();
    const vis = buildSensorCockpit(mat);
    expect(assertValidGeometry(vis.exterior)).toBeGreaterThan(100);
    expect(assertValidGeometry(vis.interior)).toBeGreaterThan(50);
    expect(vis.hideStandardVisor).toBe(true);
    expect(vis.hideStandardInterior).toBe(false);
  });

  it('swaps cleanly across all 4 cockpits on StandIn and suppresses canopy cracks only on Open Frame', () => {
    const mat = makeMaterials();
    const scene = new THREE.Scene();
    const body = new StandIn(mat, scene);
    const eye = new THREE.Vector3();

    // Standard -> Twin -> Open -> Sensor -> Standard.
    for (const id of ['cockpitStandard', 'cockpitTwin', 'cockpitOpen', 'cockpitSensor', 'cockpitStandard'] as const) {
      body.setLoadout(fitPart(defaultLoadout(), id));
      body.setCracks(3);
      body.pose(new THREE.Vector3(), 0, 0, 0, 0, 0, 0, true, eye);
      const visibleCrackLayers = body.cockpit.children.filter(c => (c as THREE.LineSegments).isLineSegments && c.visible).length;
      if (id === 'cockpitOpen') expect(visibleCrackLayers).toBe(0);
      else expect(visibleCrackLayers).toBe(3);
    }
  });
});

describe('FrameCockpitSensor (70 m wall-seeing outlines)', () => {
  function makeEnemy(uid: number, x: number, z: number, alive = true): EnemyInstance {
    const mesh = new THREE.Object3D();
    mesh.name = `enemy_${uid}`;
    return {
      uid,
      id: 'trooper',
      alive,
      position: new THREE.Vector3(x, 0, z),
      center: new THREE.Vector3(x, 1, z),
      velocity: new THREE.Vector3(),
      yaw: 0,
      health: alive ? 100 : 0,
      maxHealth: 100,
      armor: 0,
      score: 100,
      isBoss: false,
      frozen: 0,
      burning: 0,
      machine: false,
      char: { mesh } as unknown as EnemyInstance['char'],
    };
  }

  it('highlights every alive enemy within 70 m using Thermal brain chip colors and excludes farther or dead enemies', () => {
    const near = makeEnemy(1, 0, -25);
    const edge = makeEnemy(2, 0, -70); // exactly 70 m
    const far = makeEnemy(3, 0, -70.5); // just outside 70 m
    const dead = makeEnemy(4, 0, -15, false);

    const calls: { meshes: THREE.Object3D[]; color: THREE.ColorRepresentation; strength?: number; fill?: number }[] = [];
    const shareSensorMarks = vi.fn();
    const clearSensorMarks = vi.fn();
    const ctx = {
      enemies: { alive: [near, edge, far, dead] },
      render: {
        highlight: (meshes: readonly THREE.Object3D[], color: THREE.ColorRepresentation, strength?: number, fill?: number) => {
          calls.push({ meshes: [...meshes], color, strength, fill });
        },
      },
      coop: { world: { shareSensorMarks, clearSensorMarks } },
    } as unknown as Ctx;

    const sensor = new FrameCockpitSensor();
    const feet = new THREE.Vector3(0, 0, 0);
    sensor.update(ctx, 70, feet, true);

    expect(sensor.active).toBe(true);
    expect(sensor.markedCount).toBe(2);
    expect(sensor.marked.has(1)).toBe(true);
    expect(sensor.marked.has(2)).toBe(true);
    expect(sensor.marked.has(3)).toBe(false);
    expect(sensor.marked.has(4)).toBe(false);

    // Near enemy gets white-hot Thermal color + full visibleFill; edge enemy at 70 m gets amber falloff.
    const nearCall = calls.find(c => c.meshes.includes(near.char.mesh));
    const edgeCall = calls.find(c => c.meshes.includes(edge.char.mesh));
    expect(nearCall?.color).toBe(THERMAL.enemyColor);
    expect(nearCall?.strength).toBe(1);
    expect(nearCall?.fill).toBe(THERMAL.visibleFill);
    expect(edgeCall?.color).toBe(THERMAL.enemyFarColor);
    expect(edgeCall?.strength).toBeGreaterThan(0);

    // Mesh userData tags and co-op share hook updated.
    expect(near.char.mesh.userData.sensorMarked).toBe(true);
    expect(edge.char.mesh.userData.sensorMarked).toBe(true);
    expect(far.char.mesh.userData.sensorMarked).toBeUndefined();
    expect(shareSensorMarks).toHaveBeenCalledTimes(1);

    // Enemy moving out of range loses its tag on next update.
    edge.position.set(0, 0, -85);
    calls.length = 0;
    sensor.update(ctx, 70, feet, true);
    expect(sensor.markedCount).toBe(1);
    expect(edge.char.mesh.userData.sensorMarked).toBeUndefined();

    // Disembarking (`clear()`) cleans all tags, marks, and co-op marks.
    sensor.clear();
    expect(sensor.active).toBe(false);
    expect(sensor.markedCount).toBe(0);
    expect(near.char.mesh.userData.sensorMarked).toBeUndefined();
    expect(clearSensorMarks).toHaveBeenCalledTimes(1);
  });

  it('does not highlight when inactive or range <= 0', () => {
    const e = makeEnemy(1, 0, -10);
    const highlight = vi.fn();
    const ctx = {
      enemies: { alive: [e] },
      render: { highlight },
    } as unknown as Ctx;

    const sensor = new FrameCockpitSensor();
    sensor.update(ctx, 70, new THREE.Vector3(), false);
    sensor.update(ctx, 0, new THREE.Vector3(), true);
    expect(highlight).not.toHaveBeenCalled();
    expect(sensor.markedCount).toBe(0);
  });
});

describe('routeOpenSeatHit (Open Frame exposed pilot seat)', () => {
  const feet = new THREE.Vector3(0, 0, 0);
  const yaw = 0; // faces -Z

  const dmg = (over: Partial<PlayerDamage>): PlayerDamage => ({
    amount: 40,
    type: 'bullet',
    source: 'trooper_rifle',
    ...over,
  });

  it('never routes to pilot when openSeat is false', () => {
    expect(routeOpenSeatHit(dmg({ from: new THREE.Vector3(0, 4.6, -15) }), feet, yaw, false)).toBe(false);
  });

  it('routes frontal hits at cockpit seat elevation directly to the pilot', () => {
    expect(routeOpenSeatHit(dmg({ from: new THREE.Vector3(0, 4.6, -15) }), feet, yaw, true)).toBe(true);
    expect(routeOpenSeatHit(dmg({ from: new THREE.Vector3(2.5, 4.0, -10), source: 'sniper' }), feet, yaw, true)).toBe(true);
  });

  it('routes overhead / top-down fire through the missing roof directly to the pilot', () => {
    expect(routeOpenSeatHit(dmg({ from: new THREE.Vector3(0, 18, -0.5), type: 'explosive', source: 'aa_top_attack' }), feet, yaw, true)).toBe(true);
    expect(routeOpenSeatHit(dmg({ from: new THREE.Vector3(0, 10, -10), source: 'sniper' }), feet, yaw, true)).toBe(true);
  });

  it('routes close-in front/top explosive or fire airbursts near the open seat to the pilot', () => {
    expect(routeOpenSeatHit(dmg({ from: new THREE.Vector3(0.4, 4.8, -2.4), type: 'explosive', source: 'rocket' }), feet, yaw, true)).toBe(true);
    expect(routeOpenSeatHit(dmg({ from: new THREE.Vector3(0, 4.4, -1.5), type: 'fire', source: 'napalm' }), feet, yaw, true)).toBe(true);
  });

  it('keeps lower torso, legs, rear armour, sappers, crushes, and low/rear blasts on the mech hull', () => {
    // Low leg shot.
    expect(routeOpenSeatHit(dmg({ from: new THREE.Vector3(0, 1.4, -12) }), feet, yaw, true)).toBe(false);
    // Rear reactor shot.
    expect(routeOpenSeatHit(dmg({ from: new THREE.Vector3(0, 4.6, 15) }), feet, yaw, true)).toBe(false);
    // Rear explosive shielded by armoured backrest.
    expect(routeOpenSeatHit(dmg({ from: new THREE.Vector3(0, 4.6, 2.0), type: 'explosive', source: 'rocket' }), feet, yaw, true)).toBe(false);
    // Foot-level explosion shielded by waist/legs.
    expect(routeOpenSeatHit(dmg({ from: new THREE.Vector3(0, 0.5, -2.0), type: 'explosive', source: 'grenade' }), feet, yaw, true)).toBe(false);
    // Sapper charge and ground crush.
    expect(routeOpenSeatHit(dmg({ from: new THREE.Vector3(0, 4.5, -2.0), type: 'explosive', source: 'sapper_charge' }), feet, yaw, true)).toBe(false);
    expect(routeOpenSeatHit(dmg({ from: new THREE.Vector3(0, 4.5, -2.0), type: 'crush', source: 'vehicle_ram' }), feet, yaw, true)).toBe(false);
  });

  it('respects rotated torso yaw', () => {
    // yaw = PI / 2 -> forward is (-1, 0, 0).
    const rotYaw = Math.PI / 2;
    expect(routeOpenSeatHit(dmg({ from: new THREE.Vector3(-14, 4.6, 0) }), feet, rotYaw, true)).toBe(true);
    expect(routeOpenSeatHit(dmg({ from: new THREE.Vector3(14, 4.6, 0) }), feet, rotYaw, true)).toBe(false);
  });
});

/** Minimal fake DOM node so FrameLoadoutScreen and FramePreview can be exercised in Node Vitest without jsdom. */
class FakeEl {
  tagName: string;
  className = '';
  textContent = '';
  innerHTML = '';
  type = '';
  style: Record<string, string> = {};
  children: FakeEl[] = [];
  parentNode: FakeEl | null = null;
  clientWidth = 800;
  clientHeight = 520;
  readonly classList = {
    set: new Set<string>(),
    add: (...cls: string[]) => cls.forEach(c => this.classList.set.add(c)),
    remove: (...cls: string[]) => cls.forEach(c => this.classList.set.delete(c)),
    toggle: (c: string, force?: boolean) => {
      const on = force === undefined ? !this.classList.set.has(c) : force;
      if (on) this.classList.set.add(c);
      else this.classList.set.delete(c);
      return on;
    },
    contains: (c: string) => this.classList.set.has(c),
  };
  private listeners = new Map<string, Set<(e: unknown) => void>>();
  private attrs = new Map<string, string>();

  constructor(tag: string) {
    this.tagName = tag.toUpperCase();
  }

  append(...nodes: (FakeEl | string)[]): void {
    for (const n of nodes) {
      if (typeof n === 'string') {
        this.textContent += n;
      } else {
        n.parentNode = this;
        this.children.push(n);
      }
    }
  }

  replaceChildren(...nodes: (FakeEl | string)[]): void {
    for (const c of this.children) c.parentNode = null;
    this.children = [];
    this.textContent = '';
    this.append(...nodes);
  }

  remove(): void {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter(c => c !== this);
    this.parentNode = null;
  }

  setAttribute(k: string, v: string): void {
    this.attrs.set(k, v);
  }

  getAttribute(k: string): string | null {
    return this.attrs.get(k) ?? null;
  }

  addEventListener(type: string, fn: (e: unknown) => void): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(fn);
  }

  removeEventListener(type: string, fn: (e: unknown) => void): void {
    this.listeners.get(type)?.delete(fn);
  }

  getContext(): null {
    return null;
  }

  /** Recursively collect text from this subtree. */
  allText(): string {
    return [this.textContent, ...this.children.map(c => c.allText())].filter(Boolean).join(' ');
  }

  /** Recursively find all elements whose className contains `cls`. */
  findByClass(cls: string): FakeEl[] {
    const out: FakeEl[] = [];
    const tokens = new Set([...this.className.split(/\s+/), ...this.classList.set]);
    if (tokens.has(cls)) out.push(this);
    for (const c of this.children) out.push(...c.findByClass(cls));
    return out;
  }
}

describe('FrameLoadoutScreen, FramePreview, and part stats', () => {
  const prevDoc = globalThis.document;
  const prevWin = globalThis.window;

  afterEach(() => {
    (globalThis as unknown as { document?: unknown }).document = prevDoc;
    (globalThis as unknown as { window?: unknown }).window = prevWin;
  });

  it('produces non-empty numerical specs for every catalogued part and uses "brain chip" terminology', () => {
    for (const id of FRAME_PART_ORDER) {
      const part = FRAME_PARTS[id];
      const rows = partSpecs(part);
      expect(rows.length).toBeGreaterThanOrEqual(3);
      for (const r of rows) {
        expect(r.label.length).toBeGreaterThan(0);
        expect(r.value.length).toBeGreaterThan(0);
        // Never write bare "chip" without "brain".
        expect(r.value.toLowerCase()).not.toMatch(/(?<!brain\s)\bchip\b/);
      }
    }

    const openSum = loadoutSummary(fitPart(fitPart(defaultLoadout(), 'cockpitOpen'), 'legsHeavy'));
    expect(openSum.rows.find(r => r.label === 'Hull')?.value).toBe('3600 HP');
    expect(openSum.rows.find(r => r.label === 'Legs')?.value).toBe('1440 HP');
    expect(openSum.rows.find(r => r.label === 'Canopy')?.value).toContain('OPEN');
    expect(openSum.rows.find(r => r.label === 'Shoulders')?.value).toBe('3 / 3');
    expect(openSum.traits).toContain('Exposed Pilot Seat');
    expect(openSum.traits).toContain('Knockback Immune');

    const sensorSum = loadoutSummary(fitPart(defaultLoadout(), 'cockpitSensor'));
    expect(sensorSum.traits).toContain('70 m Wall-Seeing Optics');
  });

  it('mounts FramePreview gracefully without WebGL, rotates smoothly, swaps loadouts live, and disposes cleanly', () => {
    (globalThis as unknown as { document: unknown }).document = {
      createElement: (tag: string) => new FakeEl(tag),
    };
    const preview = new FramePreview();
    const container = new FakeEl('div');
    preview.mount(container as unknown as HTMLElement, defaultLoadout());
    expect(preview.isMounted).toBe(true);
    expect(preview.hasWebGL).toBe(false); // headless fallback without throwing
    expect(container.findByClass('fl-canvas')).toHaveLength(1);

    const startAngle = preview.angle;
    preview.update(0.1);
    expect(preview.angle).toBeCloseTo(startAngle + 0.1 * PREVIEW_TURN_SPEED, 4);

    // Live loadout swaps across all slots.
    let kit = fitPart(defaultLoadout(), 'cockpitOpen');
    kit = fitPart(kit, 'beamL');
    kit = fitPart(kit, 'shotgunR');
    kit = fitPart(kit, 'mortarRack', 0);
    kit = fitPart(kit, 'mirv', 1);
    kit = fitPart(kit, 'pointDefence', 2);
    kit = fitPart(kit, 'legsSpider');
    kit = fitPart(kit, 'engineRotor');
    preview.setLoadout(kit);
    expect(preview.currentLoadout).toEqual(kit);
    preview.update(0.05);

    preview.dispose();
    expect(preview.isMounted).toBe(false);
    expect(container.findByClass('fl-canvas')).toHaveLength(0);
    expect(preview.scene.children).toHaveLength(0);
  });

  it('mounts FrameLoadoutScreen, dynamically switches 1/2/3 shoulder slots, displays updated keys, and disposes on close', () => {
    (globalThis as unknown as { document: unknown }).document = {
      createElement: (tag: string) => new FakeEl(tag),
    };
    const ctx = { audio: { play: vi.fn() } } as unknown as Ctx;
    const hud = { screens: { back: vi.fn() } } as unknown as Hud;

    const screen = new FrameLoadoutScreen(ctx, hud);
    let navItems: NavItem[] = [];
    const nav = {
      back: null as (() => void) | null,
      left: null as (() => void) | null,
      right: null as (() => void) | null,
      set: (items: NavItem[], _at?: number) => { navItems = items; },
    } as unknown as Nav;

    screen.open(nav);
    expect(screen.preview.isMounted).toBe(true);

    const root = screen.el as unknown as FakeEl;
    // Keybindings reference contains all required updated keys.
    const keysText = root.findByClass('fl-keys')[0]!.allText();
    expect(FRAME_KEY_LINES.length).toBeGreaterThanOrEqual(7);
    expect(keysText).toContain('LMB / 1');
    expect(keysText).toContain('RMB / 2');
    expect(keysText).toContain('G / V / B');
    expect(keysText).toContain('3 / 4 / 5');
    expect(keysText).toContain('R · Q · F');
    expect(keysText).toContain('Space · Shift');
    expect(keysText).toContain('C / Ctrl · E');

    // Standard cockpit -> 1 shoulder group.
    const shoulderGroups = () => root.findByClass('pc-group').filter(g => g.textContent.startsWith('Shoulder'));
    expect(shoulderGroups()).toHaveLength(1);

    // Click Twin-Mount Cockpit -> 2 shoulder slots shown dynamically + live preview updated.
    const activateByName = (partName: string) => {
      const item = navItems.find(it => (it.el as unknown as FakeEl).allText().includes(partName));
      expect(item).toBeDefined();
      item!.activate!();
    };
    activateByName('Twin-Mount Cockpit');
    expect(screen.currentLoadout.cockpit).toBe('cockpitTwin');
    expect(screen.preview.currentLoadout.cockpit).toBe('cockpitTwin');
    expect(shoulderGroups()).toHaveLength(2);

    // Click Open Frame -> 3 shoulder slots shown dynamically.
    activateByName('Open Frame');
    expect(screen.currentLoadout.cockpit).toBe('cockpitOpen');
    expect(screen.preview.currentLoadout.cockpit).toBe('cockpitOpen');
    expect(shoulderGroups()).toHaveLength(3);

    // Click Sensor Cockpit -> back to 1 shoulder slot.
    activateByName('Sensor Cockpit');
    expect(screen.currentLoadout.cockpit).toBe('cockpitSensor');
    expect(shoulderGroups()).toHaveLength(1);

    // Update rotates the preview; closing disposes cleanly.
    const before = screen.preview.angle;
    screen.update(0.1);
    expect(screen.preview.angle).toBeGreaterThan(before);
    screen.closed();
    expect(screen.preview.isMounted).toBe(false);
  });
});
