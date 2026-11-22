/**
 * Campaign Mission 4 — "Bank Run" (`Form 7742-B`), Day 2, 09:15.
 *
 * Four-act Payday-style bank heist + on-rails Coastal Expressway `.50 cal` chase:
 *   1. opening   — Sunlit coastal flyover over Brine Central Reserve + Packmule 2-3 fast-rope onto the roof
 *   2. rooftop   — Clear rooftop security detail, blow the central Tier-1 Atrium Skylight Dome, drop into the Banking Hall
 *   3. drill     — Push to the Planetary Bullion Vault, plant Bureau Thermal Lance Drill, survive multi-vector SWAT waves,
 *                  FastRopeHeli drops through your roof hole, 2 thermal jams & SWAT Tech Saboteurs until the 20-ton door swings open
 *   4. plunder   — Bag 4 mandatory gold bullion duffels (+3 optional bonus pallets), heave them down the stairs & through the
 *                  shattered lobby into the waiting armored Bailiff Humvee on the front steps, then mount the roof `.50 cal`
 *   5. highway   — Barricade smash onto the Coastal Elevated Expressway: shred Police Interceptors (locational tires/engine/driver),
 *                  SWAT BearCat vans + explosive Fuel Tankers, and down Governor Sterling's Pursuit Gunship Boss (`AUDITOR-1`)
 */
import type { Loadout, Mission, Step } from '../types';
import { LINES, REDEPLOY_LINES } from './bankRun.lines';
import { CUTSCENES, DOORS, MARKS, ROUTES, ZONES } from './bankRun.places';

const say = (key: string, opts: { wait?: boolean; now?: boolean; again?: boolean; within?: number } = {}): Step => ({
  do: 'say',
  line: `mission.bank_run.${key}`,
  ...opts,
});

const HEIST_LOADOUT: Loadout = {
  weapons: ['smg', 'ultramag', 'satchel', 'knife'],
  grenades: 4,
};

export const BANK_RUN: Mission = {
  id: 'bank_run',
  title: 'Bank Run',
  corpses: 28,
  loadout: HEIST_LOADOUT,
  redeployLines: REDEPLOY_LINES,
  lines: LINES,
  marks: MARKS,
  zones: ZONES,
  doors: DOORS,
  routes: ROUTES,
  cutscenes: CUTSCENES,

  beats: [
    // -------------------------------------------------------------------------------------------
    // Act 1A: Opening Flyover & First-Person Fast-Rope Insertion
    // -------------------------------------------------------------------------------------------
    {
      id: 'opening',
      title: 'Approach',
      start: [
        { do: 'callins', held: true },
        { do: 'music', state: 'menu' },
        { do: 'door', door: 'roof.stair', open: 1, seconds: 0 },
        { do: 'door', door: 'lobby.portico', open: 1, seconds: 0 },
        { do: 'door', door: 'vault.west', open: 0, seconds: 0 },
        { do: 'door', door: 'vault.east', open: 0, seconds: 0 },
        say('council.intro.1'),
        say('council.intro.2'),
        { do: 'cutscene', id: 'opening' },
        { do: 'music', state: 'easy' },
        say('radio.fastrope', { now: true }),
        { do: 'call', name: 'bk.fastRope' },
        { do: 'until', when: { signal: 'bk:fastrope_done' } },
        { do: 'goto', beat: 'rooftop' },
      ],
    },

    // -------------------------------------------------------------------------------------------
    // Act 1B: Rooftop Fight & Atrium Skylight Breach
    // -------------------------------------------------------------------------------------------
    {
      id: 'rooftop',
      title: 'Rooftop Breach',
      checkpoint: { at: 'helipad', loadout: HEIST_LOADOUT },
      start: [
        { do: 'callins', held: true },
        { do: 'threat', level: 4, grade: 'regular' },
        { do: 'music', state: 'easy' },
        { do: 'banner', text: 'BANK RUN', sub: 'BRINE CENTRAL RESERVE // 09:15' },
        { do: 'door', door: 'roof.stair', open: 0, seconds: 1.4 },
        { do: 'door', door: 'lobby.portico', open: 1, seconds: 0 },
        { do: 'call', name: 'bk.skylightWatch' },
        { do: 'squad', tag: 'roof_north', men: ['trooper', 'trooper', 'sniper'], at: 'roofNorth', ensure: true },
        { do: 'squad', tag: 'roof_flank', men: ['trooper', 'gunner'], at: 'roofWest', ensure: true },
        { do: 'squad', tag: 'hall_guards', men: ['trooper', 'trooper', 'gunner'], at: 'hallCenter', orders: 'hold', ensure: true },
        { do: 'drop', item: 'ammo', at: 'roofSatchel' },
        say('governor.roof.lock'),
        { do: 'objective', id: 'clear_roof', text: 'Clear rooftop security', at: 'roofNorth' },
        { do: 'until', when: { cleared: ['roof_north', 'roof_flank'] } },
        { do: 'done', id: 'clear_roof' },
        say('council.skylight'),
        { do: 'hint', text: 'Select Satchel Charges [3] or hold {interact} on the central skylight dome to breach into the bank.', seconds: 8 },
        { do: 'objective', id: 'breach_skylight', text: 'Blow the Atrium Skylight Dome', at: 'skylight' },
        { do: 'until', when: { signal: 'bk:skylight_blown' } },
        { do: 'done', id: 'breach_skylight' },
        say('governor.skylight.blown', { now: true }),
        { do: 'objective', id: 'drop_hall', text: 'Drop into the Grand Banking Hall', at: 'hallCenter' },
        { do: 'until', when: { any: [{ zone: 'bankingHall' }, { zone: 'antechamber' }] } },
        { do: 'done', id: 'drop_hall' },
        { do: 'goto', beat: 'drill' },
      ],
    },

    // -------------------------------------------------------------------------------------------
    // Act 2: Payday-Style Vault Drill Defense
    // -------------------------------------------------------------------------------------------
    {
      id: 'drill',
      title: 'The Vault Drill',
      checkpoint: { at: 'hallDrop', loadout: HEIST_LOADOUT },
      start: [
        { do: 'callins', held: true },
        { do: 'threat', level: 5, grade: 'veteran' },
        { do: 'music', state: 'hard' },
        { do: 'door', door: 'roof.stair', open: 0, seconds: 0 },
        { do: 'call', name: 'bk.ensureSkylightOpen' },
        { do: 'call', name: 'bk.drillArm' },
        { do: 'rack', weapon: 'sabot', at: 'sabotRack', optional: true, label: 'SABOT AP RIFLE' },
        { do: 'rack', weapon: 'mgl', at: 'mglRack', optional: true, label: 'MGL GRENADE LAUNCHER' },
        { do: 'drop', item: 'health', at: 'mezzWest' },
        { do: 'drop', item: 'ammo', at: 'antechamber' },
        { do: 'squad', tag: 'lobby_detail', men: ['trooper', 'trooper', 'riot'], at: 'antechamber', ensure: true },
        say('council.drill.order'),
        { do: 'objective', id: 'plant_drill', text: 'Plant Bureau Thermal Drill on the Vault Door', at: 'drillPoint' },
        { do: 'hint', text: 'Press {interact} at the Planetary Vault Door to mount the Bureau Thermal Drill. Optional Sabot & MGL racks are nearby.', seconds: 7 },
        { do: 'until', when: { signal: 'bk:drill_planted' } },
        { do: 'done', id: 'plant_drill' },

        // Sterling drops the lobby shutters and floods the bank with SWAT
        { do: 'door', door: 'lobby.portico', open: 0, seconds: 1.8 },
        { do: 'door', door: 'vault.west', open: 1, seconds: 1.2 },
        { do: 'door', door: 'vault.east', open: 1, seconds: 1.2 },
        say('governor.drill.planted', { now: true }),
        { do: 'objective', id: 'defend_drill', text: 'Defend the Thermal Drill (0% -> 100%)', at: 'drillPoint' },
        { do: 'squad', tag: 'swat_w1_a', men: ['trooper', 'trooper', 'gunner', 'riot'], at: 'hallSouth' },
        { do: 'squad', tag: 'swat_w1_sniper', men: ['sniper', 'trooper'], at: 'mezzEast' },

        { do: 'until', when: { signal: 'bk:drill_done' } },
        { do: 'done', id: 'defend_drill' },
        { do: 'sweep', tag: 'swat_saboteur' },
        say('governor.vault.open', { now: true }),
        { do: 'wait', seconds: 2.2 },
        { do: 'goto', beat: 'plunder' },
      ],
      cues: [
        {
          when: { signal: 'bk:drill_25' },
          run: [
            say('council.drill.25'),
            { do: 'call', name: 'bk.skylightDrop' },
            { do: 'squad', tag: 'swat_w2_flank', men: ['trooper', 'gunner', 'riot'], at: 'vaultWestSpawn' },
          ],
        },
        {
          when: { signal: 'bk:drill_jam1' },
          run: [
            say('governor.drill.jam1', { now: true }),
            { do: 'hint', text: 'Thermal drill stalled! Hold {interact} on the drill to reboot it and stop SWAT Tech Saboteurs!', seconds: 6 },
            { do: 'call', name: 'bk.sendSaboteur', arg: 'vaultEastSpawn' },
          ],
        },
        {
          when: { signal: 'bk:drill_50' },
          run: [
            say('council.drill.50'),
            say('governor.goggles.reveal'),
            { do: 'squad', tag: 'swat_w3_heavy', men: ['brute', 'trooper', 'gunner'], at: 'hallSouth' },
            { do: 'squad', tag: 'swat_w3_mezz', men: ['sniper', 'trooper'], at: 'mezzWest' },
            { do: 'drop', item: 'health', at: 'antechamber' },
            { do: 'drop', item: 'ammo', at: 'antechamber' },
          ],
        },
        {
          when: { signal: 'bk:drill_jam2' },
          run: [
            say('governor.drill.jam2', { now: true }),
            { do: 'call', name: 'bk.sendSaboteur', arg: 'vaultWestSpawn' },
            { do: 'call', name: 'bk.skylightDrop' },
          ],
        },
        {
          when: { signal: 'bk:drill_75' },
          run: [
            say('council.drill.75'),
            { do: 'squad', tag: 'swat_w4_final', men: ['brute', 'riot', 'gunner', 'trooper'], at: 'vaultEastSpawn' },
            { do: 'call', name: 'bk.sendSaboteur', arg: 'hallCenter' },
          ],
        },
        {
          when: { signal: 'bk:saboteur_c4' },
          run: [
            say('governor.saboteur', { within: 4 }),
            { do: 'hint', text: 'DEMOLITION CHARGE ON THE DRILL! Hold {interact} at the drill immediately to defuse!', seconds: 5 },
          ],
        },
      ],
    },

    // -------------------------------------------------------------------------------------------
    // Act 3: Bullion Plunder & Bag-Heaving Fighting Withdrawal
    // -------------------------------------------------------------------------------------------
    {
      id: 'plunder',
      title: 'Bullion Withdrawal',
      checkpoint: { at: 'vaultInside', loadout: HEIST_LOADOUT },
      start: [
        { do: 'callins', held: true },
        { do: 'threat', level: 6, grade: 'veteran' },
        { do: 'music', state: 'hard' },
        { do: 'door', door: 'lobby.portico', open: 1, seconds: 1.4 },
        { do: 'call', name: 'bk.ensureSkylightOpen' },
        { do: 'call', name: 'bk.vaultForceOpen' },
        { do: 'call', name: 'bk.plunderStart' },
        { do: 'drop', item: 'health', at: 'hallCenter' },
        { do: 'drop', item: 'ammo', at: 'hallSouth' },
        say('council.plunder.start'),
        say('radio.humvee.arrived'),
        { do: 'objective', id: 'load_bags', text: 'Load 4 Gold Bullion Bags into the Getaway Humvee', at: 'humveeBed' },
        { do: 'hint', text: 'Hold {interact} on gold pallets to bag bullion. Press [G] while carrying to heave bags forward!', seconds: 8 },
        { do: 'squad', tag: 'plaza_swat_1', men: ['trooper', 'trooper', 'riot', 'gunner'], at: 'plazaWest', ensure: true },
        { do: 'squad', tag: 'plaza_swat_2', men: ['trooper', 'gunner', 'sniper'], at: 'plazaEast', ensure: true },

        { do: 'until', when: { signal: 'bk:bags_quota' } },
        { do: 'done', id: 'load_bags' },
        say('council.bags.quota'),
        { do: 'objective', id: 'mount_humvee', text: 'Mount the Humvee .50 Cal Roof Turret', at: 'humveeTurret' },
        { do: 'hint', text: 'Quota met! Press {interact} at the Getaway Humvee to mount the M2 .50 cal turret and break out — or load extra bonus pallets!', seconds: 7 },
        { do: 'until', when: { signal: 'bk:mount_turret' } },
        { do: 'done', id: 'mount_humvee' },
        { do: 'sweep' },
        { do: 'goto', beat: 'highway' },
      ],
      cues: [
        {
          when: { signal: 'bk:bag_packed' },
          run: [
            say('governor.breakout'),
            { do: 'squad', tag: 'lobby_intercept', men: ['trooper', 'gunner', 'riot'], at: 'hallSouth' },
          ],
        },
        {
          when: { cleared: ['plaza_swat_1', 'plaza_swat_2'] },
          run: [
            { do: 'squad', tag: 'plaza_reinforce', men: ['trooper', 'gunner', 'brute'], at: 'plazaCenter' },
          ],
        },
      ],
    },

    // -------------------------------------------------------------------------------------------
    // Act 4: On-Rails Coastal Expressway .50 Cal Chase & AUDITOR-1 Pursuit Gunship Boss
    // -------------------------------------------------------------------------------------------
    {
      id: 'highway',
      title: 'Coastal Expressway',
      checkpoint: { at: 'highwayStart', loadout: HEIST_LOADOUT },
      start: [
        { do: 'callins', held: true },
        { do: 'sweep' },
        { do: 'music', state: 'hard' },
        { do: 'banner', text: 'HIGHWAY BREAKOUT', sub: 'COASTAL ELEVATED EXPRESSWAY // M2 .50 CAL' },
        { do: 'call', name: 'bk.highwayStart' },
        say('radio.highway.start', { now: true }),
        { do: 'hint', text: 'LMB fires the M2 .50 cal (watch barrel heat). RMB zooms. Target cruiser tires, engines, and fuel tankers!', seconds: 8 },
        { do: 'objective', id: 'hw_wave1', text: 'Shred pursuing Police Interceptors' },
        { do: 'until', when: { signal: 'bk:highway_wave1_done' } },
        { do: 'done', id: 'hw_wave1' },

        // Wave 2: SWAT BearCats & Explosive Fuel Tankers
        { do: 'call', name: 'bk.highwayWave2' },
        say('radio.highway.wave2', { now: true }),
        { do: 'objective', id: 'hw_wave2', text: 'Destroy SWAT BearCat Vans & Fuel Tankers' },
        { do: 'until', when: { signal: 'bk:highway_wave2_done' } },
        { do: 'done', id: 'hw_wave2' },

        // Wave 3 Climax Boss: Governor Sterling in AUDITOR-1
        { do: 'music', state: 'hard' },
        { do: 'call', name: 'bk.bossStart' },
        say('governor.boss.arrive', { now: true }),
        { do: 'objective', id: 'hw_boss', text: 'Shoot down AUDITOR-1 (Governor Sterling)' },
        { do: 'hint', text: 'Target AUDITOR-1 chin turret, rocket pods, and tail rotor — shoot incoming rockets out of the sky!', seconds: 8 },
        { do: 'until', when: { signal: 'bk:boss_dead' } },
        { do: 'done', id: 'hw_boss' },

        // Extraction Tunnel & Mission Complete
        { do: 'call', name: 'bk.finishTunnel' },
        say('council.complete', { wait: true }),
        { do: 'until', when: { any: [{ signal: 'bk:tunnel_complete' }, { after: 3 }] } },
        { do: 'finish' },
      ],
      cues: [
        {
          when: { signal: 'bk:boss_tail_damaged' },
          run: [say('governor.boss.tail', { now: true })],
        },
        {
          when: { signal: 'bk:boss_dying' },
          run: [say('governor.boss.down', { now: true })],
        },
      ],
    },
  ],
};
