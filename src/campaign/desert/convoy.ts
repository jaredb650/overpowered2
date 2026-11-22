/** Convoy & bandit vehicles stub (replaced by Lane 2). */
import * as THREE from 'three';
import type { Ctx } from '../../core/contracts';
import type { CampaignHud } from '../hud';
import type { MissionRunner } from '../runner';
import type { ConvoyController } from './types';

export class DesertConvoy implements ConvoyController {
  banditVehiclesDestroyed = 0;
  constructor(private readonly _ctx: Ctx, private readonly _runner: MissionRunner, private readonly _ui: CampaignHud) {}
  startApproach(): void {}
  startWallLoop(): void {}
  dismountAtGate(): void {}
  arriveForExfil(_quistCaptured: boolean): void {}
  startExfilChase(_quistCaptured: boolean): void {}
  spawnSideGateTruck(_side: 'west' | 'east'): void {}
  spawnBanditWave(_phase: 'approach' | 'exfil', _count: number): void {}
  isPlayerBoarded(): boolean { return false; }
  getTruckPosition(out: THREE.Vector3): THREE.Vector3 { return out.set(0, 0, 208); }
  getTruckYaw(): number { return 0; }
  update(_dt: number): void {}
  clear(): void {}
  reset(): void {}
}
