import type { DamageInfo } from '../core/contracts';
import type { EnemyId, WavePhase } from '../core/gameplay';
import type { GoreRegion } from '../characters/rig';
import type { WireGun } from '../weapons/handover';

export const ENEMY_IDS: readonly EnemyId[] = ['husk', 'trooper', 'gunner', 'brute', 'stalker', 'riot', 'sniper', 'rocketeer', 'leaper', 'bomber', 'burner', 'warden', 'skitter', 'drone', 'juggernaut', 'titan'];
export const REGIONS: readonly GoreRegion[] = ['head', 'chest', 'abdomen', 'armL', 'forearmL', 'armR', 'forearmR', 'legL', 'shinL', 'legR', 'shinR'];
export const SNAPSHOT_MS = 100;
export const HEADER_BYTES = 12;
export const ENEMY_BYTES = 45;
/** A man's posture (characters/animation/postures.ts), so a guest sees him with his hands up, cuffed, cowering or in cover. */
export const POSTURES = ['stand', 'crouch', 'cover', 'peek', 'leanLeft', 'leanRight', 'handsUp', 'kneel', 'cower', 'flee', 'drag', 'revive', 'downed',
  'hunched', 'pistol', 'cuffed', 'bound'] as const;
export type PostureId = typeof POSTURES[number];
/** Flag bit: he has surrendered and can be cuffed (Endless Humans). */
export const CAPTURABLE = 128;
export type Vec = [number, number, number];
export interface EnemyFrame {
  uid: number; id: EnemyId; position: Vec; velocity: Vec; yaw: number; health: number; maxHealth: number; armor: number;
  flags: number; animation: number; severed: number; plates: number; posture?: PostureId;
}
export const WAVE_PHASES: readonly WavePhase[] = ['intermission', 'spawning', 'clearing', 'boss'];
export interface WorldFrame { seq: number; wave: number; phase?: WavePhase; nextWaveIn?: number; enemies: EnemyFrame[] }
export type WireDamage = Omit<DamageInfo, 'point' | 'dir' | 'slicePlaneNormal'> & { point: Vec; dir: Vec; slicePlaneNormal?: Vec };
export type LifeState = 'up' | 'down' | 'dead';
/** What one player shows the others: the teammates strip and the Tab board (team.ts). Clamped on arrival (`cleanCard`). */
export interface Card {
  slot: number; state: LifeState; bleed: number; life: number; hp: number; max: number; armor: number;
  kills: number; score: number; credits: number; downs: number; revives: number; ping: number;
}
export interface HitClaim { t: 'hit'; shot: number; target: number; weapon: string; origin: Vec; damage: WireDamage }
export type WorldEvent =
  | HitClaim
  | { t: 'fire'; shot: number; weapon: string; origin: Vec; dir: Vec; slot?: number }
  | { t: 'hitfx'; uid: number; damage: WireDamage; health: number; armor: number; blocked: boolean }
  /** `by` is the killer's slot (-1 the world's own), `head` the host's headshot verdict: the killer's browser pays itself. */
  | { t: 'kill'; uid: number; id: EnemyId; at: Vec; yaw: number; damage: WireDamage; gib: boolean; by?: number; head?: boolean }
  | { t: 'sever'; uid: number; region: GoreRegion; damage: WireDamage }
  | { t: 'hurt'; amount: number; from: Vec; type: string; source: string; life: number }
  | { t: 'life'; slot: number; alive: boolean; life: number }
  | { t: 'ray'; from: Vec; to: Vec }
  /** A line the host's rule table chose (src/enemies/outpost/chatter). Ids only: row, speaker, his name, rank and squad, and the dead man's name. */
  | { t: 'chatter'; uid: number; line: number; name: number; dead: number; rank: number; squad: string; slots?: Record<string, string>; voice?: number }
  /** The speaker `uid` was cut off `at` characters into his line. */
  | { t: 'chatcut'; uid: number; at: number; radio?: boolean }
  // --- Stage 3: the team (team.ts) ---
  /** Guest to host: my card, 4 Hz. Host to guests: everyone's, 4 Hz, with the host's word on life, bleed and ping. */
  | { t: 'card'; card: Card }
  | { t: 'team'; list: Card[] }
  /** Guest to host: I held E over this downed player. */
  | { t: 'revive'; slot: number }
  /** Host: this player is up again, revived (`by` the reviver's slot) or respawned at a new wave. */
  | { t: 'up'; slot: number; life: number; how: 'revive' | 'respawn'; by: number; at?: Vec; yaw?: number }
  /** Host: the waves' own events, replayed on guests so their shops, pods, banners and ammo follow the host's waves. */
  | { t: 'wave'; kind: 'start' | 'clear'; wave: number; total: number; boss: boolean; bonus: number }
  /** Host: nobody is up. The run is over for everyone; the cards are the final board. */
  | { t: 'over'; wave: number; cards: Card[]; won?: boolean }
  /** Host to a rejoining guest: the purse and score they left with. */
  | { t: 'restore'; credits: number; score: number; kills: number }
  /** An explosion someone else's game made: drawn and heard here, never damaging (the host already counted it). */
  | { t: 'boom'; at: Vec; kind: string; radius: number; slot?: number; damage?: number; source?: string }
  /** Someone called a strike or an aircraft in: a feed line for the others. */
  | { t: 'callin'; id: string; slot?: number }
  /** Someone's Sonar went out from `at`: everyone sees what it lights, with a feed line. */
  | { t: 'sonar'; at: Vec; slot?: number }
  /** Guest to host: my slow-mo perk started (`on`) or ended. The host slows the world for everyone. */
  | { t: 'slow'; id: string; on: boolean }
  /** Host to guests: the host's tab went to the background (`on`) or came back. */
  | { t: 'hidden'; on: boolean }
  // --- Stage 4: Endless Humans and Outpost Defense ---
  /** Guest to host: I held E on this surrendered man. The host cuffs him for me; the bounty comes back as `credit`. */
  | { t: 'capture'; uid: number }
  /**
   * A gun on the ground (weapons/dropped.ts). Guest to host: `drop` (my gun, as a kit) or `take` (that one, by id). Host to all:
   * `add` and `gone`; to the one who took it first: `give`.
   */
  | { t: 'gun'; op: 'drop' | 'take' | 'add' | 'gone' | 'give'; id?: number; gun?: WireGun }
  /** Host to one guest: credits earned on the host's side for them (a prisoner's bounty). */
  | { t: 'credit'; amount: number; why: string }
  /** Host: the trucks, humvees and tanks, 5 Hz. Drawn on guests; hurt only on the host. */
  /** Host: the garrison, 5 Hz: [id, type index, x, y, z, yaw, state 0 up 1 down 2 dead, posture index]. Drawn on guests. */
  | { t: 'allies'; list: number[][] }
  // --- Stage 5: campaign (mission.ts) ---
  /** Host: a mission host op every guest plays on its own inert mission host. Data only; callbacks stay on the host. */
  | { t: 'mission'; op: string; args: unknown[] }
  /** Host: a gate is closing; a guest far from `at` is brought there. */
  | { t: 'gather'; at: Vec; yaw: number }
  /** Host: one of the garrison fired, for the guests' tracers. */
  | { t: 'ashot'; from: Vec; to: Vec }
  | { t: 'vehicles'; list: { id: number; kind: string; p: Vec; q: [number, number, number, number]; turret: number }[] };

export function encodeWorld(frame: WorldFrame): ArrayBuffer {
  const buffer = new ArrayBuffer(HEADER_BYTES + frame.enemies.length * ENEMY_BYTES);
  const view = new DataView(buffer);
  view.setUint16(0, 0xc203, true);
  view.setUint32(2, frame.seq, true);
  view.setUint16(6, frame.wave, true);
  view.setUint16(8, frame.enemies.length, true);
  view.setUint8(10, WAVE_PHASES.indexOf(frame.phase ?? 'intermission'));
  view.setUint8(11, Math.max(0, Math.min(255, Math.ceil(frame.nextWaveIn ?? 0))));
  for (let index = 0; index < frame.enemies.length; index++) {
    const enemy = frame.enemies[index]!;
    const offset = HEADER_BYTES + index * ENEMY_BYTES;
    view.setUint32(offset, enemy.uid, true);
    view.setUint8(offset + 4, ENEMY_IDS.indexOf(enemy.id));
    view.setUint8(offset + 5, enemy.flags);
    view.setUint8(offset + 6, enemy.animation);
    view.setUint8(offset + 7, enemy.plates);
    enemy.position.forEach((value, axis) => view.setFloat32(offset + 8 + axis * 4, value, true));
    view.setFloat32(offset + 20, enemy.yaw, true);
    view.setFloat32(offset + 24, enemy.health, true);
    view.setFloat32(offset + 28, enemy.maxHealth, true);
    view.setFloat32(offset + 32, enemy.armor, true);
    enemy.velocity.forEach((value, axis) => view.setInt16(offset + 36 + axis * 2, Math.round(Math.max(-327, Math.min(327, value)) * 100), true));
    view.setUint16(offset + 42, enemy.severed, true);
    view.setUint8(offset + 44, Math.max(0, POSTURES.indexOf(enemy.posture ?? 'stand')));
  }
  return buffer;
}

export function decodeWorld(data: unknown): WorldFrame | null {
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data instanceof Uint8Array ? data : null;
  if (!bytes || bytes.byteLength < HEADER_BYTES) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint16(0, true) !== 0xc203) return null;
  const count = view.getUint16(8, true);
  if (count > 48 || bytes.byteLength !== HEADER_BYTES + count * ENEMY_BYTES) return null;
  const enemies: EnemyFrame[] = [];
  const ids = new Set<number>();
  for (let index = 0; index < count; index++) {
    const offset = HEADER_BYTES + index * ENEMY_BYTES;
    const id = ENEMY_IDS[view.getUint8(offset + 4)];
    const uid = view.getUint32(offset, true);
    const position = [0, 1, 2].map(axis => view.getFloat32(offset + 8 + axis * 4, true)) as Vec;
    const yaw = view.getFloat32(offset + 20, true);
    const health = view.getFloat32(offset + 24, true), maxHealth = view.getFloat32(offset + 28, true), armor = view.getFloat32(offset + 32, true);
    if (!id || !uid || ids.has(uid) || !validVec(position) || !Number.isFinite(yaw) || ![health, maxHealth, armor].every(value => Number.isFinite(value) && value >= 0)) return null;
    ids.add(uid);
    const wounds = view.getUint16(offset + 42, true);
    enemies.push({ uid, id, position, yaw, health, maxHealth, armor, flags: view.getUint8(offset + 5), animation: view.getUint8(offset + 6),
      velocity: [0, 1, 2].map(axis => view.getInt16(offset + 36 + axis * 2, true) / 100) as Vec, severed: wounds & 2047, plates: view.getUint8(offset + 7),
      posture: POSTURES[view.getUint8(offset + 44)] ?? 'stand' });
  }
  const phase = WAVE_PHASES[view.getUint8(10)];
  if (!phase) return null;
  return { seq: view.getUint32(2, true), wave: view.getUint16(6, true), phase, nextWaveIn: view.getUint8(11), enemies };
}

export const validVec = (value: unknown): value is Vec => Array.isArray(value) && value.length === 3
  && value.every(axis => typeof axis === 'number' && Number.isFinite(axis) && Math.abs(axis) <= 100000);

export function packDamage(damage: DamageInfo): WireDamage {
  return { ...damage, point: damage.point.toArray() as Vec, dir: damage.dir.toArray() as Vec,
    slicePlaneNormal: damage.slicePlaneNormal?.toArray() as Vec | undefined };
}
