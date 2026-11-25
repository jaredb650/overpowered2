/**
 * Two-Army Combined-Arms Tactical AI Commander (`WarTacticalCommander`) for Endless War.
 *
 * Replaces scattered, uncoordinated lane trickles with two reactive army commanders:
 *   1. **Main Effort Concentration:** Both Allied & Enemy commanders choose a primary assault lane
 *      (`west | center | east`) every ~55 s (or snap immediately to emergencies/flanks), focusing
 *      ~65% of infantry, armor, and air power into combined-arms battlegroups while screening other lanes.
 *   2. **Intruder & Flank Emergency Response:** If friendly tanks/player breach Iron Bastion (`z < -246`)
 *      or enemy tanks/troops breach Friendly FOB Vanguard (`z > 240`), defending commanders immediately
 *      divert nearby squads, reserve armor, attack choppers, and CAS jets to crush the intruders first!
 *   3. **Active Infantry Marching:** Continuously feeds stepped lane objectives via `OutpostSquad.adopt()`
 *      so enemy infantry squads NEVER sit idle at spawn — they march to contest bridges, flank weak
 *      crossings, and storm Friendly FOB Vanguard.
 *   4. **Frontline Armor Pacing:** Dynamically sets `holdNorthZ` and `combatHold` on friendly AI tanks
 *      so armor fights WITH infantry and holds outside sealed Bastion Blast Gates instead of solo-rushing
 *      enemy spawn on second 1.
 *   5. **Anti-Armor & FOB Core Targeting (`extraFoeProvider`):** Connects enemy AT rocketeers to friendly
 *      `AiFriendlyVehicle.asFoe()` and breaching enemy troops to `FobDefenseSystem.asFoe()`.
 */
import * as THREE from 'three';
import type { Ally } from '../../allies/ally';
import type { EnemyInstance } from '../../core/gameplay';
import { clamp, rand } from '../../core/math';
import type { AiFriendlyVehicle, AiVehicleFleet } from '../../vehicles/drive/aiDriver';
import type { AiCombatJet } from '../dogfight/aiJet';
import type { Foe, Soldier } from '../outpost/soldier';
import type { OutpostSquad } from '../outpost/squad';
import type { Vehicle as EnemyVehicle } from '../vehicles/vehicle';
import {
  ENDLESS_WAR_BASTION_GATES,
  ENDLESS_WAR_CROSSINGS,
  ENDLESS_WAR_ENEMY_LANES,
  ENDLESS_WAR_FOB_CORE,
  ENDLESS_WAR_FRIENDLY_LANES,
  type WarLaneId,
} from '../../world/map/endlessWar/plan';
import type { BastionDefenseSystem } from './bastionDefense';
import type { FobDefenseSystem } from './fobDefense';

export type ArmyPosture = 'push' | 'defend_fob' | 'defend_bastion' | 'bastion_assault' | 'fob_assault';

export interface LaneIntel {
  readonly lane: WarLaneId;
  readonly x: number;
  friendlyInf: number;
  friendlyArmor: number;
  enemyInf: number;
  enemyArmor: number;
  friendlyPower: number;
  enemyPower: number;
  /** Northernmost friendly infantry Z in this lane (used to pace friendly armor). */
  friendlyFrontZ: number;
  /** Southernmost enemy Z in this lane (used to detect south breakthroughs). */
  enemyDeepestZ: number;
  /** Active frontline clash Z coordinate in this lane. */
  contactZ: number;
}

export interface WarSituation {
  readonly lanes: Readonly<Record<WarLaneId, LaneIntel>>;
  readonly fobIntruders: number;
  readonly fobBreachPos: THREE.Vector3 | null;
  readonly bastionIntruders: number;
  readonly bastionBreachPos: THREE.Vector3 | null;
  readonly bastionBreachLane: WarLaneId | null;
  readonly fobBreachLane: WarLaneId | null;
  readonly enemyMainLane: WarLaneId;
  readonly allyMainLane: WarLaneId;
  readonly enemyPosture: ArmyPosture;
  readonly allyPosture: ArmyPosture;
}

export interface TrackedEnemySquad {
  readonly squad: OutpostSquad;
  lane: WarLaneId;
  role: 'assault' | 'qrf';
}

const LANES: readonly WarLaneId[] = ['west', 'center', 'east'];
const LANE_X: Readonly<Record<WarLaneId, number>> = { west: -145, center: 0, east: 145 };

/** Classifies any world X coordinate into the West, Center, or East battlefield lane. */
export function laneForX(x: number): WarLaneId {
  if (x < -68) return 'west';
  if (x > 68) return 'east';
  return 'center';
}

export class WarTacticalCommander {
  enemyMainLane: WarLaneId = 'center';
  allyMainLane: WarLaneId = 'center';
  enemyPosture: ArmyPosture = 'push';
  allyPosture: ArmyPosture = 'push';

  private enemyPlanTimer = 55;
  private allyPlanTimer = 50;
  private squadOrderTimer = 0.8;
  private allyOrderTimer = 1.0;
  private chopperOrderTimer = 2.0;
  private qrfCooldown = 0;

  private readonly trackedSquads: TrackedEnemySquad[] = [];
  private readonly chopperMarkSets: THREE.Vector3[][] = [];
  private readonly defendingFobIds = new Set<string>();
  private readonly laneIntel: Record<WarLaneId, LaneIntel> = {
    west: this.makeLaneIntel('west'),
    center: this.makeLaneIntel('center'),
    east: this.makeLaneIntel('east'),
  };
  private readonly fobBreachVec = new THREE.Vector3();
  private readonly bastionBreachVec = new THREE.Vector3();
  private hasFobBreach = false;
  private hasBastionBreach = false;
  private fobIntruders = 0;
  private bastionIntruders = 0;
  private fobBreachLane: WarLaneId | null = null;
  private bastionBreachLane: WarLaneId | null = null;

  reset(): void {
    this.enemyMainLane = 'center';
    this.allyMainLane = 'center';
    this.enemyPosture = 'push';
    this.allyPosture = 'push';
    this.enemyPlanTimer = 55;
    this.allyPlanTimer = 50;
    this.squadOrderTimer = 0.8;
    this.allyOrderTimer = 1.0;
    this.chopperOrderTimer = 2.0;
    this.qrfCooldown = 0;
    this.trackedSquads.length = 0;
    this.chopperMarkSets.length = 0;
    this.defendingFobIds.clear();
    this.hasFobBreach = false;
    this.hasBastionBreach = false;
    this.fobIntruders = 0;
    this.bastionIntruders = 0;
    this.fobBreachLane = null;
    this.bastionBreachLane = null;
  }

  registerEnemySquad(squad: OutpostSquad, lane: WarLaneId, role: 'assault' | 'qrf' = 'assault'): void {
    this.trackedSquads.push({ squad, lane, role });
  }

  registerChopperMarks(marks: THREE.Vector3[]): void {
    this.chopperMarkSets.push(marks);
  }

  getSituation(): WarSituation {
    return {
      lanes: this.laneIntel,
      fobIntruders: this.fobIntruders,
      fobBreachPos: this.hasFobBreach ? this.fobBreachVec : null,
      bastionIntruders: this.bastionIntruders,
      bastionBreachPos: this.hasBastionBreach ? this.bastionBreachVec : null,
      bastionBreachLane: this.bastionBreachLane,
      fobBreachLane: this.fobBreachLane,
      enemyMainLane: this.enemyMainLane,
      allyMainLane: this.allyMainLane,
      enemyPosture: this.enemyPosture,
      allyPosture: this.allyPosture,
    };
  }

  /** Selects a lane for the next enemy spawn (68% Main Effort concentration, 32% screening flanks). */
  pickEnemySpawnLane(): WarLaneId {
    if (this.hasBastionBreach && this.bastionBreachLane && Math.random() < 0.78) {
      return this.bastionBreachLane;
    }
    if (Math.random() < 0.68) return this.enemyMainLane;
    const others = LANES.filter(l => l !== this.enemyMainLane);
    return others[Math.floor(Math.random() * others.length)]!;
  }

  /** Selects a lane for the next friendly spawn (65% Main Effort concentration, 35% screening flanks). */
  pickFriendlySpawnLane(): WarLaneId {
    if (this.hasFobBreach && this.fobBreachLane && Math.random() < 0.80) {
      return this.fobBreachLane;
    }
    if (Math.random() < 0.65) return this.allyMainLane;
    const others = LANES.filter(l => l !== this.allyMainLane);
    return others[Math.floor(Math.random() * others.length)]!;
  }

  /** Returns true when Iron Bastion is breached and QRF AT reinforcements should be dispatched immediately. */
  shouldTriggerBastionQrf(): boolean {
    if (!this.hasBastionBreach || this.qrfCooldown > 0) return false;
    this.qrfCooldown = 26;
    return true;
  }

  /** Evaluates the entire 480 m x 720 m warfront and updates both commanders' postures & Main Effort lanes. */
  evaluate(
    dt: number,
    allies: readonly Ally[],
    allyVehicles: readonly AiFriendlyVehicle[],
    enemies: readonly EnemyInstance[],
    enemyVehicles: readonly EnemyVehicle[],
    playerPos: THREE.Vector3 | null,
    bastion: BastionDefenseSystem,
  ): WarSituation {
    if (this.qrfCooldown > 0) this.qrfCooldown = Math.max(0, this.qrfCooldown - dt);

    for (const l of LANES) {
      const info = this.laneIntel[l];
      info.friendlyInf = 0;
      info.friendlyArmor = 0;
      info.enemyInf = 0;
      info.enemyArmor = 0;
      info.friendlyPower = 0;
      info.enemyPower = 0;
      info.friendlyFrontZ = 240;
      info.enemyDeepestZ = -240;
      info.contactZ = 0;
    }

    let fobCount = 0;
    let bestFobScore = -1;
    let bastionCount = 0;
    let bestBastionScore = -1;

    // 1. Scan friendly infantry
    for (const a of allies) {
      if (!a.alive) continue;
      const p = a.body.position;
      const lane = laneForX(p.x);
      const info = this.laneIntel[lane];
      info.friendlyInf++;
      info.friendlyPower += 1;
      if (p.z < info.friendlyFrontZ) info.friendlyFrontZ = p.z;
      if (p.z < -246) {
        bastionCount++;
        const score = -p.z;
        if (score > bestBastionScore) {
          bestBastionScore = score;
          this.bastionBreachVec.copy(p);
          this.bastionBreachLane = lane;
        }
      }
    }

    // 2. Scan friendly AI ground armor
    for (const fv of allyVehicles) {
      if (!fv.alive || fv.disposed || fv.airborne) continue;
      const p = fv.position;
      const lane = laneForX(p.x);
      const info = this.laneIntel[lane];
      info.friendlyArmor++;
      info.friendlyPower += fv.kind === 'aegis' ? 4.5 : 2.5;
      if (p.z < -246) {
        bastionCount += fv.kind === 'aegis' ? 4 : 2;
        const score = (-p.z) + 120; // Tanks inside Iron Bastion walls are TOP PRIORITY targets!
        if (score > bestBastionScore) {
          bestBastionScore = score;
          this.bastionBreachVec.copy(p);
          this.bastionBreachLane = lane;
        }
      }
    }

    // 3. Scan player presence
    if (playerPos) {
      const pLane = laneForX(playerPos.x);
      const info = this.laneIntel[pLane];
      info.friendlyPower += 3.5;
      if (playerPos.z < info.friendlyFrontZ) info.friendlyFrontZ = playerPos.z;
      if (playerPos.z < -246) {
        bastionCount += 3;
        const score = (-playerPos.z) + 90;
        if (score > bestBastionScore) {
          bestBastionScore = score;
          this.bastionBreachVec.copy(playerPos);
          this.bastionBreachLane = pLane;
        }
      }
    }

    // 4. Scan enemy infantry
    for (const e of enemies) {
      if (!e.alive) continue;
      const p = e.position;
      const lane = laneForX(p.x);
      const info = this.laneIntel[lane];
      info.enemyInf++;
      info.enemyPower += e.maxHealth >= 400 ? 3.5 : 1;
      if (p.z > info.enemyDeepestZ) info.enemyDeepestZ = p.z;
      if (p.z > 240) {
        fobCount++;
        const score = p.z;
        if (score > bestFobScore) {
          bestFobScore = score;
          this.fobBreachVec.copy(p);
          this.fobBreachLane = lane;
        }
      }
    }

    // 5. Scan enemy ground armor
    for (const ev of enemyVehicles) {
      if (!ev.alive || ev.retired || ev.position.y >= 8) continue;
      const p = ev.position;
      const lane = laneForX(p.x);
      const info = this.laneIntel[lane];
      info.enemyArmor++;
      info.enemyPower += ev.def.kind === 'tank' ? 4.5 : 2.5;
      if (p.z > info.enemyDeepestZ) info.enemyDeepestZ = p.z;
      if (p.z > 240) {
        fobCount += ev.def.kind === 'tank' ? 4 : 2;
        const score = p.z + 120; // Enemy tanks inside FOB walls are TOP PRIORITY!
        if (score > bestFobScore) {
          bestFobScore = score;
          this.fobBreachVec.copy(p);
          this.fobBreachLane = lane;
        }
      }
    }

    this.fobIntruders = fobCount;
    this.hasFobBreach = fobCount > 0;
    if (!this.hasFobBreach) this.fobBreachLane = null;

    this.bastionIntruders = bastionCount;
    this.hasBastionBreach = bastionCount > 0;
    if (!this.hasBastionBreach) this.bastionBreachLane = null;

    // 6. Compute per-lane active frontline clash Z
    for (const l of LANES) {
      const info = this.laneIntel[l];
      const fz = clamp(info.friendlyFrontZ, -250, 240);
      const ez = clamp(info.enemyDeepestZ, -240, 255);
      info.contactZ = clamp((fz + ez) * 0.5, -230, 245);
    }

    // 7. Enemy Commander Strategic Decision (Main Effort + Reaction to Bastion Breach / Flank)
    this.enemyPlanTimer -= dt;
    if (this.hasBastionBreach && this.bastionBreachLane) {
      this.enemyPosture = 'defend_bastion';
      this.enemyMainLane = this.bastionBreachLane;
    } else {
      // Check for a deep friendly flanking breakthrough into Sector 3 (z < -125)
      let northThreat: WarLaneId | null = null;
      let northThreatScore = 0;
      for (const l of LANES) {
        const info = this.laneIntel[l];
        if (info.friendlyFrontZ < -125 && info.friendlyPower >= 4) {
          const s = info.friendlyPower + (-info.friendlyFrontZ - 125) * 0.05;
          if (s > northThreatScore) {
            northThreatScore = s;
            northThreat = l;
          }
        }
      }

      // Check if an enemy lane has broken past South Trenches toward FOB Vanguard
      let southExploit: WarLaneId | null = null;
      let southScore = 0;
      for (const l of LANES) {
        const info = this.laneIntel[l];
        if (info.enemyDeepestZ > 145 && info.enemyPower >= 5) {
          const s = info.enemyPower + info.enemyDeepestZ * 0.03;
          if (s > southScore) {
            southScore = s;
            southExploit = l;
          }
        }
      }

      if (southExploit) {
        this.enemyPosture = 'fob_assault';
        this.enemyMainLane = southExploit;
      } else if (northThreat) {
        this.enemyPosture = 'push';
        this.enemyMainLane = northThreat;
      } else {
        this.enemyPosture = 'push';
        if (this.enemyPlanTimer <= 0) {
          this.enemyPlanTimer = rand(48, 66);
          // Pick the lane with weakest friendly defense to execute a flanking breakthrough!
          let bestLane: WarLaneId = this.enemyMainLane;
          let lowestDefense = Infinity;
          for (const l of LANES) {
            const def = this.laneIntel[l].friendlyPower + (l === this.enemyMainLane ? 2.5 : 0);
            if (def < lowestDefense) {
              lowestDefense = def;
              bestLane = l;
            }
          }
          this.enemyMainLane = bestLane;
        }
      }
    }

    // 8. Allied Commander Strategic Decision (FOB Defense > Flank Intercept > Open Gate Exploit > Player-backed Main Effort)
    this.allyPlanTimer -= dt;
    if (this.hasFobBreach && this.fobBreachLane) {
      this.allyPosture = 'defend_fob';
      this.allyMainLane = this.fobBreachLane;
    } else {
      // Check if enemy crossed another bridge into our south rear (z > 115)
      let southDanger: WarLaneId | null = null;
      let southDangerScore = 0;
      for (const l of LANES) {
        const info = this.laneIntel[l];
        if (info.enemyDeepestZ > 115 && info.enemyPower >= 3.5) {
          const s = info.enemyPower + (info.enemyDeepestZ - 115) * 0.05;
          if (s > southDangerScore) {
            southDangerScore = s;
            southDanger = l;
          }
        }
      }

      const openGateLane = LANES.find(l => !bastion.isGateSealed(l)) ?? null;
      if (southDanger) {
        this.allyPosture = 'push';
        this.allyMainLane = southDanger;
      } else if (openGateLane) {
        this.allyPosture = 'bastion_assault';
        this.allyMainLane = openGateLane;
      } else {
        this.allyPosture = 'push';
        if (this.allyPlanTimer <= 0) {
          this.allyPlanTimer = rand(44, 60);
          // Back up the player's lane if the player is actively fighting outside FOB!
          if (playerPos && playerPos.z < 235) {
            this.allyMainLane = laneForX(playerPos.x);
          } else {
            // Otherwise reinforce the lane facing the heaviest enemy push
            let hotLane: WarLaneId = 'center';
            let maxEnemy = -1;
            for (const l of LANES) {
              if (this.laneIntel[l].enemyPower > maxEnemy) {
                maxEnemy = this.laneIntel[l].enemyPower;
                hotLane = l;
              }
            }
            this.allyMainLane = hotLane;
          }
        }
      }
    }

    return this.getSituation();
  }

  /**
   * Actively marches every tracked enemy infantry squad toward its tactical objective (never idle at spawn!)
   * and updates friendly infantry posts + friendly armor frontline hold boundaries (`holdNorthZ`).
   */
  issueOrders(
    dt: number,
    nowSec: number,
    allies: readonly Ally[],
    allyFleet: AiVehicleFleet,
    bastion: BastionDefenseSystem,
  ): void {
    // 1. Enemy Infantry Squad Orders (every 2.1 s)
    this.squadOrderTimer -= dt;
    if (this.squadOrderTimer <= 0) {
      this.squadOrderTimer = 2.1;
      this.directEnemySquads(nowSec);
    }

    // 2. Friendly Infantry & Armor Pacing Orders (every 1.4 s)
    this.allyOrderTimer -= dt;
    if (this.allyOrderTimer <= 0) {
      this.allyOrderTimer = 1.4;
      this.directFriendlyForces(allies, allyFleet, bastion);
    }

    // 3. Dynamic Enemy Attack Chopper Patrol Waypoints (every 2.6 s)
    this.chopperOrderTimer -= dt;
    if (this.chopperOrderTimer <= 0) {
      this.chopperOrderTimer = 2.6;
      this.updateChopperPatrolMarks();
    }
  }

  private directEnemySquads(nowSec: number): void {
    for (let i = this.trackedSquads.length - 1; i >= 0; i--) {
      const entry = this.trackedSquads[i]!;
      const sq = entry.squad;
      if (typeof sq.fighters === 'function' && sq.fighters() === 0) {
        this.trackedSquads.splice(i, 1);
        continue;
      }

      // Compute squad centroid from live members (safe with mock squads in unit tests)
      let cx = LANE_X[entry.lane];
      let cz = -240;
      let count = 0;
      if (Array.isArray(sq.members)) {
        let sx = 0;
        let sz = 0;
        for (const m of sq.members) {
          if (!m.fighting) continue;
          sx += m.e.position.x;
          sz += m.e.position.z;
          count++;
        }
        if (count > 0) {
          cx = sx / count;
          cz = sz / count;
        }
      }

      // Determine tactical destination for this squad:
      const goal = new THREE.Vector3();
      if (this.hasBastionBreach && (entry.role === 'qrf' || cz < -135)) {
        // Priority 1: Immediately converge on friendly tanks / player breaching Iron Bastion walls!
        goal.copy(this.bastionBreachVec);
      } else {
        // Priority 2: March actively south across the lane's bridge corridor toward Friendly FOB Vanguard!
        const lx = LANE_X[entry.lane];
        const info = this.laneIntel[entry.lane];
        // Step ~75 m south along the lane bridge axis so NavGraph pathfinding stays fast & reliable across the river!
        let nextZ: number;
        if (cz < -65) {
          nextZ = Math.min(-52, cz + 78);
        } else if (cz < 48) {
          // Funnel cleanly across the bridge deck (z = -56 -> +56)
          nextZ = 60;
        } else if (cz < 238) {
          // Fight through Crossroads & South Trenches toward FOB gate
          const contactTarget = info.friendlyInf > 0 ? Math.min(252, info.friendlyFrontZ + 12) : 254;
          nextZ = Math.min(contactTarget, cz + 80);
        } else {
          // Inside FOB Vanguard -> storm FOB Command Core directly!
          goal.set(ENDLESS_WAR_FOB_CORE[0] + rand(-12, 12), 0, ENDLESS_WAR_FOB_CORE[2] - 12);
          nextZ = goal.z;
        }
        if (cz < 238) {
          // Stay tightly aligned to bridge X while crossing the river gorge (z in [-75, +65])
          const jitterX = (cz > -80 && cz < 70) ? rand(-5, 5) : rand(-16, 16);
          goal.set(lx + jitterX, 0, nextZ);
        }
      }

      // Feed the tactical objective to OutpostSquad via adopt() so knownAt is ALWAYS fresh and squads never idle!
      const t = Math.max(nowSec, (typeof sq.knownAt === 'number' ? sq.knownAt : -1) + 0.05);
      sq.adopt?.(goal, t);
    }
  }

  private directFriendlyForces(
    allies: readonly Ally[],
    allyFleet: AiVehicleFleet,
    bastion: BastionDefenseSystem,
  ): void {
    // 1. Update friendly infantry posts: crush FOB breaches first, otherwise push with lane frontline
    let defendersAssigned = 0;
    for (const a of allies) {
      if (!a.alive || !a.detached) continue;
      const p = a.body.position;
      const lane = laneForX(p.x);
      const info = this.laneIntel[lane];

      if (this.hasFobBreach && (p.z > 90 || defendersAssigned < 8)) {
        defendersAssigned++;
        a.post.set(
          this.fobBreachVec.x + rand(-12, 12),
          0,
          clamp(this.fobBreachVec.z + rand(-10, 10), 215, 332),
        );
        continue;
      }

      const gateSealed = bastion.isGateSealed(lane);
      const minZ = gateSealed ? -232 : -308;
      // Push steadily past the lane contact point toward the enemy bridgehead / facilities!
      const desiredZ = clamp(info.contactZ - 24, minZ, 232);
      const laneX = LANE_X[lane];
      const jitterX = (desiredZ > -70 && desiredZ < 70) ? rand(-6, 6) : rand(-18, 18);
      a.post.set(laneX + jitterX, 0, desiredZ);
    }

    // 2. Pace friendly AI ground armor & redirect friendly Kestrels!
    for (const u of allyFleet.units) {
      if (!u.alive || u.disposed) continue;

      if (u.role === 'gunship') {
        // Kestrel CAS Gunship priority: 1) FOB Breach, 2) Enemy Main Effort / Armor clash
        if (this.hasFobBreach) {
          u.setOrbitCenter([this.fobBreachVec.x, 0, this.fobBreachVec.z], 75, 40);
        } else {
          const hot = this.laneIntel[this.allyMainLane];
          u.setOrbitCenter([hot.x, 0, clamp(hot.contactZ - 25, -220, 210)], 92, 44);
        }
        continue;
      }

      if (u.role !== 'ground') continue;
      u.combatHold = true;

      const lane = laneForX(u.position.x);
      const info = this.laneIntel[lane];
      const gateSealed = bastion.isGateSealed(lane);

      if (this.hasFobBreach && u.position.z > 130) {
        // Reserve/south armor turns to crush enemy tanks inside FOB Vanguard walls!
        u.holdNorthZ = null;
        if (!this.defendingFobIds.has(u.id)) {
          this.defendingFobIds.add(u.id);
          u.retargetRoute([
            [u.position.x, 0, Math.min(u.position.z, 252)],
            [this.fobBreachVec.x, 0, clamp(this.fobBreachVec.z - 16, 230, 315)],
          ]);
        }
        continue;
      }

      if (!this.hasFobBreach && this.defendingFobIds.has(u.id)) {
        this.defendingFobIds.delete(u.id);
        const pts = ENDLESS_WAR_FRIENDLY_LANES[lane].slice(1);
        const gatePlan = ENDLESS_WAR_BASTION_GATES.find(g => g.lane === lane);
        const gateIdx = pts.length >= 2 ? pts.length - 2 : 0;
        u.retargetRoute(
          pts.map(p => [p[0], 0, p[1]] as const),
          gatePlan ? { [gateIdx]: gatePlan.id } : undefined,
        );
      }

      // Pace armor with friendly infantry & never solo-rush past sealed Iron Bastion Blast Gates!
      const infantryLineZ = info.friendlyInf > 0 ? info.friendlyFrontZ : 90;
      const paceZ = clamp(infantryLineZ - 30, gateSealed ? -236 : -300, 190);
      u.holdNorthZ = gateSealed ? Math.max(-236, paceZ) : paceZ;
    }
  }

  private updateChopperPatrolMarks(): void {
    if (this.chopperMarkSets.length === 0) return;
    const focus = this.hasBastionBreach
      ? this.bastionBreachVec
      : new THREE.Vector3(
          LANE_X[this.enemyMainLane],
          0,
          this.enemyPosture === 'fob_assault' ? 275 : clamp(this.laneIntel[this.enemyMainLane].contactZ + 25, -180, 260),
        );

    for (const marks of this.chopperMarkSets) {
      if (marks.length === 0) continue;
      for (let i = 0; i < marks.length; i++) {
        const ang = (i / marks.length) * Math.PI * 2;
        const r = 46;
        marks[i]!.set(
          clamp(focus.x + Math.cos(ang) * r, -210, 210),
          28,
          clamp(focus.z + Math.sin(ang) * r, -305, 325),
        );
      }
    }
  }

  /**
   * Builds a smart route for newly spawned enemy vehicles:
   * - Troop Trucks stop right behind the active lane frontline (`contactZ - 22`) so `disembark()` unloads
   *   a full enemy infantry squad right into the battle!
   * - Tanks & Technicals respond to Iron Bastion intrusions first, then drive all the way to FOB Vanguard Core!
   */
  buildEnemyVehicleRoute(
    lane: WarLaneId,
    kind: 'humvee' | 'truck' | 'tank',
  ): { x: number; z: number; hold: number }[] {
    const basePts = ENDLESS_WAR_ENEMY_LANES[lane].slice(1);
    const info = this.laneIntel[lane];

    if (kind === 'truck') {
      // Stop right at the active frontline to disembark troops into combat!
      const dropZ = clamp(info.contactZ - 24, -180, 215);
      const pts: { x: number; z: number; hold: number }[] = [];
      for (const [x, z] of basePts) {
        if (z <= dropZ) pts.push({ x, z, hold: 0 });
      }
      pts.push({ x: LANE_X[lane] + rand(-10, 10), z: dropZ, hold: 0 });
      return pts;
    }

    const route: { x: number; z: number; hold: number }[] = [];
    // If friendly armor breached Iron Bastion on this lane, divert right onto the breach first!
    if (this.hasBastionBreach && this.bastionBreachLane === lane) {
      route.push({ x: this.bastionBreachVec.x, z: Math.min(-252, this.bastionBreachVec.z + 18), hold: 4 });
    }
    for (const [x, z] of basePts) {
      route.push({ x, z, hold: 0 });
    }
    // Final assault push straight toward FOB Vanguard Core!
    route.push({ x: ENDLESS_WAR_FOB_CORE[0] + rand(-22, 22), z: 312, hold: 0 });
    return route;
  }

  /**
   * Threat-prioritized ground strike target for enemy CAS jets (`Warthog`, `Harrier`, `Hornet`, `Raptor`):
   *   1. Friendly tanks / player inside Iron Bastion walls (`z < -246`)
   *   2. Friendly armor assaulting Sector 3 facilities (`z < -125`)
   *   3. Leading friendly armor near the bridges
   *   4. FOB Vanguard Core (`[0, 0, 336]`) during late threat or south assaults
   *   5. Player fallback
   */
  pickEnemyAirStrikeTarget(
    _jet: AiCombatJet,
    allyVehicles: readonly AiFriendlyVehicle[],
    playerPos: THREE.Vector3 | null,
    threatLevel: number,
  ): THREE.Vector3 | null {
    // Priority 1: Intruders inside Iron Bastion!
    if (this.hasBastionBreach) {
      return this.bastionBreachVec.clone();
    }

    // Priority 2: Friendly tanks pushing deep north (Sector 3 facilities) or crossing bridges
    let bestArmor: AiFriendlyVehicle | null = null;
    let bestZ = Infinity;
    for (const fv of allyVehicles) {
      if (!fv.alive || fv.disposed || fv.airborne) continue;
      if (fv.position.z < bestZ) {
        bestZ = fv.position.z;
        bestArmor = fv;
      }
    }
    if (bestArmor && bestArmor.position.z < 90) {
      return bestArmor.position.clone();
    }

    // Priority 3: Strike FOB Vanguard Core directly when Threat >= 5 or enemy forces are pushing Sector 1
    if (threatLevel >= 5 || this.enemyPosture === 'fob_assault') {
      return new THREE.Vector3(ENDLESS_WAR_FOB_CORE[0], 0, ENDLESS_WAR_FOB_CORE[2]);
    }

    // Priority 4: Player or frontline clash
    if (playerPos) return playerPos.clone();
    const hot = this.laneIntel[this.enemyMainLane];
    return new THREE.Vector3(hot.x, 0, hot.contactZ);
  }

  /**
   * `AllySystem.extraFoeProvider` implementation:
   *   - Enemy AT rocketeers lock onto friendly tanks/APCs within 88 m (prioritizing intruders inside Iron Bastion!)
   *   - Any enemy soldier breaching inside FOB Vanguard (`z > 235`, within 82 m of FOB Core) fires & RPGs FOB Core!
   *   - Any enemy soldier near a friendly tank inside Iron Bastion (`z < -238`) engages the intruding tank!
   */
  resolveExtraFoe(
    soldier: Soldier,
    allyVehicles: readonly AiFriendlyVehicle[],
    fob: FobDefenseSystem,
  ): Foe | null {
    const pos = soldier.e.position;
    const isAt = soldier.e.id === 'rocketeer';

    // 1. Breaching enemy infantry physically shoot & RPG Friendly FOB Vanguard Core!
    if (fob.alive && pos.z > 235) {
      const distFob = Math.hypot(pos.x - fob.position.x, pos.z - fob.position.z);
      if (distFob <= (isAt ? 92 : 76)) {
        return fob.asFoe();
      }
    }

    // 2. Enemy AT Rocketeers (always) and Bastion defenders (when armor is inside walls) target friendly vehicles!
    if (!isAt && pos.z > -235) return null;

    let best: AiFriendlyVehicle | null = null;
    let bestScore = isAt ? 92 : 58;
    for (const fv of allyVehicles) {
      if (!fv.alive || fv.disposed || fv.airborne) continue;
      const d = pos.distanceTo(fv.position);
      if (d > bestScore) continue;
      // Tanks inside Iron Bastion walls get 2x target priority!
      const score = fv.position.z < -246 ? d * 0.5 : d;
      if (score < bestScore) {
        bestScore = score;
        best = fv;
      }
    }

    return best ? best.asFoe() : null;
  }

  /** Human-readable compact tactical alert for the Endless War HUD. */
  getTacticalAlert(): { text: string; tone: 'danger' | 'warn' | 'ally' } | null {
    if (this.hasFobBreach) {
      return { text: `FOB VANGUARD BREACHED — ALL FORCES INTERCEPT ${this.fobBreachLane?.toUpperCase() ?? ''}!`, tone: 'danger' };
    }
    if (this.hasBastionBreach) {
      return { text: `IRON BASTION BREACHED (${this.bastionBreachLane?.toUpperCase() ?? ''}) — ENEMY QRF CONVERGING!`, tone: 'ally' };
    }
    if (this.enemyPosture === 'fob_assault') {
      return { text: `ENEMY MAIN OFFENSIVE BREAKING SOUTH ON ${this.enemyMainLane.toUpperCase()} LANE!`, tone: 'warn' };
    }
    return null;
  }

  private makeLaneIntel(lane: WarLaneId): LaneIntel {
    const crossing = ENDLESS_WAR_CROSSINGS.find(c => c.id === lane);
    return {
      lane,
      x: crossing ? crossing.x : LANE_X[lane],
      friendlyInf: 0,
      friendlyArmor: 0,
      enemyInf: 0,
      enemyArmor: 0,
      friendlyPower: 0,
      enemyPower: 0,
      friendlyFrontZ: 240,
      enemyDeepestZ: -240,
      contactZ: 0,
    };
  }
}
