/**
 * Weapon caches: a drop pod falls from the sky every second wave. It marks its landing zone first, hits hard enough to
 * flatten whatever is under it, then opens and waits. The map is big and this is what pulls the player across it.
 */
import * as THREE from 'three';
import type { Ctx, EmitterHandle } from '../../core/contracts';
import type { WeaponId } from '../../core/gameplay';
import { lerp, pick, rand, smoothstep, TAU } from '../../core/math';
import { GroundProbe, GroundRing } from '../callins/ground';
import { CACHE_ORDER, DROP_POD as D, PICKUP, PICKUP_LOOK, WEAPON_NAMES } from '../data';
import { ModelBuilder, type ModelMaterials } from '../modelkit';

const COLOR = '#39e0ff';
const COLLECT_RADIUS = 3;
const REFILL_FRACTION = 0.5;
const DOOR_OPEN = 1.5;
const MIN_SPOT_DISTANCE = 30;

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
}

export class DropPods {
  /** Minimap entries. */
  readonly entries: Pod['entry'][] = [];
  private readonly pods: Pod[] = [];
  private readonly probe: GroundProbe;
  private readonly nextDoorAngles = [0, TAU / 3, (2 * TAU) / 3];

  constructor(private readonly ctx: Ctx, materials: ModelMaterials) {
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
      group.visible = false;
      ctx.render.scene.add(group);
      const entry = { kind: 'weaponCache' as const, position: new THREE.Vector3(), active: false };
      this.pods.push({
        phase: 'spent', weapon: null, entry, group, doors, ring: new GroundRing(ctx), timer: 0, trail: null, marker: null,
      });
      this.entries.push(entry);
    }
  }

  /** Every second wave clear sends one. */
  onWaveClear(wave: number): void {
    if (wave % D.everyWaves === 0) this.call();
  }

  private nextWeapon(): WeaponId | null {
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
    const me = this.ctx.player.position;
    let fallback: THREE.Vector3 | null = null;
    for (let i = 0; i < 16; i++) {
      const spot = pick(spots);
      // A pod needs open sky. Indoor spots are skipped unless nothing else turns up.
      if (this.probe.headroom(spot.x, spot.y + 1, spot.z, D.height) < D.height) {
        fallback ??= spot;
        continue;
      }
      if (spot.distanceTo(me) >= MIN_SPOT_DISTANCE) return spot;
      fallback = spot;
    }
    return fallback;
  }

  call(at?: THREE.Vector3): void {
    const pod = this.pods.find(p => p.phase === 'spent');
    const spot = at ?? this.landingSpot();
    if (!pod || !spot) return;
    const { audio, hud } = this.ctx;
    pod.weapon = this.nextWeapon();
    pod.phase = 'warning';
    pod.timer = 0;
    const floor = this.probe.heightAt(spot.x, spot.y + 2, spot.z, 40);
    pod.entry.position.copy(spot);
    if (!Number.isNaN(floor)) pod.entry.position.y = floor;
    pod.entry.active = true;
    pod.ring.setColor(COLOR, 2);
    pod.marker = hud.marker(_p.copy(pod.entry.position).setY(pod.entry.position.y + 3), PICKUP_LOOK.weaponCache.label, COLOR);
    audio.play('cache_incoming');
    hud.feed('WEAPON CACHE INBOUND', COLOR);
  }

  update(dt: number): void {
    for (const pod of this.pods) if (pod.phase !== 'spent') this.step(pod, dt);
  }

  private step(pod: Pod, dt: number): void {
    pod.timer += dt;
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
        const open = smoothstep(0.7, 1.3, pod.timer);
        // Peak on the first frame of the fall, then a small bounce: heavy doors dropping onto concrete.
        const swing = open * DOOR_OPEN + Math.sin(open * Math.PI) * 0.12;
        for (const d of pod.doors) d.rotation.x = swing;
        if (pod.timer >= 0.7 && pod.timer - dt < 0.7) this.ctx.audio.play('cache_open', { position: target });
        if (pod.timer >= 1.3) {
          pod.phase = 'open';
          pod.timer = 0;
        }
        break;
      }
      case 'open': {
        this.ctx.render.lights.flash(_p.copy(target).setY(target.y + 2), COLOR, 6, 12, 0.09);
        if (this.ctx.player.position.distanceTo(_p.copy(target).setY(target.y + 0.5)) < COLLECT_RADIUS + 1) this.collect(pod);
        else if (pod.timer >= D.life) this.retire(pod);
        break;
      }
    }
  }

  private startFall(pod: Pod): void {
    const { audio, fx } = this.ctx;
    pod.phase = 'falling';
    pod.timer = 0;
    pod.group.visible = true;
    for (const d of pod.doors) d.rotation.x = 0;
    pod.group.rotation.y = rand(0, TAU);
    pod.group.position.copy(pod.entry.position).setY(pod.entry.position.y + D.height);
    pod.trail = fx.attachEmitter(pod.group, 'hellfireTrail', new THREE.Vector3(0, 0.2, 0), D.height / D.speed + 0.2);
    audio.play('missile_incoming', { position: pod.entry.position });
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
    combat.explode(p, {
      radius: D.impactRadius, damage: D.impactDamage, kind: 'rocket', source: 'drop_pod', team: 'player', selfDamage: 0, playerPush: 10,
    });
    audio.play('cache_land', { position: p });
    fx.dust(p, _up, 4);
    fx.ring(p, _up, COLOR, D.impactRadius * 2);
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
      weapons.give(id);
      weapons.switchTo(id);
      hud.banner(WEAPON_NAMES[id], 'UNLOCKED', COLOR);
    } else {
      // Arsenal complete: a pod still pays out.
      weapons.addAmmo(REFILL_FRACTION);
      weapons.addGrenades(PICKUP.grenades * 3);
      weapons.refillMagazines();
      hud.feed('FULL RESUPPLY', COLOR);
    }
    events.emit('pickup:collected', { kind: 'weaponCache', position: p });
    this.retire(pod);
  }

  private retire(pod: Pod): void {
    pod.phase = 'spent';
    pod.weapon = null;
    pod.entry.active = false;
    pod.marker?.();
    pod.marker = null;
    pod.group.visible = false;
    pod.ring.hide();
    pod.trail?.stop();
    pod.trail = null;
  }

  clear(): void {
    for (const pod of this.pods) this.retire(pod);
  }
}
