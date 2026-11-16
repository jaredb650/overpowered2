/** The same Bailiff body and HumanoidAnimator that allies use, without AI, damage colliders or foe registration. */
import * as THREE from 'three';
import type { CharacterInstance, Ctx } from '../core/contracts';
import type { HumanoidAnimator } from '../characters/animation';
import type { LobbyPlayer } from './lobby';
import { PoseBuffer, type Pose } from './pose';

const COLORS = [0x39e0ff, 0xffb33d, 0xc69bff, 0x79f1ad];
export class RemotePlayer {
  readonly buffer = new PoseBuffer();
  readonly char: CharacterInstance;
  readonly tag = new THREE.Vector3();
  private removeTag: () => void;
  private material: THREE.Material;
  private original: THREE.Material | THREE.Material[];

  constructor(private readonly ctx: Ctx, readonly player: LobbyPlayer) {
    this.char = ctx.characters.spawn('bailiff');
    const lib = ctx.characters as Ctx['characters'] & { arm(c: CharacterInstance, kit: { model: string; socket: string }[], stance: 'rifle'): void };
    lib.arm(this.char, [{ model: 'smg', socket: 'handR' }], 'rifle');
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
    this.removeTag = ctx.hud.follow(this.tag, player.name, `#${color.getHexString()}`);
  }

  update(now: number, dt: number): void {
    const p = this.buffer.sample(now);
    if (!p) return;
    const c = this.char;
    c.root.visible = true;
    c.root.position.fromArray(p.position);
    // Player looks down -Z; the allies' body faces +Z.
    c.root.rotation.y = p.yaw + Math.PI;
    const speed = Math.hypot(p.velocity[0], p.velocity[2]);
    const cos = Math.cos(c.root.rotation.y), sin = Math.sin(c.root.rotation.y);
    const anim = c.anim as HumanoidAnimator;
    anim.setPosture(p.move === 'slide' || p.move === 'crouch' ? 'crouch' : p.move === 'wallrun' ? 'leanLeft' : 'stand');
    c.anim.setLocomotion({ speed, moveX: speed > 0.1 ? (p.velocity[0] * cos - p.velocity[2] * sin) / speed : 0,
      moveZ: speed > 0.1 ? (p.velocity[0] * sin + p.velocity[2] * cos) / speed : 0,
      aimYaw: 0, aimPitch: p.pitch, grounded: p.move !== 'airborne' && p.move !== 'wallrun' });
    c.anim.update(dt, 0);
    c.root.updateMatrixWorld(true);
    this.tag.copy(c.root.position).y += p.move === 'crouch' || p.move === 'slide' ? 1.8 : 2.5;
    // Stage 2: use p.weapon to choose a third-person prop. For now everyone holds the allies' generic SMG.
    c.root.userData.weapon = p.weapon;
  }

  push(pose: Pose, now: number): void { this.buffer.push(pose, now); }
  dispose(): void {
    this.removeTag();
    this.char.mesh.material = this.original;
    this.char.release();
    this.material.dispose();
  }
}
