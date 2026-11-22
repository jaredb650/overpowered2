/** Escort gunships, Warthog breach, friendly squads & ending cutscene stub (replaced by Lane 3). */
import type * as THREE from 'three';
import type { Ctx } from '../../core/contracts';
import type { CampaignHud } from '../hud';
import type { MissionRunner } from '../runner';
import type { AirAndSquadsController } from './types';

export class DesertAirAndSquads implements AirAndSquadsController {
  aliveFriendlies = 0;
  constructor(private readonly _ctx: Ctx, private readonly _runner: MissionRunner, private readonly _ui: CampaignHud) {}
  startEscort(): void {}
  strikeMainGate(onBreached: () => void): void { onBreached(); }
  dropWarrenSquads(): void {}
  advanceSquads(_stage: 'warren' | 'pumpyard'): void {}
  startEndingCutscene(_getConvoyPos: (out: THREE.Vector3) => THREE.Vector3, _quistCaptured: boolean, onDone: () => void): void { onDone(); }
  update(_dt: number): void {}
  clear(): void {}
  reset(): void {}
}
