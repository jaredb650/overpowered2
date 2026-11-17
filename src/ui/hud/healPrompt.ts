import type { HudState } from '../state';

/** Health below this share shows the prompt: the same line the health bar turns red at (vitals.ts). */
export const HEAL_BELOW = 0.35;

/**
 * "Press [Q] to heal" for the crosshair, with the key the player has bound to the stim. Only with a stim in the kit and
 * none going in, so a mode without stims (or an empty kit) shows nothing at all: no "No stims" nag. An unbound stim has no
 * key to name, so it shows nothing too.
 */
export function healPrompt(s: Pick<HudState, 'health' | 'maxHealth' | 'stims' | 'stimInjecting' | 'alive'>, key: string): string | null {
  if (!key || !s.alive || s.stims <= 0 || s.stimInjecting >= 0) return null;
  return s.health / s.maxHealth < HEAL_BELOW ? `Press [${key}] to heal` : null;
}
