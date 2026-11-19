/** The enemy snapshot lane's binary frame: what the host sends of every enemy, and how both ends read it (replicas.ts). */
import type { EnemyId, WavePhase } from '../../core/gameplay';
import { ENEMY_IDS, validVec, type Vec } from './wire';

export const SNAPSHOT_MS = 100;
export const HEADER_BYTES = 12;
export const ENEMY_BYTES = 45;
/** A man's posture (characters/animation/postures.ts), so a guest sees him with his hands up, cuffed, cowering or in cover. */
export const POSTURES = ['stand', 'crouch', 'cover', 'peek', 'leanLeft', 'leanRight', 'handsUp', 'kneel', 'cower', 'flee', 'drag', 'revive', 'downed',
  'hunched', 'pistol', 'cuffed', 'bound', 'fumble', 'temple'] as const;
export type PostureId = typeof POSTURES[number];
/** Flag bit: he has surrendered and can be cuffed (Endless Humans). */
export const CAPTURABLE = 128;
export interface EnemyFrame {
  uid: number; id: EnemyId; position: Vec; velocity: Vec; yaw: number; health: number; maxHealth: number; armor: number;
  flags: number; animation: number; severed: number; plates: number; posture?: PostureId;
}
export const WAVE_PHASES: readonly WavePhase[] = ['intermission', 'spawning', 'clearing', 'boss'];
export interface WorldFrame { seq: number; wave: number; phase?: WavePhase; nextWaveIn?: number; enemies: EnemyFrame[] }

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
