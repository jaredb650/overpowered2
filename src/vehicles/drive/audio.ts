/**
 * Responsive procedural vehicle audio controller for all player-driveable & future AI vehicles.
 *
 * Key design features:
 *  - Auto-retries `ctx.audio.startLoop(...)` whenever a handle is dead (e.g. if boarded while the
 *    SoundBank is still finishing its initial synth renders), so vehicle audio NEVER stays silent.
 *  - Smooth engine spin-up on board and audible spin-down coasting when exiting (instead of hard cuts).
 *  - Simulated 5-speed transmission RPM curve + gear-shift exhaust pops for wheeled & moto vehicles.
 *  - Multi-layer jet audio: exhaust roar (`jet_engine_loop`) + pitch-bending turbofan compressor whine
 *    (`jet_turbine_whine_loop`) + crackling Mach/Shift afterburner (`jet_afterburner_loop`) + ignition boom.
 *  - Horizon-range spatialization via `soundPoint()` + real-time Doppler shift so approaching Technicals,
 *    Choppers, and Harriers are audibly recognizable from 200-380 m away while staying crisp & unmuffled
 *    in 3P chase camera when you are piloting.
 */
import * as THREE from 'three';
import type { Ctx, LoopHandle } from '../../core/contracts';
import { clamp, damp, smoothstep } from '../../core/math';
import { soundPoint } from '../../progression/callins/airframe';
import type { DriveVehicleDef, VehicleInput, VehiclePhysicsState } from './types';

const _pt = new THREE.Vector3();
const _listener = new THREE.Vector3();

/** Place loops inside `near` (6 m) so our own distance curve + horizon range governs attenuation. */
const SOUND_RANGE = 3;
const MAX_DOPPLER = 0.14;

/** Simulated gear ratios (speed fraction thresholds) for wheeled & moto vehicles. */
const GEAR_THRESHOLDS = [0.18, 0.36, 0.56, 0.78, 1.05] as const;

export interface VehicleAudioTelemetry {
  readonly running: boolean;
  readonly spool: number;
  readonly rpm: number;
  readonly gear: number;
  readonly afterburner: number;
}

export class VehicleAudioController {
  private primary: LoopHandle | null = null;
  private secondary: LoopHandle | null = null;
  private tertiary: LoopHandle | null = null;
  private drift: LoopHandle | null = null;
  private turret: LoopHandle | null = null;

  private active = false;
  private coolingDown = false;
  private spool = 0;
  private rpm = 0;
  private gear = 1;
  private gearCooldown = 0;
  private afterburner = 0;
  private wasBoosting = false;
  private wasMach = false;
  private lastDistance = -1;
  private doppler = 1;
  private dopplerClock = 0;

  constructor(private readonly ctx: Ctx, private readonly def: DriveVehicleDef) {}

  get telemetry(): VehicleAudioTelemetry {
    return {
      running: this.active || this.spool > 0.04,
      spool: this.spool,
      rpm: this.rpm,
      gear: this.gear,
      afterburner: this.afterburner,
    };
  }

  /** Engage engine ignition and begin smooth turbine/motor spin-up. */
  start(pos: THREE.Vector3, vtolMode = true): void {
    this.active = true;
    this.coolingDown = false;
    this.spool = Math.max(this.spool, 0.16);
    this.rpm = Math.max(this.rpm, 0.15);
    this.gear = 1;
    this.wasMach = this.def.category === 'jet' && !vtolMode;
    this.wasBoosting = false;
    this.ensureLoops(pos);
  }

  /** Begin smooth audible engine spin-down (instead of an abrupt audio pop). */
  shutdown(): void {
    this.active = false;
    if (this.spool > 0.05) {
      this.coolingDown = true;
    } else {
      this.stopAll();
    }
    if (this.drift) {
      this.drift.stop(0.15);
      this.drift = null;
    }
    if (this.turret) {
      this.turret.stop(0.15);
      this.turret = null;
    }
  }

  /** Immediately silence and release all loops (on destroy / dispose). */
  stopAll(): void {
    this.active = false;
    this.coolingDown = false;
    this.spool = 0;
    this.rpm = 0;
    this.afterburner = 0;
    this.primary?.stop(0.12);
    this.primary = null;
    this.secondary?.stop(0.12);
    this.secondary = null;
    this.tertiary?.stop(0.12);
    this.tertiary = null;
    this.drift?.stop(0.1);
    this.drift = null;
    this.turret?.stop(0.1);
    this.turret = null;
  }

  /** Play crisp pneumatic vectoring-nozzle shift audio on VTOL <-> Mach toggle. */
  playVtolShift(pos: THREE.Vector3, enteringMach: boolean): void {
    this.ctx.audio?.play?.('veh_vtol_shift', {
      position: pos,
      volume: 0.85,
      pitch: enteringMach ? 1.08 : 0.88,
    });
    if (enteringMach) {
      this.ctx.audio?.play?.('veh_afterburner_ignite', {
        position: pos,
        volume: 0.85,
        pitch: this.def.id === 'harrier' ? 1.06 : 0.92,
      });
    }
  }

  /** Step continuous procedural RPM, turbine spool, afterburner, drift, and horizon panning. */
  update(
    dt: number,
    phys: VehiclePhysicsState,
    occupied: boolean,
    input: VehicleInput | null,
    turretTurning: boolean,
    lanceCharge: number,
  ): void {
    if (!this.active && !this.coolingDown) return;

    const isJet = this.def.category === 'jet';
    const isHeli = this.def.category === 'helicopter';
    const isHover = this.def.category === 'hover';
    const isTracked = this.def.category === 'tracked';
    const isGeared = this.def.category === 'wheeled' || this.def.category === 'moto';

    // 1. Spool state: spin up smoothly when running, spin down naturally when shutting off.
    if (this.active) {
      const spinRate = isJet || isHeli ? 2.1 : 4.2;
      this.spool = damp(this.spool, 1, spinRate, dt);
    } else if (this.coolingDown) {
      const downRate = isJet || isHeli ? 0.9 : 1.75;
      this.spool = Math.max(0, this.spool - dt * downRate * (0.4 + this.spool * 0.6));
      if (this.spool <= 0.025) {
        this.stopAll();
        return;
      }
    }

    // 2. Listener position & horizon-range attenuation + Doppler pitch shift.
    const camPos = this.ctx.render?.camera?.position;
    if (camPos) _listener.copy(camPos);
    else if (this.ctx.player?.eye) _listener.copy(this.ctx.player.eye);
    else _listener.copy(phys.position);

    const distance = soundPoint(phys.position, _listener, SOUND_RANGE, _pt);
    const farRange = isJet ? 390 : isHeli ? 340 : isTracked ? 230 : 210;
    const nearRange = isJet || isHeli ? 32 : 20;

    // When the local player is riding/piloting, keep full crisp unmuffled presence even in 3P chase cam.
    let distGain = 1;
    if (!occupied) {
      distGain = clamp(nearRange / Math.max(distance, 1), 0, 1) * (1 - smoothstep(nearRange, farRange, distance));
      this.dopplerClock -= dt;
      if (this.dopplerClock <= 0) {
        const closing = this.lastDistance < 0 ? 0 : (this.lastDistance - distance) / (0.08 * 343);
        this.lastDistance = distance;
        this.dopplerClock = 0.08;
        this.doppler = damp(this.doppler, 1 + clamp(closing, -MAX_DOPPLER, MAX_DOPPLER), 10, 0.08);
      }
    } else {
      this.lastDistance = distance;
      this.doppler = 1;
    }

    // Retry any loop that returned a dead handle before the SoundBank finished rendering it!
    this.ensureLoops(_pt);

    // 3. Procedural throttle / RPM / gear / turbine response.
    const throttleAmt = input ? Math.abs(input.throttle) : 0;
    const steerAmt = input ? Math.abs(input.steer) : 0;
    const climbAmt = input ? clamp(input.climb, -0.5, 1) : 0;
    const speedFrac = clamp(phys.speed / Math.max(1, this.def.boostSpeed), 0, 1.15);
    const normSpeed = clamp(phys.speed / Math.max(1, this.def.maxSpeed), 0, 1.35);

    this.gearCooldown = Math.max(0, this.gearCooldown - dt);

    if (isGeared && this.active) {
      // 5-speed sequential transmission simulation for unmistakable motor rev-up / shift / rev-down!
      let targetGear = 1;
      for (let g = 0; g < GEAR_THRESHOLDS.length; g++) {
        if (normSpeed >= GEAR_THRESHOLDS[g]!) targetGear = Math.min(5, g + 2);
      }
      if (targetGear > this.gear && this.gearCooldown <= 0 && throttleAmt > 0.25) {
        this.gear = targetGear;
        this.gearCooldown = 0.32;
        if (occupied || distance < 70) {
          this.ctx.audio?.play?.('veh_gear_shift', {
            position: _pt,
            volume: (occupied ? 0.58 : 0.45 * distGain),
            pitch: this.def.category === 'moto' ? 1.24 : this.def.id === 'quad' ? 1.08 : 0.92,
          });
        }
      } else if (targetGear < this.gear) {
        this.gear = targetGear;
      }
      const prevTh = this.gear <= 1 ? 0 : GEAR_THRESHOLDS[this.gear - 2]!;
      const nextTh = GEAR_THRESHOLDS[this.gear - 1] ?? 1.15;
      const inGear = clamp((normSpeed - prevTh) / Math.max(0.12, nextTh - prevTh), 0, 1);
      const revTarget = clamp(
        0.1 + inGear * 0.68 + throttleAmt * 0.22 + (phys.boosting ? 0.25 : 0) + (phys.pitch < -0.1 ? 0.16 : 0),
        0.06,
        1.2,
      );
      this.rpm = damp(this.rpm, revTarget, throttleAmt > 0.1 ? 8.5 : 4.2, dt);
    } else if (isJet && this.active) {
      const mach = !phys.vtolMode;
      const load = clamp(
        (mach ? 0.48 : 0.24) + speedFrac * 0.46 + throttleAmt * 0.22 + Math.max(0, climbAmt) * 0.24 + (phys.boosting ? 0.34 : 0),
        0.15,
        1.25,
      );
      this.rpm = damp(this.rpm, load, 4.5, dt);
      const abTarget = phys.boosting ? 1.0 : mach ? clamp(0.32 + speedFrac * 0.55 + throttleAmt * 0.18, 0.25, 0.85) : 0.04;
      this.afterburner = damp(this.afterburner, abTarget, phys.boosting ? 8 : 3.2, dt);

      if ((phys.boosting && !this.wasBoosting) || (mach && !this.wasMach)) {
        this.ctx.audio?.play?.('veh_afterburner_ignite', {
          position: _pt,
          volume: occupied ? 0.82 : 0.7 * distGain,
          pitch: this.def.id === 'harrier' ? 1.08 : 0.94,
        });
      }
      this.wasBoosting = phys.boosting;
      this.wasMach = mach;
    } else if (isHeli && this.active) {
      const bladeLoad = clamp(
        0.22 + speedFrac * 0.42 + Math.abs(phys.velocity.y) * 0.035 + Math.max(0, climbAmt) * 0.3 + steerAmt * 0.12 + (phys.boosting ? 0.26 : 0),
        0.15,
        1.2,
      );
      this.rpm = damp(this.rpm, bladeLoad, 4.0, dt);
    } else if (isHover && this.active) {
      const repulsor = clamp(
        0.18 + speedFrac * 0.65 + (throttleAmt + steerAmt) * 0.18 + (phys.boosting ? 0.38 : 0) + lanceCharge * 0.35,
        0.12,
        1.3,
      );
      this.rpm = damp(this.rpm, repulsor, 6.5, dt);
    } else {
      const target = this.active ? clamp(0.15 + speedFrac * 0.72 + throttleAmt * 0.22 + (phys.boosting ? 0.22 : 0), 0.1, 1.15) : 0;
      this.rpm = damp(this.rpm, target, this.active ? 5.5 : 2.0, dt);
      this.afterburner = damp(this.afterburner, 0, 4.0, dt);
    }

    // 4. Drive continuous loop pitch & volume smoothly.
    const spoolPitch = 0.46 + 0.54 * this.spool;
    const basePitch = (this.def.enginePitchIdle + (this.def.enginePitchMax - this.def.enginePitchIdle) * this.rpm)
      * spoolPitch * this.doppler * (phys.abandonedFall ? 1.16 : 1);
    const masterGain = this.def.engineVolume * this.spool * distGain * (occupied ? 1.0 : 0.88);

    if (this.primary?.alive) {
      this.primary.setPosition(_pt);
      this.primary.setPitch(clamp(basePitch, 0.35, 2.6), 0.06);
      this.primary.setVolume(clamp(masterGain * (0.78 + this.rpm * 0.34), 0.001, 1.25), 0.06);
    }

    if (this.secondary?.alive) {
      this.secondary.setPosition(_pt);
      if (isTracked) {
        const trackFrac = clamp(phys.speed / Math.max(1, this.def.maxSpeed), 0, 1.2);
        this.secondary.setPitch(clamp((0.72 + trackFrac * 0.72) * this.doppler, 0.4, 2.0), 0.06);
        this.secondary.setVolume(trackFrac > 0.04 ? clamp(masterGain * (0.2 + trackFrac * 0.68), 0.001, 1.1) : 0.001, 0.08);
      } else if (isJet) {
        // Pure turbofan compressor whine tone — unmistakable jet spin-up / spin-down feedback!
        const whinePitch = (0.58 + this.rpm * 0.92 + (phys.vtolMode ? 0.12 : 0.24)) * spoolPitch * this.doppler;
        this.secondary.setPitch(clamp(whinePitch, 0.38, 2.35), 0.06);
        this.secondary.setVolume(clamp(masterGain * (0.52 + this.rpm * 0.42), 0.001, 1.05), 0.06);
      } else if (isHeli) {
        // Helicopter turbine whine over rotor slap!
        const turbPitch = (0.76 + this.rpm * 0.56) * spoolPitch * this.doppler;
        this.secondary.setPitch(clamp(turbPitch, 0.4, 2.1), 0.06);
        this.secondary.setVolume(clamp(masterGain * (0.48 + this.rpm * 0.42), 0.001, 1.0), 0.06);
      } else if (isHover) {
        // Viper harmonic repulsor turbine & Particle Lance charge whine!
        const hovPitch = (0.7 + this.rpm * 0.85 + lanceCharge * 0.48) * spoolPitch * this.doppler;
        this.secondary.setPitch(clamp(hovPitch, 0.4, 2.5), 0.05);
        this.secondary.setVolume(clamp(masterGain * (0.36 + this.rpm * 0.38 + lanceCharge * 0.36), 0.001, 1.0), 0.05);
      }
    }

    if (this.tertiary?.alive && isJet) {
      this.tertiary.setPosition(_pt);
      const abPitch = (0.84 + this.rpm * 0.42 + (phys.boosting ? 0.2 : 0)) * spoolPitch * this.doppler;
      this.tertiary.setPitch(clamp(abPitch, 0.5, 2.2), 0.06);
      this.tertiary.setVolume(clamp(masterGain * this.afterburner * 1.15, 0.001, 1.25), 0.07);
    }

    // 5. Tire drift screech & gravel loop on grounded wheeled / moto powerslides.
    const shouldDrift = occupied
      && isGeared
      && phys.drifting
      && phys.grounded
      && phys.speed > 6.5;
    if (shouldDrift) {
      if (!this.drift?.alive) {
        this.drift = this.ctx.audio?.startLoop?.('veh_drift_loop', {
          position: _pt,
          volume: 0.46,
          pitch: 0.95,
        }) ?? null;
      }
      if (this.drift?.alive) {
        const spdFrac = clamp(phys.speed / Math.max(1, this.def.maxSpeed), 0.3, 1.3);
        this.drift.setPosition(_pt);
        this.drift.setPitch(0.84 + spdFrac * 0.36, 0.05);
        this.drift.setVolume(clamp(0.3 + spdFrac * 0.36, 0.22, 0.68), 0.05);
      }
    } else if (this.drift) {
      this.drift.stop(0.14);
      this.drift = null;
    }

    // 6. Heavy turret hydraulic traverse hum on Aegis tank & Bastion guntruck when slewing.
    const shouldTurret = occupied && turretTurning && (this.def.id === 'aegis' || this.def.id === 'bastion');
    if (shouldTurret) {
      if (!this.turret?.alive) {
        this.turret = this.ctx.audio?.startLoop?.('tank_turret_loop', {
          position: _pt,
          volume: 0.34,
          pitch: this.def.id === 'aegis' ? 0.92 : 1.08,
        }) ?? null;
      }
      if (this.turret?.alive) {
        this.turret.setPosition(_pt);
        this.turret.setVolume(0.36, 0.06);
      }
    } else if (this.turret) {
      this.turret.stop(0.12);
      this.turret = null;
    }
  }

  /** Starts (or retries) any continuous loops whose SoundBank buffer is now ready. */
  private ensureLoops(pos: THREE.Vector3): void {
    const audio = this.ctx.audio;
    if (!audio?.startLoop) return;

    if (!this.primary?.alive) {
      this.primary = audio.startLoop(this.def.engineLoop, {
        position: pos,
        volume: Math.max(0.05, this.def.engineVolume * this.spool),
        pitch: this.def.enginePitchIdle * (0.46 + 0.54 * this.spool),
        fadeIn: 0.14,
      });
    }

    const secId = this.def.category === 'jet'
      ? 'jet_turbine_whine_loop'
      : this.def.category === 'hover'
        ? 'jet_turbine_whine_loop'
        : this.def.engineLayerLoop;
    if (secId && !this.secondary?.alive) {
      this.secondary = audio.startLoop(secId, {
        position: pos,
        volume: 0.05,
        pitch: this.def.enginePitchIdle,
        fadeIn: 0.16,
      });
    }

    if (this.def.category === 'jet' && this.def.engineLayerLoop && !this.tertiary?.alive) {
      this.tertiary = audio.startLoop(this.def.engineLayerLoop, {
        position: pos,
        volume: 0.01,
        pitch: 0.9,
        fadeIn: 0.16,
      });
    }
  }
}
