/** The same Bailiff body and HumanoidAnimator that allies use, without AI, damage colliders or foe registration. */
import * as THREE from 'three';
import type { CharacterInstance, Ctx } from '../core/contracts';
import type { HumanoidAnimator } from '../characters/animation';
import type { LobbyPlayer } from './lobby';
import { PoseBuffer, type Pose } from './pose';

export const COLORS = [0x39e0ff, 0xffb33d, 0xc69bff, 0x79f1ad];
type Stance = 'rifle' | 'pistol' | 'shoulder' | 'heavy' | 'blades';
type Kit = { model: string; socket: string }[];
/** The third-person props a friend's gun is drawn with: the nearest of the baked kit the allies and enemies carry. */
export const PROPS = ['smg', 'shotgun', 'launcher', 'minigun', 'pistol', 'sniperRifle', 'blade', 'flamer', 'riotShield'] as const;
const LOOKS: Record<string, [Kit, Stance]> = {
  smg: [[{ model: 'smg', socket: 'handR' }], 'rifle'],
  shotgun: [[{ model: 'shotgun', socket: 'handR' }], 'rifle'],
  launcher: [[{ model: 'launcher', socket: 'handR' }], 'shoulder'],
  minigun: [[{ model: 'minigun', socket: 'handR' }], 'heavy'],
  pistol: [[{ model: 'pistol', socket: 'handR' }], 'pistol'],
  sniperRifle: [[{ model: 'sniperRifle', socket: 'handR' }], 'rifle'],
  blade: [[{ model: 'blade', socket: 'handR' }], 'blades'],
  flamer: [[{ model: 'flamer', socket: 'handR' }], 'rifle'],
};
/** On the end of a pose's weapon id: two of it in hand, one a hand (the akimbo mod). */
export const AKIMBO_TAG = '-ak';
/** Weapon id to prop. Anything new and unlisted is drawn as the SMG. */
export function propFor(weapon: string): keyof typeof LOOKS {
  if (/^(shotgun|thresher|deuce)/.test(weapon)) return 'shotgun';
  if (/^(rocket|quiver|sabot)/.test(weapon)) return 'launcher';
  if (/^(autocannon|piledriver|buzzsaw)/.test(weapon)) return 'minigun';
  if (/^(judge|ultramag|awl|pistol|revolver)/.test(weapon)) return 'pistol';
  if (/^(lance|stakegun|rivet)/.test(weapon)) return 'sniperRifle';
  if (/^(sword|knife|crowbar|shovel|baton)/.test(weapon)) return 'blade';
  if (/^(kiln|flame|napalm)/.test(weapon)) return 'flamer';
  return 'smg';
}
const _at = new THREE.Vector3();
const _dir = new THREE.Vector3();

export class RemotePlayer {
  readonly buffer = new PoseBuffer();
  readonly char: CharacterInstance;
  readonly tag = new THREE.Vector3();
  private removeTag: () => void;
  private material: THREE.Material;
  private original: THREE.Material | THREE.Material[];

  private prop = '';
  /** Seconds to the next puff of a friend's Jump Jet. */
  private jetIn = 0;
  /** Set by the team rules (team.ts): this friend is down, and is drawn on the floor whatever their pose says. */
  downed = false;

  constructor(private readonly ctx: Ctx, readonly player: LobbyPlayer) {
    this.char = ctx.characters.spawn('bailiff');
    this.arm('smg');
    const color = new THREE.Color(COLORS[player.slot] ?? COLORS[0]);
    this.original = this.char.mesh.material;
    const base = this.original as THREE.Material;
    const tint = base.clone();
    tint.onBeforeCompile = (shader, renderer) => {
      base.onBeforeCompile(shader, renderer);
      shader.uniforms.uCoopTint = { value: color };
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uCoopTint;')
        .replace('diffuseColor.rgb = sAlb;', 'sAlb = mix(sAlb, sAlb * uCoopTint * 2.0 + uCoopTint * 0.035, 0.65);\ndiffuseColor.rgb = sAlb;');
    };
    tint.customProgramCacheKey = () => `${base.customProgramCacheKey()}:coop`;
    this.material = tint;
    this.char.mesh.material = tint;
    this.char.root.name = `coop:${player.name}`;
    this.char.root.visible = false;
    ctx.render.scene.add(this.char.root);
    this.color = `#${color.getHexString()}`;
    this.removeTag = ctx.hud.follow(this.tag, player.name, this.color);
  }

  private readonly color: string;
  private tagText = '';
  /** One tag per friend: their name, or (team.ts) their name with DOWN and the seconds they have left, in red. */
  setTag(text: string, color: string): void {
    if (text === this.tagText) return;
    this.tagText = text;
    this.removeTag();
    this.removeTag = this.ctx.hud.follow(this.tag, text || this.player.name, text ? color : this.color);
  }

  private arm(weapon: string): void {
    const prop = propFor(weapon);
    const two = weapon.endsWith(AKIMBO_TAG);
    if (prop + (two ? AKIMBO_TAG : '') === this.prop) return;
    this.prop = prop + (two ? AKIMBO_TAG : '');
    const lib = this.ctx.characters as Ctx['characters'] & { arm(c: CharacterInstance, kit: Kit, stance: Stance): void };
    const [kit, stance] = LOOKS[prop]!;
    // Akimbo: the same prop in the left hand too, held at the side as the Stalker holds his second blade.
    const held = two ? [...kit, { model: kit[0]!.model, socket: 'handL' }] : kit;
    try { lib.arm(this.char, held, stance); } catch { /* a prop that failed to load: keep what is held */ }
  }

  /** The muzzle in the world, for flashes and tracers: the prop's own, or the right hand's height. */
  muzzle(out: THREE.Vector3): THREE.Vector3 {
    const m = (this.char as CharacterInstance & { muzzle?: THREE.Object3D | null }).muzzle;
    if (m && this.char.root.visible) return m.getWorldPosition(out);
    return out.copy(this.char.root.position).setY(this.char.root.position.y + 1.4);
  }

  update(now: number, dt: number): void {
    const p = this.buffer.sample(now);
    if (!p || this.buffer.stale(now)) { this.char.root.visible = false; return; }
    const c = this.char;
    c.root.visible = true;
    this.arm(p.weapon);
    c.root.position.fromArray(p.position);
    // Player looks down -Z; the allies' body faces +Z.
    c.root.rotation.y = p.yaw + Math.PI;
    const speed = Math.hypot(p.velocity[0], p.velocity[2]);
    const cos = Math.cos(c.root.rotation.y), sin = Math.sin(c.root.rotation.y);
    const anim = c.anim as HumanoidAnimator;
    const down = this.downed || p.move === 'downed';
    anim.setPosture(down ? 'downed' : p.move === 'revive' ? 'revive' : p.move === 'slide' || p.move === 'crouch' || p.move === 'mantle' ? 'crouch'
      : p.move === 'wallrun' ? 'leanLeft' : p.move === 'wallrunR' ? 'leanRight' : 'stand');
    // A slide is a crouch carried at speed; a jump, a mantle and a wall run are the airborne gait.
    c.anim.setLocomotion({ speed, moveX: speed > 0.1 ? (p.velocity[0] * cos - p.velocity[2] * sin) / speed : 0,
      moveZ: speed > 0.1 ? (p.velocity[0] * sin + p.velocity[2] * cos) / speed : 0,
      aimYaw: 0, aimPitch: down ? 0 : p.pitch, grounded: !['airborne', 'wallrun', 'wallrunR', 'mantle', 'jet'].includes(p.move) });
    c.anim.update(dt, 0);
    c.root.updateMatrixWorld(true);
    // Above the head and clear of the HUD's own markers, which sit at chest height on what they mark.
    this.tag.copy(c.root.position).y += down ? 1.0 : p.move === 'crouch' || p.move === 'slide' ? 2.0 : 2.6;
    c.root.userData.weapon = p.weapon;
    if (p.move === 'jet') this.jet(dt);
  }

  /** A friend's Jump Jet burning: the same short flames as the local pack's, from their back, at half the rate. */
  private jet(dt: number): void {
    this.jetIn -= dt;
    if (this.jetIn > 0) return;
    this.jetIn = 1 / 30;
    const r = this.char.root;
    // The body faces +Z in its own frame: its back is -Z.
    const s = Math.sin(r.rotation.y), c = Math.cos(r.rotation.y);
    _dir.set(-s * 0.25, -1, -c * 0.25).normalize();
    for (const k of [-1, 1]) {
      _at.set(r.position.x - s * 0.3 + c * 0.08 * k, r.position.y + 1.02, r.position.z - c * 0.3 - s * 0.08 * k);
      this.ctx.fx.jet?.(_at, _dir, 2);
    }
  }

  push(pose: Pose, now: number): void { this.buffer.push(pose, now); }
  dispose(): void {
    this.removeTag();
    this.char.mesh.material = this.original;
    this.char.release();
    this.material.dispose();
  }
}
