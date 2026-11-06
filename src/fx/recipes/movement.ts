import * as THREE from 'three';
import type { Ctx } from '../../core/contracts';
import type { FxCore } from '../core';
import { jumpPad } from './misc';

const _n = new THREE.Vector3();

/**
 * World things that have a look but do not call FX themselves. Player movement does call in, from
 * src/player/feedback.ts, which knows the wall normal and spaces slide dust by distance.
 */
export function listen(ctx: Ctx, core: FxCore): void {
  ctx.events.on('world:pad', e => {
    _n.copy(e.velocity).normalize();
    jumpPad(core, e.position, _n);
  });
}
