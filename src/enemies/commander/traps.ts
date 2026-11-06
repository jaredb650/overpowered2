/**
 * What gets laid between waves. Mines and wires on the routes the tracker says the player uses, and the humans' own dirty work:
 * rigged pickups, rigged bodies, rigged rooms, shutters. Everything is placed out of sight and clear of the player, and everything is
 * laid where the player has actually been, which is what makes it feel like being read.
 */
import * as THREE from 'three';
import type { KillEvent, PickupKind } from '../../core/gameplay';
import { chance, pick, rand, randInt } from '../../core/math';
import type { Door } from '../outpost/squad';
import { CALLSIGNS } from '../outpost/doctrine';
import type { Soldier } from '../outpost/soldier';
import type { Device } from './devices';
import type { Commander } from './index';
import { FALSE_CHATTER, ROOM_WORDS } from './lines';

/** Mines kept on the map by phase of the run. */
const MINE_TARGET = [3, 4, 5, 6];
const WIRE_TARGET = 3;
const SNARE_TARGET = 2;
const CLAYMORE_TARGET = 2;
const BEACON_TARGET = 3;
const RIGGED_PICKUPS = 3;
const CORPSE_MEMORY = 8;
const RIGGED_CORPSES = 3;
const CORPSE_REACH = 2.1;
/** Nothing is placed this close to the player, or anywhere they could watch it appear. */
const CLEAR_OF_PLAYER = 7;
const ROOM_CHARGES = 3;
/** Metres into a room before it counts as walking in, so a look round the door frame is free. */
const ROOM_DEPTH = 3.5;
const ROOM_FUSE = 3;
const ROOM_RIPPLE = 0.3;
/** Pickup charges go off this long after the pickup is taken. Long enough to leave at a run. */
const PICKUP_FUSE = 0.5;
const PICKUP_REACH = 1.8;
const DEADMAN_FUSE = 1.5;
/** Share of the men who are carrying a switch. */
const DEADMAN_SHARE = 0.34;
const POSSUMS = 2;
const CHATTER_GAP: readonly [number, number] = [24, 38];

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();

export class Traps {
  private readonly corpses: THREE.Vector3[] = [];
  private corpseAt = 0;
  private readonly rigged: Device[] = [];
  private readonly switches = new WeakSet<Soldier>();
  private roomGroup = 0;
  private room: { min: THREE.Vector3; max: THREE.Vector3; name: string } | null = null;
  private roomUntil = -1;
  private roomStep = 0;
  private chatterAt = 0;

  constructor(private readonly c: Commander) {}

  reset(): void {
    this.corpses.length = 0;
    this.corpseAt = 0;
    this.rigged.length = 0;
    this.room = null;
    this.roomUntil = -1;
    this.roomGroup = this.roomStep = 0;
    this.chatterAt = 0;
  }

  /** True when the player could see this spot, or is standing on it. */
  private watched(at: THREE.Vector3): boolean {
    const { w } = this.c;
    if (at.distanceTo(w.player.position) < CLEAR_OF_PLAYER) return true;
    _d.copy(at);
    _d.y += 0.4;
    return w.director.clearLine(_d, w.player.eye);
  }

  /** The doors to work on, busiest first, topped up with any door when the player has not shown a route yet. */
  private doors(count: number): Door[] {
    const { doorList, o, tracker } = this.c;
    const out: Door[] = [];
    const seen = new Set<Door>();
    for (const i of tracker.hotDoors(count)) {
      const d = doorList[i];
      if (d) {
        out.push(d);
        seen.add(d);
      }
    }
    for (let tries = 0; out.length < count && tries < 24 && o.doors.length > 0; tries++) {
      const d = pick(o.doors);
      if (seen.has(d)) continue;
      out.push(d);
      seen.add(d);
    }
    return out;
  }

  /** Lays everything the fielded answers call for. Runs as the wave starts, while the player is still looking at the banner. */
  layout(phaseIndex: number): void {
    const { c } = this;
    if (c.has('mines')) this.layMines(MINE_TARGET[phaseIndex] ?? 6);
    if (c.has('tripwires')) this.layWires(WIRE_TARGET);
    if (c.has('snares')) this.laySnares(SNARE_TARGET);
    if (c.has('claymores')) this.layClaymores(CLAYMORE_TARGET);
    if (c.has('decoys')) this.layBeacons(BEACON_TARGET);
    if (c.has('riggedPickups')) this.rigPickups();
    if (c.has('baitPickups')) this.layBait();
    if (c.has('riggedCasualties')) this.layCasualty();
    if (c.hasTrick('playDead')) this.layPossums();
    if (c.hasTrick('riggedCorpses')) this.rigCorpses();
    if (c.hasTrick('riggedRooms') || c.has('falseChatter')) this.rigRoom();
    if (c.hasTrick('barricades') && c.barricades.drop(1) > 0) c.radio('radio.barricade.down', null);
    this.chatterAt = c.w.now + rand(10, 18);
  }

  private layMines(target: number): void {
    const { devices, tracker, posts, w } = this.c;
    let have = devices.count('mine');
    for (const door of this.doors(target)) {
      if (have >= target || !posts.doorFloor(door, _a)) continue;
      const side = rand(-0.9, 0.9);
      _a.x += door.dz * side;
      _a.z -= door.dx * side;
      if (this.occupied(_a, 1.4) || this.watched(_a)) continue;
      devices.mine(_a);
      have++;
    }
    for (const cell of tracker.hotCells(target * 2)) {
      if (have >= target) break;
      _a.set(cell.x, cell.y, cell.z);
      if (cell.y > 3 || !w.ctx.world.nav.nearest(_a, 2, _a) || this.occupied(_a, 3) || this.watched(_a)) continue;
      devices.mine(_a);
      have++;
    }
  }

  private occupied(at: THREE.Vector3, reach: number): boolean {
    for (const d of this.c.devices.live) if (d.position.distanceTo(at) < reach) return true;
    return false;
  }

  /** Both posts of a door's wire, at the frame. */
  private wireEnds(door: Door): boolean {
    if (!this.c.posts.doorFloor(door, _a)) return false;
    const half = door.w / 2 - 0.12;
    _b.set(_a.x - door.dz * half, _a.y, _a.z + door.dx * half);
    _c.set(_a.x + door.dz * half, _a.y, _a.z - door.dx * half);
    return true;
  }

  private layWires(target: number): void {
    const { devices } = this.c;
    let have = devices.count('tripwire');
    for (const door of this.doors(target + 2)) {
      if (have >= target || !this.wireEnds(door) || this.occupied(_a, 1.2) || this.watched(_a)) continue;
      devices.tripwire(_b, _c);
      have++;
    }
  }

  private laySnares(target: number): void {
    const { devices } = this.c;
    let have = devices.count('snare');
    for (const door of this.doors(target + 3)) {
      if (have >= target || !this.wireEnds(door) || this.occupied(_a, 1.2) || this.watched(_a)) continue;
      devices.snare(_b, _c);
      have++;
    }
  }

  private layClaymores(target: number): void {
    const { devices, posts, w } = this.c;
    let have = devices.count('claymore');
    for (const door of this.doors(target + 2)) {
      if (have >= target || !posts.doorFloor(door, _a) || this.occupied(_a, 2)) continue;
      // Set back from the door on the far side, facing it, so it catches whoever runs through.
      const side = (w.player.position.x - door.x) * door.dx + (w.player.position.z - door.z) * door.dz > 0 ? -1 : 1;
      _b.set(_a.x + door.dx * side * 3.4, _a.y, _a.z + door.dz * side * 3.4);
      if (!w.ctx.world.nav.nearest(_b, 1.5, _b) || this.watched(_b)) continue;
      _c.set(-door.dx * side, 0, -door.dz * side);
      devices.claymore(_b, _c);
      have++;
    }
  }

  private layBeacons(target: number): void {
    const { devices, posts } = this.c;
    let have = devices.count('beacon');
    for (let tries = 0; have < target && tries < 8; tries++) {
      if (!posts.farRoom(16 + tries * 2, _a) || this.occupied(_a, 6) || this.watched(_a)) continue;
      devices.beacon(_a);
      have++;
    }
  }

  private rigPickups(): void {
    const { c } = this;
    const list = c.w.ctx.progression.pickups;
    if (!Array.isArray(list)) return;
    let rigged = 0;
    for (let i = this.rigged.length - 1; i >= 0; i--) if (this.rigged[i]!.live) rigged++;
    for (const p of list) {
      if (rigged >= RIGGED_PICKUPS) break;
      if (!p.active || this.occupied(p.position, 1.5) || this.watched(p.position)) continue;
      _a.copy(p.position);
      _a.x += 0.55;
      _a.z += 0.3;
      if (!c.w.ctx.world.nav.nearest(_a, 1.5, _a)) continue;
      this.rigged.push(c.devices.charge(_a, 'rigged', 0));
      rigged++;
    }
  }

  /** The prize sits where the lane's rifles are already looking. */
  private layBait(): void {
    const { c } = this;
    const lane = c.units.first('lane');
    const door = this.doors(1)[0];
    if (!door || !c.posts.doorFloor(door, _a)) return;
    if (lane) _a.lerp(lane.watch, 0.2);
    c.w.ctx.progression.spawnPickup('megaHealth', _a);
  }

  private spotOnRoute(out: THREE.Vector3): boolean {
    const { tracker, w } = this.c;
    for (const cell of tracker.hotCells(10)) {
      out.set(cell.x, cell.y, cell.z);
      if (cell.y > 3 || !w.ctx.world.nav.nearest(out, 2.5, out) || this.occupied(out, 3) || this.watched(out)) continue;
      return true;
    }
    return this.c.posts.farRoom(16, out) && !this.watched(out);
  }

  private layCasualty(): void {
    if (this.spotOnRoute(_a)) this.c.units.placeBody('casualty', _a);
  }

  private layPossums(): void {
    const { w, units } = this.c;
    for (let i = 0; i < POSSUMS; i++) {
      if (!this.spotOnRoute(_a)) return;
      const e = units.placeBody('possum', _a);
      // Bodies have blood under them. Most of these do too, so the sonar is what catches him, not a bare floor.
      if (e && chance(0.7)) w.ctx.render.decals.add('bloodPool', _a, _b.set(0, 1, 0), 1.4, rand(0, 6.28));
    }
  }

  private rigCorpses(): void {
    const { devices, w } = this.c;
    let placed = 0;
    for (const at of this.corpses) {
      if (placed >= RIGGED_CORPSES) break;
      if (this.occupied(at, 2) || this.watched(at) || !w.ctx.world.nav.nearest(at, 2, _a)) continue;
      devices.charge(_a, 'rigged', CORPSE_REACH);
      placed++;
    }
  }

  private rigRoom(): void {
    const { c } = this;
    const { w, devices } = c;
    if (this.room) return;
    const name = c.lastRoom;
    const zone = w.ctx.world.zones.find(z => z.name === name && z.id.includes('room')) ?? pick(w.ctx.world.zones.filter(z => z.id.includes('room')));
    if (!zone) return;
    if (zone.bounds.containsPoint(w.player.position)) return;
    this.roomGroup = devices.newGroup();
    this.room = { min: zone.bounds.min, max: zone.bounds.max, name: zone.name };
    for (let i = 0; i < ROOM_CHARGES; i++) {
      _a.set(rand(zone.bounds.min.x + 2, zone.bounds.max.x - 2), 0.2, rand(zone.bounds.min.z + 2, zone.bounds.max.z - 2));
      if (!w.ctx.world.nav.nearest(_a, 4, _a)) continue;
      devices.charge(_a, 'rigged', 0).group = this.roomGroup;
    }
  }

  /** The player just took a pickup. If it was rigged, the charge beside it lets them know. */
  onPickup(_kind: PickupKind, at: THREE.Vector3): void {
    for (const d of this.rigged) {
      if (d.live && !d.lit && d.position.distanceTo(at) < PICKUP_REACH) {
        this.c.devices.trigger(d, PICKUP_FUSE);
        this.c.w.ctx.audio.play('bomber_beep', { position: d.position, pitch: 1.8 });
      }
    }
  }

  onKilled(k: KillEvent): void {
    const p = this.corpses[this.corpseAt % CORPSE_MEMORY] ?? (this.corpses[this.corpseAt % CORPSE_MEMORY] = new THREE.Vector3());
    p.copy(k.enemy.position);
    this.corpseAt++;
  }

  /** A man goes through the gate with a switch in his fist. */
  arm(s: Soldier): void {
    if (!this.c.hasTrick('deadMan') || !chance(DEADMAN_SHARE)) return;
    this.switches.add(s);
    this.c.props.fit(s.e.char, 'detonator');
  }

  /** He is dead and his thumb has come off the button. */
  onDead(s: Soldier): void {
    if (!this.switches.has(s)) return;
    this.switches.delete(s);
    const { c } = this;
    const d = c.devices.charge(s.e.position, 'deadman', 0);
    c.devices.trigger(d, DEADMAN_FUSE);
    c.w.ctx.audio.play('bomber_beep', { position: s.e.position, pitch: 2, volume: 0.9 });
    c.w.telegraphs.zone(s.e.position, 5, DEADMAN_FUSE);
  }

  update(): void {
    const { c } = this;
    const { w } = c;
    const now = w.now;
    if (this.room) this.watchRoom(now);
    if (c.has('falseChatter') && now >= this.chatterAt && c.o.hostile > 0) this.lie(now);
  }

  private watchRoom(now: number): void {
    const { c } = this;
    const { w, devices, o } = c;
    const room = this.room!;
    if (this.roomUntil < 0) {
      const p = w.player.position;
      const inside = p.x > room.min.x + ROOM_DEPTH && p.x < room.max.x - ROOM_DEPTH && p.z > room.min.z + ROOM_DEPTH && p.z < room.max.z - ROOM_DEPTH;
      if (!inside) return;
      this.roomUntil = now + ROOM_FUSE;
      this.roomStep = 0;
      w.ctx.audio.play('siren_loop', { volume: 0.7, duration: ROOM_FUSE });
      w.ctx.audio.play('boss_alarm', { volume: 0.5, duration: ROOM_FUSE });
      c.radio('radio.room.armed', null, { room: room.name });
      o.noise(p, 18);
      return;
    }
    if (now < this.roomUntil) return;
    for (const d of devices.live) {
      if (d.group !== this.roomGroup || d.lit) continue;
      devices.trigger(d, 0.05 + this.roomStep++ * ROOM_RIPPLE);
    }
    this.room = null;
    this.roomUntil = -1;
  }

  /** A voice from a squad that does not exist, naming a room that is wired. */
  private lie(now: number): void {
    const { c } = this;
    this.chatterAt = now + rand(CHATTER_GAP[0], CHATTER_GAP[1]);
    const room = this.room?.name ?? c.lastRoom;
    if (!room || !ROOM_WORDS.includes(room)) return;
    const line = pick(FALSE_CHATTER);
    const who = `${CALLSIGNS[randInt(0, CALLSIGNS.length - 1)]}-7`;
    c.o.comms.relay(line.text.replaceAll('{room}', room), null, who);
  }
}
