/**
 * The co-op world's wire format, gathered for everyone outside `world/`. The pieces live with the code that owns them:
 * vectors and damage in world/wire.ts, the binary enemy snapshot in world/snapshot.ts, and each event's shape in the module
 * that sends and handles it. `WorldEvent` is the union of those: a module with a new event adds its type here, one line.
 */
import type { MissionEvent } from './mission';
import type { TeamEvent } from './team';
import type { AlliesEvent } from './world/allies';
import type { AttackEvent } from './world/attacks';
import type { BoomEvent } from './world/booms';
import type { CallinEvent } from './world/callins';
import type { CaptureEvent } from './world/capture';
import type { ChatterEvent } from './world/chatter';
import type { ClaimEvent } from './world/claims';
import type { SlowEvent } from './world/clock';
import type { EnemyFireEvent } from './world/enemyFire';
import type { GunEvent } from './world/guns';
import type { HitEvent } from './world/hits';
import type { FireEvent, KataEvent } from './world/remoteFire';
import type { SonarEvent } from './world/sonar';
import type { AwardEvent } from './world/credit';
import type { HurtEvent } from './world/targeting';
import type { VehiclesEvent } from './world/vehicles';
import type { VillainEvent } from './world/villain';
import type { WarningEvent } from './world/warnings';

export * from './world/wire';
export * from './world/snapshot';
export type { HitClaim, StatusClaim, VehicleClaim } from './world/claims';
export type { Card, Ending, LifeState } from './team';

/** Everything that crosses the reliable `action` lane (world/context.ts `send`, world/router.ts). */
export type WorldEvent =
  | ClaimEvent      // world/claims.ts: hit, status, vhit
  | HitEvent        // world/hits.ts: hitfx, kill, sever
  | FireEvent       // world/remoteFire.ts: fire
  | KataEvent       // world/remoteFire.ts: kata
  | HurtEvent       // world/targeting.ts: hurt, shove, ghost
  | EnemyFireEvent  // world/enemyFire.ts: ray, proj, projx, projhit, efx
  | AttackEvent     // world/attacks.ts: atk, atkf, atke, say, bossfx
  | WarningEvent    // world/warnings.ts: zone, glint, laser, shock, strike, bang
  | VillainEvent    // world/villain.ts: cmd
  | BoomEvent       // world/booms.ts: boom
  | CallinEvent     // world/callins.ts: callin
  | SonarEvent      // world/sonar.ts: sonar
  | ChatterEvent    // world/chatter.ts: chatter, chatcut
  | SlowEvent       // world/clock.ts: slow
  | CaptureEvent    // world/capture.ts: capture, credit
  | AwardEvent      // world/credit.ts: award
  | GunEvent        // world/guns.ts: gun
  | VehiclesEvent   // world/vehicles.ts: vehicles
  | AlliesEvent     // world/allies.ts: allies, ashot
  | TeamEvent       // team.ts: life, card, team, revive, up, wave, over, restore, kit, ready, vote, sync, mark
  | MissionEvent    // mission.ts: mission, gather
  /** Host to guests: the host's tab went to the background (`on`) or came back. Declared, never sent or handled. */
  | { t: 'hidden'; on: boolean };
