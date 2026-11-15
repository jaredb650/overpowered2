/**
 * The Rocket's laser sight (docs/proposals/weapons-update.md section 4). Right click toggles `sight`; while it is up and the
 * launcher is in hand `on` is true and `at` is where the crosshair points, both written by Weapons every frame. A rocket
 * fired `wired` steers for `at` while `on`, and flies straight while not (Projectiles). One launcher, so one laser.
 */
import * as THREE from 'three';

export const ROCKET_LASER = { sight: false, on: false, at: new THREE.Vector3() };
