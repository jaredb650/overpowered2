/** The Crucible: authoring order for the whole map. */
import type { Kit } from '../kit/kit';
import type { MapSpec } from './spec';
import { authorGround } from './ground';
import { authorRing } from './ring';
import { authorCore } from './core';
import { authorViaducts } from './viaducts';
import { authorLower } from './lower';
import { authorFoundry } from './foundry';
import { authorRefinery } from './refinery';
import { authorScrapyard } from './scrapyard';
import { authorTransit } from './transit';
import * as THREE from 'three';

export interface MapStage {
  label: string;
  run(k: Kit, spec: MapSpec): void;
}

export const MAP_STAGES: readonly MapStage[] = [
  { label: 'Pouring the ground', run: k => authorGround(k) },
  { label: 'Raising the Ring Road', run: authorRing },
  { label: 'Sinking the Core', run: authorCore },
  { label: 'Spanning the viaducts', run: authorViaducts },
  { label: 'Boring the tunnels', run: authorLower },
  { label: 'Lighting the furnace', run: authorFoundry },
  { label: 'Piping the Refinery', run: authorRefinery },
  { label: 'Stacking the Scrapyard', run: authorScrapyard },
  { label: 'Parking the trains', run: authorTransit },
];

/** Zones are declared in priority order: zoneAt returns the first match. */
export function authorMap(_k: Kit, spec: MapSpec): void {
  spec.zone('core', 'Crucible Core', -74, -20, -74, 74, 120, 74);
  spec.zone('foundry', 'Foundry', -141, -20, -141, 141, 120, -74);
  spec.zone('scrapyard', 'Scrapyard', -141, -20, 74, 141, 120, 141);
  spec.zone('transit', 'Transit', -141, -20, -74, -74, 120, 74);
  spec.zone('refinery', 'Refinery', 74, -20, -74, 141, 120, 74);
  spec.zone('ring', 'Ring Road', -176, -20, -176, 176, 120, 176);
  const spawn = (x: number, y: number, z: number, yaw: number) => spec.playerSpawns.push({ position: new THREE.Vector3(x, y, z), yaw });
  spawn(0, 0.1, 62, 0);
  spawn(62, 0.1, 0, Math.PI / 2);
  spawn(0, 0.1, -62, Math.PI);
  spawn(-62, 0.1, 0, -Math.PI / 2);
}
