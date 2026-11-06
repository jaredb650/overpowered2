/** Checks the toolchain end to end: three.js renders, Rapier steps, the harness reports. */
import * as THREE from 'three';
import { Physics } from '../physics/Physics';
import { makeCtx, runLoop } from './harness';
import { CG } from '../core/contracts';

export default async function smoke(): Promise<void> {
  const physics = await Physics.create();
  const ctx = makeCtx({ physics });
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(innerWidth, innerHeight);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a2a3a);
  const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 100);
  camera.position.set(4, 3, 6);
  camera.lookAt(0, 1, 0);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x223344, 2));
  physics.addStaticBox(new THREE.Vector3(0, -0.5, 0), new THREE.Vector3(20, 0.5, 20), null, 'concrete');
  physics.flushQueries();
  const body = physics.world.createRigidBody(physics.R.RigidBodyDesc.dynamic().setTranslation(0, 5, 0));
  physics.world.createCollider(physics.R.ColliderDesc.cuboid(0.5, 0.5, 0.5), body);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xff3300 }));
  scene.add(mesh);
  const ground = new THREE.Mesh(new THREE.BoxGeometry(40, 1, 40), new THREE.MeshStandardMaterial({ color: 0x445566 }));
  ground.position.y = -0.5;
  scene.add(ground);
  const down = physics.raycast(new THREE.Vector3(3, 5, 3), new THREE.Vector3(0, -1, 0), 20, CG.World);
  const sweep = physics.sweepCapsule(new THREE.Vector3(3, 5, 3), 0.5, 0.5, new THREE.Vector3(0, -8, 0));
  console.log('smoke raycast', down?.distance, down?.surface, 'sweep', sweep?.fraction, sweep?.normal.toArray());
  runLoop(ctx, () => {
    physics.step(ctx.time.dt);
    const t = body.translation();
    mesh.position.set(t.x, t.y, t.z);
    renderer.render(scene, camera);
  }, () => ({ y: body.translation().y }));
}
