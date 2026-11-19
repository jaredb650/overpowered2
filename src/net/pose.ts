/** Stage 1 pose lane. Little endian, bounded and versioned; no browser or account identifiers. */
export const POSE_HZ = 20;
export const POSE_MS = 1000 / POSE_HZ;
export const INTERPOLATION_MS = 100;
/**
 * `wallrun` is a wall on the left, `wallrunR` on the right. `downed` is co-op's crawl, `revive` kneeling over a friend. `jet` is
 * airborne with Jump Jet burning. New moves go on the end, so the old ones keep their numbers.
 */
export const MOVES = ['walk', 'sprint', 'crouch', 'slide', 'airborne', 'wallrun', 'downed', 'mantle', 'wallrunR', 'revive', 'jet'] as const;
export type Move = typeof MOVES[number];
export interface Pose {
  seq: number;
  position: [number, number, number];
  velocity: [number, number, number];
  yaw: number;
  pitch: number;
  move: Move;
  weapon: string;
}
const HEADER = 40;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

/** Slot is assigned by the host's roster, never claimed by a guest. 40 byte header + UTF-8 weapon id. */
export function encodePose(p: Pose, slot: number): ArrayBuffer {
  const weapon = encoder.encode(p.weapon);
  if (weapon.length > 32 || slot < 0 || slot > 3 || !Number.isInteger(slot)) throw new Error('Invalid pose');
  const data = new ArrayBuffer(HEADER + weapon.length);
  const v = new DataView(data);
  v.setUint8(0, 1);
  v.setUint8(1, slot);
  v.setUint8(2, MOVES.indexOf(p.move));
  v.setUint8(3, weapon.length);
  v.setUint32(4, p.seq, true);
  [...p.position, ...p.velocity, p.yaw, p.pitch].forEach((n, i) => v.setFloat32(8 + i * 4, n, true));
  new Uint8Array(data, HEADER).set(weapon);
  if (!decodePose(data)) throw new Error('Invalid pose');
  return data;
}

export function decodePose(data: unknown): { slot: number; pose: Pose } | null {
  // trystero receives binary actions as Uint8Array, including slices into a larger backing buffer.
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data)
    : data instanceof Uint8Array ? data : null;
  if (!bytes || bytes.byteLength < HEADER || bytes.byteLength > HEADER + 32) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (v.getUint8(0) !== 1 || v.getUint8(1) > 3 || v.getUint8(2) >= MOVES.length || v.getUint8(3) !== bytes.length - HEADER) return null;
  const n = Array.from({ length: 8 }, (_, i) => v.getFloat32(8 + i * 4, true));
  if (n.some(x => !Number.isFinite(x)) || n.slice(0, 3).some(x => Math.abs(x) > 10000)
    || n.slice(3, 6).some(x => Math.abs(x) > 1000) || Math.abs(n[6]!) > Math.PI * 2 + 0.01 || Math.abs(n[7]!) > Math.PI) return null;
  let weapon: string;
  try { weapon = decoder.decode(bytes.subarray(HEADER)); } catch { return null; }
  if (!/^[a-zA-Z0-9_-]{1,32}$/.test(weapon)) return null;
  return { slot: v.getUint8(1), pose: { seq: v.getUint32(4, true), position: n.slice(0, 3) as Pose['position'],
    velocity: n.slice(3, 6) as Pose['velocity'], yaw: n[6]!, pitch: n[7]!, move: MOVES[v.getUint8(2)]!, weapon } };
}

/** Arrival-time timeline: no assumption that peers' performance.now clocks agree. Never extrapolates a stale player. */
export class PoseBuffer {
  private frames: { at: number; pose: Pose }[] = [];
  push(pose: Pose, at: number): boolean {
    const last = this.frames.at(-1);
    if (last && ((pose.seq - last.pose.seq) >>> 0) >= 0x80000000) return false;
    if (last?.pose.seq === pose.seq) return false;
    // Teleports snap instead of drawing a body through walls.
    if (last && Math.hypot(...pose.position.map((n, i) => n - last.pose.position[i]!) as [number, number, number]) > 10) this.frames = [];
    this.frames.push({ at: last ? Math.max(at, last.at + 0.01) : at, pose });
    if (this.frames.length > 32) this.frames.shift();
    return true;
  }
  /** Nothing new for `ms`: a frozen tab, a dropped link. The body is hidden rather than left standing as a statue. */
  stale(now: number, ms = 3000): boolean {
    const last = this.frames.at(-1);
    return !last || now - last.at > ms;
  }

  /** The newest pose and when it arrived, untouched by the playback delay. Null before the first. */
  latest(): { at: number; pose: Pose } | null {
    return this.frames.at(-1) ?? null;
  }

  sample(now: number): Pose | null {
    const target = now - INTERPOLATION_MS;
    while (this.frames.length > 2 && this.frames[1]!.at <= target) this.frames.shift();
    const a = this.frames[0];
    if (!a) return null;
    const b = this.frames[1];
    if (!b || target <= a.at) return a.pose;
    const t = Math.min(1, (target - a.at) / (b.at - a.at));
    const lerp = (x: number, y: number) => x + (y - x) * t;
    const angle = Math.atan2(Math.sin(b.pose.yaw - a.pose.yaw), Math.cos(b.pose.yaw - a.pose.yaw));
    return { ...b.pose, position: a.pose.position.map((x, i) => lerp(x, b.pose.position[i]!)) as Pose['position'],
      velocity: a.pose.velocity.map((x, i) => lerp(x, b.pose.velocity[i]!)) as Pose['velocity'],
      yaw: a.pose.yaw + angle * t, pitch: lerp(a.pose.pitch, b.pose.pitch), move: t < 0.5 ? a.pose.move : b.pose.move };
  }
}
