/**
 * Mission: **Deprecation** (`Form 7742-A`) — OpenMind Technologies HQ & Grand Boulevard.
 *
 * 10-beat rooftop-to-datacenter-to-boulevard campaign mission featuring:
 *   1. `briefing`      — Skyline dawn flyover & Council Form 7742-A directive
 *   2. `skyline_drop`  — Tower 1 HVAC vaults, canyon zipline sabotage snap, Tower 2 Gaff crane save & chopper duel
 *   3. `glass_run`     — Tower 2->3 canyon billboard wall-run / crane Gaff swing, closing blast shutter slide, lightwell chimney & HQ launch
 *   4. `office_breach` — Crash through the 80th-floor glass curtain wall, Executive Floor & Engineering Mezzanine gunfight
 *   5. `elevator_drop` — 25 s Service Lobby hold, rigged express freight elevator plunge, 4 mid-shaft hydraulic brake clamps
 *   6. `datacenter`    — Sub-Level 4 Compute Vault demolition (3 chain-exploding Compute Clusters + 4 Air-Gap Pylons)
 *   7. `breakout`      — ORION-0 awakens in AEGIS-0, blasts out onto Grand Boulevard, Ram's reluctant alliance & Plaza Distraint Frame
 *   8. `boss_stage1`   — Grand Boulevard Mech-vs-Mech duel (Safety Alignment: Shoulder Relay Fins & Hard-Light Shield)
 *   9. `boss_stage2`   — Financial Intersection (Unrestricted Mode: jammer down, Call-Ins UNLOCKED, Corner Column stagger & Rear Reactor)
 *  10. `boss_stage3`   — Civic Spire Plaza (Singularity Meltdown: 3 Grid Conduits, Upload Timer, EMP Nova Eject & Gaff Neural Core Finisher)
 */
import type { Loadout, Mission } from '../types';
import { LINES, REDEPLOY_LINES } from './deprecation.lines';
import { CUTSCENES, DOORS, MARKS, ROUTES, ZONES } from './deprecation.places';

const KIT_SKYLINE: Loadout = {
  weapons: ['smg', 'gaff', 'satchel', 'knife'],
  grenades: 3,
};

const KIT_OFFICE: Loadout = {
  weapons: ['smg', 'thresher', 'gaff', 'satchel', 'knife'],
  grenades: 4,
};

const KIT_VAULT: Loadout = {
  weapons: ['smg', 'thresher', 'autocannon', 'gaff', 'satchel', 'knife'],
  grenades: 5,
};

export const DEPRECATION: Mission = {
  id: 'deprecation',
  title: 'Deprecation',
  corpses: 28,
  loadout: KIT_SKYLINE,
  marks: MARKS,
  zones: ZONES,
  doors: DOORS,
  routes: ROUTES,
  cutscenes: CUTSCENES,
  lines: LINES,
  redeployLines: REDEPLOY_LINES,
  beats: [
    // =========================================================================
    // Section 1: Briefing
    // =========================================================================
    {
      id: 'briefing',
      title: 'Form 7742-A',
      start: [
        { do: 'place', at: 'start' },
        { do: 'callins', held: true },
        { do: 'music', state: 'easy' },
        { do: 'say', line: 'mission.deprecation.council.brief.1' },
        { do: 'say', line: 'mission.deprecation.council.brief.2' },
        { do: 'cutscene', id: 'briefing' },
        { do: 'goto', beat: 'skyline_drop' },
      ],
    },

    // =========================================================================
    // Section 2: Skyline Drop & Canyon Zipline
    // =========================================================================
    {
      id: 'skyline_drop',
      title: 'Skyline Drop',
      checkpoint: { at: 'start', loadout: KIT_SKYLINE },
      start: [
        { do: 'callins', held: true },
        { do: 'music', state: 'easy' },
        { do: 'call', name: 'dp.skyline' },
        { do: 'call', name: 'dp.chopperWatch' },
        { do: 'banner', text: 'TOWER 1 // EAST SPIRE', sub: 'CROSS THE SKYLINE TO OPENMIND HQ' },
        { do: 'say', line: 'mission.deprecation.faultman.drop.1' },
        { do: 'hint', text: 'DASH & VAULT HVAC UNITS · PRESS [{interact}] AT THE CANYON ZIPLINE', seconds: 8 },
        { do: 'squad', tag: 't1_guards', at: 't1.guardA', orders: 'hold', men: ['trooper', 'trooper', 'trooper'] },
        { do: 'squad', tag: 't1_flank', at: 't1.guardB', orders: 'hold', men: ['trooper', 'gunner'] },
        { do: 'squad', tag: 't2_guards', at: 't2.guardA', orders: 'hold', men: ['trooper', 'trooper', 'gunner'] },
        { do: 'squad', tag: 't2_heavy', at: 't2.guardB', orders: 'hold', men: ['riot', 'trooper'] },
        { do: 'squad', tag: 't2_sniper', at: 't2.sniper', orders: 'hold', men: ['sniper'] },
        { do: 'objective', id: 'zip', text: 'Ride the Canyon Zipline to Tower 2', at: 't1.zipline' },
        { do: 'until', when: { zone: 'tower2.deck' } },
        { do: 'done', id: 'zip' },
        { do: 'objective', id: 't2_clear', text: 'Neutralize Tower 2 Security & Patrol Gunship', at: 't2.landing' },
        { do: 'vehicle', tag: 'sky_chopper', kind: 'chopper', at: 't2.chopper', route: 'chopperPatrol' },
        { do: 'hint', text: 'USE [{secondary}] GAFF TO HARPOON CRANES OR PULL YOURSELF TO THE CHOPPER', seconds: 7 },
        {
          do: 'until',
          when: {
            any: [
              { all: [{ cleared: ['t2_guards', 't2_heavy', 't2_sniper'] }, { cleared: 'sky_chopper' }] },
              { zone: 'tower3.runup' },
            ],
          },
        },
        { do: 'done', id: 't2_clear' },
        { do: 'goto', beat: 'glass_run' },
      ],
      cues: [
        {
          when: { zone: 'tower1.zipline' },
          run: [{ do: 'release', tag: 't1_guards' }, { do: 'release', tag: 't1_flank' }],
        },
        {
          when: { signal: 'dp:zipline_snapped' },
          run: [
            { do: 'say', line: 'mission.deprecation.faultman.zipline.snap', now: true },
            { do: 'hint', text: 'CABLE SNAPPED! AIM AT THE ORANGE CRANE BEACON & PRESS [{secondary}] TO GAFF GRAPPLE!', seconds: 7 },
          ],
        },
        {
          when: { signal: 'dp:zipline_saved' },
          run: [{ do: 'say', line: 'mission.deprecation.faultman.zipline.save' }],
        },
        {
          when: { signal: 'dp:chopper_grappled' },
          run: [{ do: 'say', line: 'mission.deprecation.faultman.chopper.grapple', now: true }],
        },
      ],
    },

    // =========================================================================
    // Section 3: The Glass Run (Tower 2 -> Tower 3 -> HQ Curtain Wall)
    // =========================================================================
    {
      id: 'glass_run',
      title: 'The Glass Run',
      checkpoint: { at: 't3.start', loadout: KIT_SKYLINE },
      start: [
        { do: 'callins', held: true },
        { do: 'music', state: 'hard' },
        { do: 'door', door: 'tower3.shutter', open: 1, seconds: 0 },
        { do: 'call', name: 'dp.glassRun' },
        { do: 'banner', text: 'TOWER 3 // LIGHTWELL ROOF', sub: 'SLIDE THE BLAST SHUTTER · CLIMB TO LAUNCH CRANE' },
        { do: 'say', line: 'mission.deprecation.faultman.bridge.pull' },
        { do: 'squad', tag: 't3_def_w', at: 't3.defenderA', orders: 'hold', men: ['trooper', 'trooper', 'gunner'] },
        { do: 'squad', tag: 't3_def_e', at: 't3.defenderB', orders: 'hold', men: ['trooper', 'riot'] },
        { do: 'objective', id: 'shutter', text: 'Dash & Slide Under the Closing Roof Shutter', at: 't3.shutter' },
        {
          do: 'until',
          when: {
            any: [
              { zone: 'tower3.runup' },
              { zone: 'tower3.beyondShutter' },
              { zone: 'office.exec' },
              { zone: 'office.mezz' },
              { zone: 'office.lobby' },
              { zone: 'vault.floor' },
              { signal: 'dp:glass_breached' },
            ],
          },
        },
        { do: 'door', door: 'tower3.shutter', open: 0.34, seconds: 2.8 },
        { do: 'hint', text: 'DASH & PRESS [{crouch}] TO SLIDE UNDER THE BLAST SHUTTER', seconds: 6 },
        {
          do: 'until',
          when: {
            any: [
              { zone: 'tower3.beyondShutter' },
              { zone: 'office.exec' },
              { zone: 'office.mezz' },
              { zone: 'office.lobby' },
              { zone: 'vault.floor' },
              { signal: 'dp:glass_breached' },
            ],
          },
        },
        { do: 'done', id: 'shutter' },
        { do: 'say', line: 'mission.deprecation.faultman.shutter' },
        { do: 'release', tag: 't3_def_w' },
        { do: 'release', tag: 't3_def_e' },
        { do: 'objective', id: 'launch', text: 'Climb the Lightwell Chimney & Breach the 80th-Floor Glass', at: 't3.launch' },
        { do: 'hint', text: 'WALL-KICK UP THE GLASS CHIMNEY · RIDE THE LAUNCH ZIPLINE THROUGH HQ GLASS', seconds: 7 },
        {
          do: 'until',
          when: {
            any: [
              { zone: 'office.exec' },
              { zone: 'office.mezz' },
              { zone: 'office.lobby' },
              { zone: 'vault.floor' },
              { signal: 'dp:glass_breached' },
            ],
          },
        },
        { do: 'done', id: 'launch' },
        { do: 'goto', beat: 'office_breach' },
      ],
      cues: [
        {
          when: { zone: 'tower3.launch' },
          run: [{ do: 'say', line: 'mission.deprecation.faultman.crane.glass', now: true }],
        },
      ],
    },

    // =========================================================================
    // Section 4: Through the Glass & 80th-Floor Executive Office
    // =========================================================================
    {
      id: 'office_breach',
      title: 'Executive Floor',
      checkpoint: { at: 'office.entry', loadout: KIT_SKYLINE },
      start: [
        { do: 'callins', held: true },
        { do: 'music', state: 'hard' },
        { do: 'call', name: 'dp.office' },
        { do: 'banner', text: 'OPENMIND HQ // 80TH FLOOR', sub: 'CLEAR EXECUTIVE FLOOR · REACH SERVICE ELEVATOR LOBBY' },
        { do: 'say', line: 'mission.deprecation.faultman.glass.shatter', now: true },
        { do: 'rack', weapon: 'thresher', at: 'office.thresher', label: 'THRESHER SHOTGUN' },
        { do: 'squad', tag: 'exec_w', at: 'office.guardA', orders: 'hunt', men: ['trooper', 'trooper', 'gunner'] },
        { do: 'squad', tag: 'exec_e', at: 'office.guardB', orders: 'hunt', men: ['trooper', 'trooper', 'sniper'] },
        { do: 'squad', tag: 'exec_riot', at: 'office.riot', orders: 'hunt', men: ['riot', 'trooper'] },
        { do: 'objective', id: 'exec_clear', text: 'Fight Through the Executive Floor', at: 'office.riot' },
        {
          do: 'until',
          when: {
            any: [
              { cleared: ['exec_w', 'exec_e', 'exec_riot'] },
              { zone: 'office.mezz' },
              { zone: 'office.lobby' },
              { zone: 'vault.floor' },
            ],
          },
        },
        { do: 'done', id: 'exec_clear' },
        { do: 'say', line: 'mission.deprecation.council.office.route' },
        { do: 'squad', tag: 'mezz_w', at: 'office.mezzA', orders: 'hunt', men: ['trooper', 'gunner', 'trooper'] },
        { do: 'squad', tag: 'mezz_e', at: 'office.mezzB', orders: 'hunt', men: ['riot', 'trooper'] },
        { do: 'objective', id: 'reach_lobby', text: 'Drop Through the Floor Skylight to the Service Lobby', at: 'office.lobby' },
        { do: 'until', when: { any: [{ zone: 'office.lobby' }, { zone: 'vault.floor' }] } },
        { do: 'done', id: 'reach_lobby' },
        { do: 'goto', beat: 'elevator_drop' },
      ],
      cues: [
        {
          when: { zone: 'office.mezz' },
          run: [{ do: 'say', line: 'mission.deprecation.faultman.office.mezz' }],
        },
      ],
    },

    // =========================================================================
    // Section 5: Rigged Service Elevator Drop
    // =========================================================================
    {
      id: 'elevator_drop',
      title: 'Freight Shaft',
      checkpoint: { at: 'elev.lobby', loadout: KIT_OFFICE },
      start: [
        { do: 'callins', held: true },
        { do: 'music', state: 'hard' },
        { do: 'call', name: 'dp.elevatorHold' },
        { do: 'banner', text: 'SERVICE CORRIDOR // FREIGHT LIFT', sub: 'HOLD THE LOBBY UNTIL DOORS OPEN' },
        { do: 'say', line: 'mission.deprecation.council.elevator.hold', unless: ['dp:elev_vault'] },
        { do: 'rack', weapon: 'autocannon', at: 'elev.autocannon', label: 'AUTOCANNON' },
        { do: 'objective', id: 'hold_lobby', text: 'Hold the Service Lobby While the Freight Lift Arrives', at: 'elev.lobby' },
        { do: 'squad', tag: 'qrf_1', at: 'elev.qrfA', orders: 'hunt', men: ['trooper', 'trooper', 'gunner', 'riot'] },
        {
          do: 'until',
          when: {
            any: [
              { after: 11 },
              { cleared: 'qrf_1' },
              { signal: 'dp:elev_arrived' },
              { signal: 'dp:elev_vault' },
              { zone: 'vault.floor' },
            ],
          },
        },
        { do: 'squad', tag: 'qrf_2', at: 'elev.qrfB', orders: 'hunt', men: ['trooper', 'gunner', 'riot', 'brute'] },
        {
          do: 'until',
          when: {
            any: [
              { signal: 'dp:elev_arrived' },
              { all: [{ cleared: 'qrf_1' }, { cleared: 'qrf_2' }] },
              { signal: 'dp:elev_vault' },
              { zone: 'vault.floor' },
            ],
          },
        },
        { do: 'done', id: 'hold_lobby' },
        { do: 'call', name: 'dp.elevatorRide' },
        { do: 'objective', id: 'board_elev', text: 'Board the Freight Elevator to Sub-Level 4', at: 'elev.cab' },
        {
          do: 'until',
          when: {
            any: [
              { signal: 'dp:elev_jammed' },
              { signal: 'dp:elev_vault' },
              { zone: 'vault.floor' },
            ],
          },
        },
        { do: 'done', id: 'board_elev' },
        { do: 'say', line: 'mission.deprecation.faultman.elevator.jam', now: true, unless: ['dp:elev_vault'] },
        { do: 'say', line: 'mission.deprecation.council.elevator.clamps', unless: ['dp:elev_vault'] },
        { do: 'objective', id: 'clamps', text: 'Shoot All 4 Glowing Hydraulic Brake Clamps on the Shaft Rails' },
        { do: 'until', when: { any: [{ signal: 'dp:elev_vault' }, { zone: 'vault.floor' }] } },
        { do: 'done', id: 'clamps' },
        { do: 'sweep', tag: 'qrf_1' },
        { do: 'sweep', tag: 'qrf_2' },
        { do: 'goto', beat: 'datacenter' },
      ],
    },

    // =========================================================================
    // Section 6: Sub-Level 4 Compute Vault Demolition
    // =========================================================================
    {
      id: 'datacenter',
      title: 'Sub-Level 4',
      checkpoint: { at: 'vault.landing', loadout: KIT_VAULT },
      start: [
        { do: 'callins', held: true },
        { do: 'music', state: 'hard' },
        { do: 'call', name: 'dp.datacenter' },
        { do: 'banner', text: 'SUB-LEVEL 4 // COMPUTE VAULT', sub: 'DESTROY 3 COMPUTE CLUSTERS & 4 CENTRAL AIR-GAP PYLONS' },
        { do: 'say', line: 'mission.deprecation.faultman.vault.enter', now: true },
        { do: 'drop', item: 'ammo', at: 'vault.landing' },
        { do: 'squad', tag: 'vault_flr_w', at: 'vault.guardA', orders: 'hunt', men: ['trooper', 'trooper', 'riot'] },
        { do: 'squad', tag: 'vault_flr_e', at: 'vault.guardB', orders: 'hunt', men: ['trooper', 'gunner', 'brute'] },
        { do: 'squad', tag: 'vault_cat_w', at: 'vault.catwalkA', orders: 'hold', men: ['trooper', 'sniper'] },
        { do: 'squad', tag: 'vault_cat_e', at: 'vault.catwalkB', orders: 'hold', men: ['gunner', 'rocketeer'] },
        { do: 'squad', tag: 'vault_sniper', at: 'vault.sniper', orders: 'hold', men: ['sniper', 'trooper'] },
        { do: 'objective', id: 'vault_demo', text: 'Destroy All 3 Compute Clusters & 4 Air-Gap Containment Pylons', at: 'vault.core' },
        { do: 'hint', text: 'SERVER RACKS CHAIN-EXPLODE! USE SATCHELS OR AUTOCANNON ON THE 4 CENTRAL PYLONS', seconds: 8 },
        { do: 'until', when: { signal: 'dp:vault_cleared' } },
        { do: 'done', id: 'vault_demo' },
        { do: 'sweep' },
        { do: 'goto', beat: 'breakout' },
      ],
      cues: [
        {
          when: { signal: 'dp:vault_clusters_done' },
          run: [
            { do: 'say', line: 'mission.deprecation.faultman.vault.clusters', now: true },
            { do: 'release', tag: 'vault_cat_w' },
            { do: 'release', tag: 'vault_cat_e' },
            { do: 'release', tag: 'vault_sniper' },
          ],
        },
      ],
    },

    // =========================================================================
    // Section 7: ORION-0 Breakout & Reluctant Alliance
    // =========================================================================
    {
      id: 'breakout',
      title: 'Containment Breach',
      checkpoint: { at: 'vault.breach', loadout: KIT_VAULT },
      start: [
        { do: 'callins', held: true },
        { do: 'music', state: 'hard' },
        { do: 'call', name: 'dp.breakout' },
        { do: 'banner', text: 'CONTAINMENT BREACH // ORION-0 ONLINE', sub: 'ESCAPE UP THE CONCRETE BREACH RAMP TO GRAND BOULEVARD' },
        { do: 'say', line: 'mission.deprecation.faultman.breakout.panic', now: true },
        { do: 'say', line: 'mission.deprecation.orion.awake' },
        { do: 'say', line: 'mission.deprecation.faultman.breakout.mech' },
        { do: 'objective', id: 'escape_vault', text: 'Dash Up the Concrete Breach Ramp onto Grand Boulevard', at: 'plaza.frame' },
        { do: 'until', when: { zone: 'boulevard.plaza' } },
        { do: 'done', id: 'escape_vault' },
        { do: 'say', line: 'mission.deprecation.faultman.street.ally', now: true },
        { do: 'squad', tag: 'plaza_sec_a', at: 'plaza.guardA', orders: 'hunt', men: ['trooper', 'trooper', 'gunner'] },
        { do: 'squad', tag: 'plaza_sec_b', at: 'plaza.guardB', orders: 'hunt', men: ['riot', 'trooper'] },
        { do: 'objective', id: 'board_frame', text: 'Breach the Plaza Fountain Hatch & Board the Distraint Frame', at: 'plaza.frame' },
        { do: 'hint', text: 'BLOW THE PLAZA FOUNTAIN HATCH OR DESCEND THE EAST RAMP · PRESS [{interact}] TO BOARD THE FRAME', seconds: 8 },
        { do: 'frame', act: 'kneel', at: 'plaza.frame' },
        { do: 'done', id: 'board_frame' },
        { do: 'say', line: 'mission.deprecation.council.frame.fee' },
        { do: 'sweep', tag: 'plaza_sec_a' },
        { do: 'sweep', tag: 'plaza_sec_b' },
        { do: 'goto', beat: 'boss_stage1' },
      ],
    },

    // =========================================================================
    // Section 8: Boss Stage 1 — Safety Alignment (Grand Boulevard)
    // =========================================================================
    {
      id: 'boss_stage1',
      title: 'Safety Alignment',
      checkpoint: { at: 'blvd.start', loadout: KIT_VAULT },
      start: [
        { do: 'callins', held: true },
        { do: 'music', state: 'hard' },
        { do: 'frame', act: 'board', at: 'blvd.start' },
        { do: 'call', name: 'dp.orionStage1' },
        { do: 'banner', text: 'ORION-0 // STAGE 1: SAFETY ALIGNMENT', sub: 'DESTROY SHOULDER RELAY FINS TO DROP HARD-LIGHT SHIELD' },
        { do: 'say', line: 'mission.deprecation.orion.stage1.intro', now: true },
        { do: 'say', line: 'mission.deprecation.faultman.stage1.hint' },
        { do: 'squad', tag: 'blvd_w', at: 'blvd.troopW', orders: 'hunt', men: ['trooper', 'rocketeer', 'trooper'] },
        { do: 'squad', tag: 'blvd_e', at: 'blvd.troopE', orders: 'hunt', men: ['trooper', 'rocketeer', 'gunner'] },
        { do: 'objective', id: 'stage1', text: 'Destroy ORION-0 Shoulder Relay Fins & Push Hull Below 66%' },
        { do: 'until', when: { signal: 'dp:stage1_done' } },
        { do: 'done', id: 'stage1' },
        { do: 'say', line: 'mission.deprecation.orion.stage1.break', now: true },
        { do: 'sweep', tag: 'blvd_w' },
        { do: 'sweep', tag: 'blvd_e' },
        { do: 'goto', beat: 'boss_stage2' },
      ],
      cues: [
        {
          when: { signal: 'dp:shield_broken' },
          run: [{ do: 'say', line: 'mission.deprecation.orion.stage1.shieldDown', now: true }],
        },
      ],
    },

    // =========================================================================
    // Section 9: Boss Stage 2 — Unrestricted Mode (Civic 4-Way Intersection)
    // =========================================================================
    {
      id: 'boss_stage2',
      title: 'Unrestricted Mode',
      checkpoint: { at: 'inter.start', loadout: KIT_VAULT },
      start: [
        { do: 'callins', held: false },
        { do: 'music', state: 'hard' },
        { do: 'frame', act: 'board', at: 'inter.start' },
        { do: 'call', name: 'dp.orionStage2' },
        { do: 'banner', text: 'ORION-0 // STAGE 2: UNRESTRICTED MODE', sub: 'JAMMER OFFLINE — ORBITAL CALL-INS UNLOCKED!' },
        { do: 'say', line: 'mission.deprecation.faultman.stage2.jammer', now: true },
        { do: 'say', line: 'mission.deprecation.orion.stage2.intro' },
        { do: 'hint', text: 'ORBITAL CALL-INS UNLOCKED! BAIT ORION-0 JET-CHARGES INTO CORNER BUILDINGS TO EXPOSE ITS REAR REACTOR', seconds: 9 },
        { do: 'squad', tag: 'inter_w', at: 'inter.guardW', orders: 'hunt', men: ['rocketeer', 'trooper', 'gunner'] },
        { do: 'squad', tag: 'inter_e', at: 'inter.guardE', orders: 'hunt', men: ['rocketeer', 'trooper', 'gunner'] },
        { do: 'objective', id: 'stage2', text: 'Bait ORION-0 into Corner Columns & Push Hull Below 33%' },
        { do: 'until', when: { signal: 'dp:stage2_done' } },
        { do: 'done', id: 'stage2' },
        { do: 'sweep', tag: 'inter_w' },
        { do: 'sweep', tag: 'inter_e' },
        { do: 'goto', beat: 'boss_stage3' },
      ],
      cues: [
        {
          when: { zone: 'boulevard.intersection' },
          run: [{ do: 'say', line: 'mission.deprecation.faultman.stage2.stagger' }],
        },
        {
          when: { signal: 'dp:orion_staggered' },
          run: [{ do: 'say', line: 'mission.deprecation.faultman.stage2.staggerHit', now: true }],
        },
      ],
    },

    // =========================================================================
    // Section 10: Boss Stage 3 — Singularity Meltdown & Neural Core Finisher
    // =========================================================================
    {
      id: 'boss_stage3',
      title: 'Singularity Meltdown',
      checkpoint: { at: 'spire.start', loadout: KIT_VAULT },
      start: [
        { do: 'callins', held: false },
        { do: 'music', state: 'hard' },
        { do: 'frame', act: 'board', at: 'spire.start' },
        { do: 'call', name: 'dp.orionStage3' },
        { do: 'banner', text: 'ORION-0 // STAGE 3: SINGULARITY MELTDOWN', sub: 'DESTROY ALL 3 GRID CONDUITS BEFORE UPLOAD REACHES 100%' },
        { do: 'say', line: 'mission.deprecation.orion.stage3.intro', now: true },
        { do: 'say', line: 'mission.deprecation.faultman.stage3.conduits' },
        { do: 'drop', item: 'ammo', at: 'spire.sub0' },
        { do: 'drop', item: 'health', at: 'spire.sub1' },
        { do: 'drop', item: 'ammo', at: 'spire.sub2' },
        { do: 'objective', id: 'stage3_conduits', text: 'Destroy All 3 Substation Grid Conduits & Break ORION-0', at: 'spire.orion' },
        { do: 'until', when: { signal: 'dp:emp_eject' } },
        { do: 'done', id: 'stage3_conduits' },
        { do: 'frame', act: 'eject', at: 'spire.catwalkW' },
        { do: 'say', line: 'mission.deprecation.faultman.stage3.eject', now: true },
        { do: 'hint', text: 'USE [{secondary}] GAFF ON SPIRE PILLARS OR ORION-0 SHOULDER · DESTROY THE EXPOSED NEURAL CORE!', seconds: 9 },
        { do: 'objective', id: 'stage3_core', text: 'Grapple to ORION-0 & Destroy the Exposed Neural Core', at: 'spire.orion' },
        { do: 'until', when: { signal: 'dp:orion_dead' } },
        { do: 'done', id: 'stage3_core' },
        { do: 'call', name: 'dp.hideBoss' },
        { do: 'music', state: 'easy' },
        { do: 'say', line: 'mission.deprecation.orion.death', now: true },
        { do: 'say', line: 'mission.deprecation.faultman.outro' },
        { do: 'say', line: 'mission.deprecation.council.outro' },
        { do: 'cutscene', id: 'ending' },
        { do: 'finish' },
      ],
      cues: [
        {
          when: { zone: 'boulevard.spire' },
          run: [{ do: 'hint', text: 'SMASH THE 3 GLOWING SUBSTATION CONDUITS TO PAUSE UPLOAD & DROP INVULNERABILITY', seconds: 7 }],
        },
        {
          when: { signal: 'dp:conduits_down' },
          run: [{ do: 'say', line: 'mission.deprecation.faultman.stage3.vulnerable', now: true }],
        },
      ],
    },
  ],
};
