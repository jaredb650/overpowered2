/** The laser module's beam: the dot on the shot's own ray, the beams from the emitters as drawn, the aimed dot on the same pixel. */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { RayHit } from '../../core/contracts';
import { LAM, LamBeams, laserEnd, viewToWorld, type LaserCast } from './lam';

const eye = new THREE.Vector3(2, 1.6, -3);
const look = new THREE.Vector3(0.3, -0.1, -1).normalize();
/** A wall `at` metres down the ray, as physics.raycastInto would answer; the rays it was asked are kept. */
function wall(at: number, asked: [THREE.Vector3, THREE.Vector3][] = []): LaserCast {
  return (o, d, max, out) => {
    asked.push([o.clone(), d.clone()]);
    if (at > max) return false;
    out.point.copy(o).addScaledVector(d, at);
    out.normal.copy(d).negate();
    out.distance = at;
    return true;
  };
}
const hit = (): RayHit => ({ point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0, surface: 'concrete', collider: null });

/** A world camera and a narrower view camera at the same eye and look, as the renderer has them. */
function cameras(): [THREE.PerspectiveCamera, THREE.PerspectiveCamera] {
  const camera = new THREE.PerspectiveCamera(90, 16 / 10, 0.1, 1000);
  const view = new THREE.PerspectiveCamera(58, 16 / 10, 0.01, 12);
  for (const c of [camera, view]) {
    c.position.copy(eye);
    c.lookAt(eye.clone().add(look));
    c.updateMatrixWorld();
  }
  return [camera, view];
}
const ndc = (p: THREE.Vector3, c: THREE.Camera) => p.clone().project(c);
const uniform = (m: THREE.Mesh, name: string) => (m.material as THREE.ShaderMaterial).uniforms[name]!.value;

describe('laser beam', () => {
  it('ends on a surface in range, and at the range with none', () => {
    const end = new THREE.Vector3();
    expect(laserEnd(eye, look, wall(12), hit(), end)).toBe(true);
    expect(end.distanceTo(eye)).toBeCloseTo(12);
    expect(laserEnd(eye, look, wall(LAM.range + 5), hit(), end)).toBe(false);
    expect(end.distanceTo(eye)).toBeCloseTo(LAM.range);
    // A stand-in physics answers with something that is not a boolean: nothing hit.
    expect(laserEnd(eye, look, (() => ({})) as unknown as LaserCast, hit(), end)).toBe(false);
  });

  it('puts the dot on the shot\'s own ray where it meets the wall, and none when nothing is in range', () => {
    const beams = new LamBeams();
    beams.set(0, new THREE.Object3D(), 1);
    const asked: [THREE.Vector3, THREE.Vector3][] = [];
    beams.target(eye, look, wall(9, asked));
    expect(asked[0]![0].equals(eye) && asked[0]![1].equals(look)).toBe(true);
    expect(beams.dotOn()).toBe(true);
    const impact = eye.clone().addScaledVector(look, 9);
    expect(beams.end.distanceTo(impact)).toBeLessThan(1e-9);
    // A touch back along the same ray, so on the same pixel as the impact.
    expect(beams.dotAt.distanceTo(impact)).toBeLessThan(0.03);
    expect(beams.dotAt.clone().sub(eye).normalize().dot(look)).toBeGreaterThan(1 - 1e-9);
    beams.target(eye, look, wall(80));
    expect(beams.dotOn()).toBe(false);
    expect(beams.end.distanceTo(eye.clone().addScaledVector(look, LAM.range))).toBeLessThan(1e-9);
  });

  it('casts its one ray down the centre of the camera as it draws, so the dot is on the crosshair', () => {
    const [camera, view] = cameras();
    // The camera a few centimetres off the eye (head bob): the ray is the camera's, not the eye's.
    camera.position.add(new THREE.Vector3(0.03, -0.02, 0));
    camera.updateMatrixWorld();
    const beams = new LamBeams();
    beams.viewCamera = view;
    const asked: [THREE.Vector3, THREE.Vector3][] = [];
    beams.cast = wall(0.8, asked);
    beams.draw(null, camera);
    expect(asked.length).toBe(0);
    beams.set(0, new THREE.Object3D(), 1);
    beams.draw(null, camera);
    expect(asked.length).toBe(1);
    expect(asked[0]![0].distanceTo(camera.position)).toBeLessThan(1e-9);
    expect(asked[0]![1].distanceTo(camera.getWorldDirection(new THREE.Vector3()))).toBeLessThan(1e-9);
    expect(beams.dotOn()).toBe(true);
    const at = ndc(beams.dotAt, camera);
    expect(Math.hypot(at.x, at.y)).toBeLessThan(1e-6);
    expect((uniform(beams.mesh, 'uDot') as THREE.Vector3).distanceTo(beams.dotAt)).toBeLessThan(1e-9);
  });

  it('draws each beam from its emitter\'s pixel to the impact, both guns to one dot', () => {
    const [camera, view] = cameras();
    const beams = new LamBeams();
    beams.viewCamera = view;
    const right = new THREE.Object3D();
    right.position.copy(eye).add(new THREE.Vector3(0.14, -0.15, -0.45));
    const left = new THREE.Object3D();
    left.position.copy(eye).add(new THREE.Vector3(-0.16, -0.14, -0.42));
    for (const o of [right, left]) o.updateMatrixWorld();
    beams.set(0, right, 1);
    beams.set(1, left, 1);
    beams.target(eye, look, wall(9));
    beams.draw(null, camera);
    for (const [socket, name] of [[right, 'uFrom0'], [left, 'uFrom1']] as const) {
      const a = ndc(uniform(beams.mesh, name) as THREE.Vector3, camera);
      const b = ndc(socket.position, view);
      expect(Math.hypot(a.x - b.x, a.y - b.y), name).toBeLessThan(1e-6);
    }
    expect((uniform(beams.mesh, 'uEnd') as THREE.Vector3).distanceTo(beams.end)).toBeLessThan(1e-9);
    const strength = uniform(beams.mesh, 'uStrength') as THREE.Vector3;
    expect(strength.x).toBeGreaterThan(0);
    expect(strength.y).toBeGreaterThan(0);
    expect(strength.z).toBeGreaterThan(0);
    beams.set(1, null, 1);
    beams.set(0, null, 1);
    expect(beams.active).toBe(false);
    expect(beams.mesh.visible).toBe(false);
  });

  it('draws the dot over the gun when aimed, on the pixel the world dot falls on', () => {
    const [camera, view] = cameras();
    const beams = new LamBeams();
    beams.viewCamera = view;
    beams.set(0, new THREE.Object3D(), 1);
    beams.target(eye, look, wall(14));
    beams.aim = 1;
    beams.draw(null, camera);
    expect((uniform(beams.mesh, 'uStrength') as THREE.Vector3).z).toBe(0);
    beams.drawOverlay(null, view);
    expect((uniform(beams.overlay, 'uStrength') as THREE.Vector3).z).toBeGreaterThan(0);
    const a = ndc(uniform(beams.overlay, 'uDot') as THREE.Vector3, view);
    const b = ndc(beams.dotAt, camera);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(1e-6);
    // The shot's ray is the look, so the dot is on the crosshair.
    expect(Math.hypot(b.x, b.y)).toBeLessThan(1e-6);
  });

  it('maps a view-scene point onto the world point on the same pixel', () => {
    const [camera, view] = cameras();
    const p = eye.clone().add(new THREE.Vector3(0.1, -0.12, -0.5));
    const w = viewToWorld(p, camera, view, new THREE.Vector3());
    const a = ndc(w, camera);
    const b = ndc(p, view);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(1e-6);
  });

  it('projects straight along each emitter bore when free = 1 instead of bending to the crosshair', () => {
    const [camera, view] = cameras();
    const beams = new LamBeams();
    beams.viewCamera = view;
    beams.cast = wall(12);
    // Emitter tilted 40 deg to the right (as during a reload cant), positioned in front of the view camera.
    const emitter = new THREE.Object3D();
    emitter.position.copy(eye).addScaledVector(look, 0.45).add(new THREE.Vector3(0.12, -0.1, 0));
    emitter.quaternion.copy(view.quaternion).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -0.7));
    emitter.updateMatrixWorld();

    beams.set(0, emitter, 1);
    beams.aim = 1;
    beams.free = 1;
    beams.draw(null, camera);

    const from0 = uniform(beams.mesh, 'uFrom0') as THREE.Vector3;
    const end0 = uniform(beams.mesh, 'uEnd') as THREE.Vector3;
    // Beam end diverges far from the crosshair impact (`beams.end`) because it follows the emitter's canted bore.
    expect(end0.distanceTo(beams.end)).toBeGreaterThan(2.0);
    // Projected into view/camera screen space, the beam leaves the emitter along the emitter's -Z axis.
    const tipInView = emitter.position.clone().add(new THREE.Vector3(0, 0, -1).applyQuaternion(emitter.quaternion).multiplyScalar(0.3));
    const tipWorld = viewToWorld(tipInView, camera, view, new THREE.Vector3());
    const expectedDir = tipWorld.sub(from0).normalize();
    const actualDir = end0.clone().sub(from0).normalize();
    expect(actualDir.dot(expectedDir)).toBeGreaterThan(0.95);

    // Overlay crosshair dot is hidden while free = 1 so it does not float detached over the gun.
    beams.drawOverlay(null, view);
    expect((uniform(beams.overlay, 'uStrength') as THREE.Vector3).z).toBe(0);
  });
});

