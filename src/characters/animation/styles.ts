/** Per-archetype movement character. Pure tuning data. */
export interface MoveStyle {
  /** Forward curl of the spine at rest, radians. */
  hunch: number;
  /** Head compensation so the eyes stay level under the hunch. 1 keeps the gaze flat. */
  gazeLift: number;
  /** Hip height as a fraction of standing height. */
  crouch: number;
  /** Stance half-width multiplier. */
  stance: number;
  /** Arm spread at rest, 0 tight, 1 wide. */
  armsOut: number;
  /** Multiplies step frequency. */
  cadence: number;
  /** Multiplies pelvis bob and sway. */
  bounce: number;
  /** Twitch amplitude layered on idle. */
  twitch: number;
  /** Fraction of arm length the hands ride above a dead hang, for heavy fists that would drag. */
  armLift: number;
}

const base: MoveStyle = { hunch: 0.06, gazeLift: 0.8, crouch: 0.97, stance: 1, armsOut: 0.2, cadence: 1, bounce: 1, twitch: 0, armLift: 0 };

export const STYLES: Record<string, MoveStyle> = {
  husk: { ...base, hunch: 0.66, gazeLift: 0.95, crouch: 0.88, armsOut: 0.1, cadence: 1.1, bounce: 1.25, twitch: 0.2 },
  trooper: { ...base, hunch: 0.14, crouch: 0.93 },
  gunner: { ...base, hunch: 0.16, crouch: 0.93, stance: 1.1, cadence: 0.95, armsOut: 0.3 },
  brute: { ...base, hunch: 0.26, crouch: 0.92, stance: 1.3, armsOut: 0.7, cadence: 0.86, bounce: 1.2 },
  stalker: { ...base, hunch: 0.3, crouch: 0.86, stance: 0.9, cadence: 1.12, bounce: 0.7, armsOut: 0.35 },
  rocketeer: { ...base, hunch: 0.14, crouch: 0.94, stance: 1.1, cadence: 0.95 },
  sniper: { ...base, hunch: 0.16, crouch: 0.92, stance: 0.9 },
  riot: { ...base, hunch: 0.16, crouch: 0.92, stance: 1.2, cadence: 0.9 },
  leaper: { ...base, hunch: 0.62, gazeLift: 1, crouch: 0.78, stance: 1.2, armsOut: 0.4, cadence: 1.2, bounce: 1.4, twitch: 0.3 },
  bomber: { ...base, hunch: 0.32, crouch: 0.92, cadence: 1.1, bounce: 1.3, twitch: 0.1 },
  burner: { ...base, hunch: 0.16, crouch: 0.93, stance: 1.2, cadence: 0.88, armsOut: 0.4 },
  warden: { ...base, hunch: 0.04, gazeLift: 0.4, crouch: 0.98, stance: 0.85, cadence: 0.8, bounce: 0.4 },
  juggernaut: { ...base, hunch: 0.3, crouch: 0.94, stance: 1.5, armsOut: 0.8, cadence: 0.96, bounce: 1.1, armLift: 0.14 },
  contractor: { ...base, hunch: 0.08, crouch: 0.95 },
  titan: { ...base, hunch: 0.24, crouch: 0.96, stance: 1.5, armsOut: 0.75, cadence: 0.98, bounce: 1.05, armLift: 0.3 },
};
