/** Which loops each machine runs on, through `EngineSound`, so each can be heard coming from further than the distance model reaches. */
import type { EngineSoundPlan } from '../../progression/callins/airframe';

export const GROUND_ENGINES: Readonly<Record<'humvee' | 'truck' | 'tank', EngineSoundPlan>> = {
  humvee: { near: 14, far: 130, layers: [{ id: 'truck_engine_loop', volume: 0.75, pitch: 1.25 }] },
  truck: { near: 18, far: 160, layers: [{ id: 'truck_engine_loop', volume: 1, pitch: 0.95 }] },
  tank: {
    near: 26, far: 240,
    layers: [{ id: 'tank_engine_loop', volume: 1, pitch: 1 }, { id: 'tank_tracks_loop', volume: 0.85, pitch: 1 }],
  },
};

export const CHOPPER_ENGINE: EngineSoundPlan = {
  near: 55, far: 420,
  layers: [{ id: 'gunship_rotor_loop', volume: 1.2, pitch: 1 }, { id: 'gunship_turbine_loop', volume: 0.5, pitch: 1 }],
};
