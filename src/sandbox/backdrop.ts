/**
 * The main menu's background on its own, without a map or the menu over it.
 *
 *   /?sandbox=backdrop                       the scene as the menu shows it
 *   &mode=still                              the still frame
 *   &hand=1&look=0&exhale=0&ember=1&shift=0  holds those parts of the pose (0..1 each)
 *   &t=<seconds>                             runs the clock ahead first
 *   &cam=close|side&dist=<m>                 a close camera on his head: from the menu camera's side, or from the door
 *
 * window.__bd is the backdrop.
 */
import { createRenderSystem, type Renderer } from '../render';
import { makeCtx, runLoop } from './harness';
import { createCharacterLibrary } from '../characters/index';
import { MenuBackdrop } from '../ui/backdrop/MenuBackdrop';
import type { BackdropMode, SmokerPose } from '../ui/backdrop/rhythm';
import type { Character } from '../characters/Character';
import { HumanoidBone } from '../characters/rig';
import * as THREE from 'three';

const KEYS: readonly (keyof SmokerPose)[] = ['hand', 'draw', 'ember', 'exhale', 'look', 'shift'];

export default async function backdrop(params: URLSearchParams): Promise<void> {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const render = (await createRenderSystem(canvas)) as Renderer;
  const ctx = makeCtx({ render });
  render.init(ctx);
  ctx.characters = createCharacterLibrary(ctx);
  const bd = new MenuBackdrop(ctx);
  const mode = (params.get('mode') ?? 'heli') as BackdropMode;
  const hold: Partial<SmokerPose> = {};
  for (const k of KEYS) if (params.has(k)) hold[k] = Number(params.get(k));
  if (Object.keys(hold).length) bd.poseOverride = hold;
  for (let t = Number(params.get('t') ?? 0); t > 0; t -= 1 / 30) bd.rhythm.update(1 / 30);
  (window as unknown as { __bd: MenuBackdrop }).__bd = bd;
  const cam = params.get('cam');
  const dist = Number(params.get('dist') ?? 0.75);
  const head = new THREE.Vector3();
  runLoop(ctx, () => {
    bd.update(ctx.time.realDt, true, mode, false);
    const body = (bd as unknown as { body: Character | null }).body;
    if (cam && body) {
      // Aimed at the face: the head bone sits at the neck, the face about 9 cm above it.
      body.bones[HumanoidBone.head]!.localToWorld(head.set(0, 0.07, 0.05));
      const c = bd.camera;
      const from = cam === 'side' ? new THREE.Vector3(1, 0.15, -0.2) : c.position.clone().sub(head).normalize();
      c.position.copy(head).addScaledVector(from.normalize(), dist);
      c.fov = 30;
      c.updateProjectionMatrix();
      c.lookAt(head);
      c.updateMatrixWorld();
    }
    render.render();
  }, () => ({ backdrop: bd.stats(), calls: render.drawCalls(), triangles: render.triangles() }));
}
