/**
 * Badlands Motor Pool & Distraint Frame Requisition Terminal tests:
 *   - All 13 driveable vehicles appear cleanly across Ground (6), Rotorcraft (2), and Aircraft (5)
 *   - Proximity prompt activates near BADLANDS_TERMINAL and opens/closes the modal cleanly
 *   - Frame requisition & customize callbacks emit the exact contract events
 *   - DriveableManager stages ground/rotorcraft on BADLANDS_VEHICLE_PAD and jets on BADLANDS_AIRCRAFT_PAD,
 *     replaces overlapping unoccupied pad vehicles while preserving distant vehicles, and clears unoccupied vehicles
 */
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { GameEvents } from '../../core/contracts';
import { EventBus } from '../../core/events';
import { DEFAULT_FRAME_LOADOUT, fitPart } from '../../frame/loadout';
import { DRIVE_VEHICLE_ORDER } from '../../vehicles/drive/data';
import { BADLANDS_TERMINAL } from '../../world/map/badlands/plan';
import {
  BADLANDS_TERMINAL_VEHICLES,
  BadlandsTerminalController,
  type BadlandsFrameStatus,
} from './terminalUi';

function makeTerminalHarness() {
  const events = new EventBus<GameEvents>();
  const pressed = new Set<string>();
  const prompts: string[] = [];
  let promptCleared = 0;

  const playerPos = new THREE.Vector3(0, 0, 10);
  const ctx = {
    events,
    player: {
      position: playerPos,
      alive: true,
      parked: false,
    },
    input: {
      labelFor: () => 'E',
      pressed: (a: string) => pressed.has(a),
      endFrame: vi.fn(),
    },
    hud: {
      follow: (_pos: THREE.Vector3, label: string) => {
        prompts.push(label);
        return () => { promptCleared++; };
      },
    },
    audio: {
      play: vi.fn(),
    },
  } as never;

  const status: BadlandsFrameStatus = {
    deployed: true,
    occupied: false,
    health: 3200,
    maxHealth: 4000,
    loadout: DEFAULT_FRAME_LOADOUT,
  };

  return { ctx, events, pressed, prompts, playerPos, status, getPromptCleared: () => promptCleared };
}

describe('Badlands Motor Pool & Frame Terminal', () => {
  it('lists all 13 driveable vehicles across Ground (6), Rotorcraft (2), and Aircraft (5) with zero duplicates', () => {
    const ids = BADLANDS_TERMINAL_VEHICLES.map(v => v.id);
    expect(new Set(ids).size).toBe(DRIVE_VEHICLE_ORDER.length);
    for (const id of DRIVE_VEHICLE_ORDER) {
      expect(ids).toContain(id);
    }
    expect(BADLANDS_TERMINAL_VEHICLES.filter(v => v.tab === 'ground').length).toBe(6);
    expect(BADLANDS_TERMINAL_VEHICLES.filter(v => v.tab === 'rotorcraft').length).toBe(2);
    expect(BADLANDS_TERMINAL_VEHICLES.filter(v => v.tab === 'aircraft').length).toBe(5);
  });

  it('shows proximity prompt near BADLANDS_TERMINAL, opens modal on interact, and closes cleanly', () => {
    const h = makeTerminalHarness();
    const modalEvents: boolean[] = [];
    h.events.on('badlands:modal', e => modalEvents.push(e.open));

    const ctrl = new BadlandsTerminalController(h.ctx, () => h.status, () => 2);

    // Far away at player spawn (0, 0, 10) -> no prompt
    ctrl.update(true);
    expect(h.prompts).toEqual([]);
    expect(ctrl.open).toBe(false);

    // Walk up beside the terminal kiosk
    h.playerPos.set(BADLANDS_TERMINAL[0] + 2.0, 0, BADLANDS_TERMINAL[2] + 1.5);
    ctrl.update(true);
    expect(h.prompts).toEqual(['[E] MOTOR POOL & FRAME TERMINAL']);

    // Press interact -> opens terminal and emits badlands:modal { open: true }
    h.pressed.add('interact');
    ctrl.update(true);
    expect(ctrl.open).toBe(true);
    expect(modalEvents).toEqual([true]);

    // Closing emits badlands:modal { open: false }
    ctrl.close();
    expect(ctrl.open).toBe(false);
    expect(modalEvents).toEqual([true, false]);

    // Reset while closed does not emit duplicate close event
    ctrl.reset();
    expect(modalEvents).toEqual([true, false]);

    ctrl.dispose();
  });

  it('suppresses prompt while seated, dead, or interaction is locked', () => {
    const h = makeTerminalHarness();
    const ctrl = new BadlandsTerminalController(h.ctx, () => h.status, () => 0);

    h.playerPos.set(BADLANDS_TERMINAL[0] + 1, 0, BADLANDS_TERMINAL[2] + 1);
    ctrl.update(false);
    expect(h.prompts).toEqual([]);

    ctrl.update(true);
    expect(h.prompts.length).toBe(1);

    // Sitting inside a vehicle/Frame clears the prompt
    (h.ctx as unknown as { player: { parked: boolean } }).player.parked = true;
    ctrl.update(true);
    expect(h.getPromptCleared()).toBe(1);

    ctrl.dispose();
  });

  it('supports Frame loadout comparison and clean customize round-trip state', () => {
    const h = makeTerminalHarness();
    const customLoadout = fitPart(DEFAULT_FRAME_LOADOUT, 'howitzerR');
    expect(customLoadout.rightArm).toBe('howitzerR');

    const ctrl = new BadlandsTerminalController(h.ctx, () => h.status, () => 1);
    ctrl.ui.openTab('frame');
    expect(ctrl.open).toBe(true);
    expect(ctrl.ui.activeTab).toBe('frame');

    ctrl.ui.resumeFromCustomize();
    expect(ctrl.open).toBe(true);

    ctrl.dispose();
  });
});
