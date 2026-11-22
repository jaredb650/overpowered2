/**
 * Where everything in Bank Run (Mission 4) lives on Brine Central Reserve + Coastal Elevated Expressway.
 * Every coordinate derives from `src/world/map/bank/plan.ts` so map geometry, heist modules,
 * and mission beats stay locked to one spatial contract.
 */
import {
  DRILL_FLOOR_POS,
  HIGHWAY_ORIGIN,
  HUMVEE_BED_POS,
  HUMVEE_TURRET_POS,
  LV,
  MGL_RACK_POS,
  PORTICO_DOOR_POS,
  ROOF_HELIPAD,
  ROOF_SATCHEL_POS,
  ROOF_STAIR_DOOR_POS,
  SABOT_RACK_POS,
  SKYLIGHT_CENTER,
  VAULT_EAST_DOOR_POS,
  VAULT_WEST_DOOR_POS,
} from '../../world/map/bank/plan';
import type { Cutscene, DoorDef, Mark, Zone } from '../types';

export const MARKS: Readonly<Record<string, Mark>> = {
  // Act 1: Rooftop insertion & skylight breach
  helipad: { at: [ROOF_HELIPAD[0], ROOF_HELIPAD[1], ROOF_HELIPAD[2]], yaw: 0 },
  roofSatchel: { at: [ROOF_SATCHEL_POS[0], ROOF_SATCHEL_POS[1], ROOF_SATCHEL_POS[2]], yaw: 0 },
  roofNorth: { at: [0, LV.roof, -14], yaw: Math.PI },
  roofWest: { at: [-14, LV.roof, -2], yaw: Math.PI * 0.5 },
  skylight: { at: [SKYLIGHT_CENTER[0], SKYLIGHT_CENTER[1], SKYLIGHT_CENTER[2]], yaw: 0 },

  // Act 2: Grand Banking Hall, Mezzanine & Vault Drill
  hallCenter: { at: [0, LV.hall, 2], yaw: 0 },
  hallDrop: { at: [0, LV.hall, 8], yaw: 0 },
  hallSouth: { at: [0, LV.hall, 18], yaw: 0 },
  mezzWest: { at: [-20, LV.mezz, 4], yaw: Math.PI * 0.5 },
  mezzEast: { at: [20, LV.mezz, 4], yaw: -Math.PI * 0.5 },
  sabotRack: { at: [SABOT_RACK_POS[0], SABOT_RACK_POS[1], SABOT_RACK_POS[2]], yaw: 0 },
  mglRack: { at: [MGL_RACK_POS[0], MGL_RACK_POS[1], MGL_RACK_POS[2]], yaw: Math.PI },
  antechamber: { at: [0, LV.vault, -24], yaw: 0 },
  vaultWestSpawn: { at: [-14, LV.vault, -26], yaw: Math.PI * 0.5 },
  vaultEastSpawn: { at: [14, LV.vault, -26], yaw: -Math.PI * 0.5 },
  drillPoint: { at: [DRILL_FLOOR_POS[0], DRILL_FLOOR_POS[1], DRILL_FLOOR_POS[2]], yaw: 0 },
  vaultInside: { at: [0, LV.vault, -37], yaw: Math.PI },

  // Act 3: Bullion Plunder & Getaway Humvee
  plazaWest: { at: [-16, LV.hall, 40], yaw: 0 },
  plazaEast: { at: [16, LV.hall, 40], yaw: 0 },
  plazaCenter: { at: [0, LV.hall, 44], yaw: 0 },
  humveeBed: { at: [HUMVEE_BED_POS[0], HUMVEE_BED_POS[1], HUMVEE_BED_POS[2]], yaw: Math.PI },
  humveeTurret: { at: [HUMVEE_TURRET_POS[0], HUMVEE_TURRET_POS[1], HUMVEE_TURRET_POS[2]], yaw: Math.PI },

  // Act 4: Coastal Elevated Expressway
  highwayStart: { at: [HIGHWAY_ORIGIN[0], HIGHWAY_ORIGIN[1], HIGHWAY_ORIGIN[2]], yaw: Math.PI },
};

export const ZONES: Readonly<Record<string, Zone>> = {
  bankingHall: { min: [-26, -0.5, -16], max: [26, 5.2, 24] },
  antechamber: { min: [-18, -2.5, -32.5], max: [18, 4.2, -18] },
};

export const DOORS: Readonly<Record<string, DoorDef>> = {
  'roof.stair': {
    at: [ROOF_STAIR_DOOR_POS[0], ROOF_STAIR_DOOR_POS[1], ROOF_STAIR_DOOR_POS[2]],
    yaw: 0,
    width: 3.4,
    height: 3.2,
    kind: 'shutter',
    seconds: 1.4,
    start: 1,
    look: 'steelDark',
  },
  'lobby.portico': {
    at: [PORTICO_DOOR_POS[0], PORTICO_DOOR_POS[1], PORTICO_DOOR_POS[2]],
    yaw: 0,
    width: 6.2,
    height: 4.4,
    kind: 'shutter',
    seconds: 1.8,
    start: 1,
    look: 'steel',
  },
  'vault.west': {
    at: [VAULT_WEST_DOOR_POS[0], VAULT_WEST_DOOR_POS[1], VAULT_WEST_DOOR_POS[2]],
    yaw: Math.PI / 2,
    width: 3.2,
    height: 3.4,
    kind: 'slide',
    seconds: 1.2,
    start: 0,
    look: 'steelDark',
  },
  'vault.east': {
    at: [VAULT_EAST_DOOR_POS[0], VAULT_EAST_DOOR_POS[1], VAULT_EAST_DOOR_POS[2]],
    yaw: -Math.PI / 2,
    width: 3.2,
    height: 3.4,
    kind: 'slide',
    seconds: 1.2,
    start: 0,
    look: 'steelDark',
  },
};

export const ROUTES: Readonly<Record<string, readonly string[]>> = {};

export const CUTSCENES: Readonly<Record<string, Cutscene>> = {
  opening: {
    shots: [
      {
        from: [46, 32, 54],
        to: [18, 26, 36],
        lookFrom: [0, 8, 6],
        lookTo: [0, 14, 2],
        seconds: 4.2,
        fov: 54,
        fadeIn: 0.7,
        caption: 'BRINE CENTRAL RESERVE // 09:15',
      },
      {
        from: [-14, 24, 34],
        to: [0, 25, 22],
        lookFrom: [0, 14, 4],
        lookTo: [0, 14, 16],
        seconds: 3.6,
        fov: 58,
        fadeOut: 0.4,
        caption: 'FORM 7742-B // STAY OF LIQUIDATION EXPIRED',
      },
    ],
  },
};
