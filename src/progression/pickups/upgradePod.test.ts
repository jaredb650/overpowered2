/** Unit tests for the Airdrop 105mm Howitzer Upgrade Pod (`upgradePod.ts`). */
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { Ctx } from '../../core/contracts';
import { UPGRADE_POD, UpgradePod } from './upgradePod';

function makeEnv() {
  let interactDown = false;
  const signals: string[] = [];
  const feeds: string[] = [];
  const sounds: string[] = [];
  const holds: number[] = [];
  const prompts: string[] = [];
  const markers: string[] = [];

  const player = {
    alive: true,
    parked: false,
    position: new THREE.Vector3(0, 0, 0),
  };

  const ctx = {
    render: {
      scene: new THREE.Scene(),
      depthTexture: null,
      materials: { patch: <T>(m: T) => m },
      lights: { flash: vi.fn() },
      decals: { add: vi.fn(), clear: vi.fn() },
      post: { flash: vi.fn() },
    },
    physics: {
      R: {
        Ray: class {
          constructor(public origin: { x: number; y: number; z: number }, public dir: { x: number; y: number; z: number }) {}
        },
      },
      world: {
        castRay: () => ({ timeOfImpact: 4 }),
      },
    },
    input: {
      isDown: (action: string) => action === 'interact' && interactDown,
      labelFor: (action: string) => (action === 'interact' ? 'E' : ''),
    },
    audio: {
      play: (id: string) => { sounds.push(id); },
    },
    fx: {
      attachEmitter: vi.fn(() => ({ stop: vi.fn(), alive: true })),
      dust: vi.fn(),
      sparks: vi.fn(),
      ring: vi.fn(),
      slam: vi.fn(),
      pickupSparkle: vi.fn(),
    },
    hud: {
      marker: (_pos: THREE.Vector3, label: string) => {
        markers.push(label);
        return vi.fn();
      },
      follow: (_pos: THREE.Vector3, label: string) => {
        prompts.push(label);
        return vi.fn();
      },
      hold: (fill: number) => { holds.push(fill); },
      feed: (text: string) => { feeds.push(text); },
      callout: vi.fn(),
    },
    player,
    camera: {
      addTrauma: vi.fn(),
    },
    campaign: {
      signal: (name: string) => { signals.push(name); },
    },
  } as unknown as Ctx;

  return {
    ctx,
    player,
    signals,
    feeds,
    sounds,
    holds,
    prompts,
    markers,
    setInteract: (down: boolean) => { interactDown = down; },
  };
}

function advancePodToOpen(pod: UpgradePod): void {
  const totalSeconds = UPGRADE_POD.warnSeconds + UPGRADE_POD.dropHeight / UPGRADE_POD.dropSpeed + UPGRADE_POD.openSeconds + 0.2;
  const steps = Math.ceil(totalSeconds / 0.05);
  for (let i = 0; i < steps; i++) pod.update(0.05);
}

describe('UpgradePod (105mm Howitzer Airdrop)', () => {
  it('warns, falls from orbit, impacts with slam FX, opens petals, and installs on held E on foot', () => {
    const env = makeEnv();
    const pod = new UpgradePod(env.ctx);
    const onInstalled = vi.fn();

    expect(pod.active).toBe(false);
    expect(pod.installed).toBe(false);

    pod.drop(new THREE.Vector3(20, 0, -50), { holdSeconds: 1.4, onInstalled });
    expect(pod.active).toBe(true);
    expect(pod.phase).toBe('warning');
    expect(env.markers).toContain('105MM HOWITZER POD');

    advancePodToOpen(pod);

    expect(pod.phase).toBe('open');
    expect(pod.doorAngle).toBeCloseTo(UPGRADE_POD.doorOpenAngle, 2);
    expect(env.sounds).toContain('explosion_debris');
    expect(env.sounds).toContain('cache_open');

    // Out of on-foot reach (10 m away): holding E should not progress.
    env.player.position.set(30, 0, -50);
    env.setInteract(true);
    pod.update(0.5);
    expect(pod.progress).toBe(0);

    // Move within 5 m on foot: prompt appears, holding E fills progress over 1.4 s.
    env.player.position.set(23, 0, -50);
    pod.update(0.7);
    expect(env.prompts.some(p => p.includes('INSTALL 105MM HOWITZER'))).toBe(true);
    expect(pod.progress).toBeCloseTo(0.5, 2);
    expect(env.holds[env.holds.length - 1]).toBeCloseTo(0.5, 2);

    // Releasing E partway resets hold progress.
    env.setInteract(false);
    pod.update(0.1);
    expect(pod.progress).toBe(0);

    // Hold E all the way to 100%.
    env.setInteract(true);
    for (let i = 0; i < 15; i++) pod.update(0.1);

    expect(pod.installed).toBe(true);
    expect(pod.active).toBe(false);
    expect(pod.phase).toBe('installed');
    expect(onInstalled).toHaveBeenCalledTimes(1);
    expect(env.signals).toContain('upgrade:howitzer');
    expect(env.feeds).toContain('105MM HOWITZER MODULE INSTALLED');
    expect(env.holds[env.holds.length - 1]).toBe(1);

    pod.dispose();
  });

  it('allows Press-and-Hold E installation while seated inside the Frame within 9.5 m', () => {
    const env = makeEnv();
    const pod = new UpgradePod(env.ctx);
    const onInstalled = vi.fn();

    pod.drop(new THREE.Vector3(0, 0, 0), { holdSeconds: 1.0, onInstalled });
    advancePodToOpen(pod);

    // Seated inside the Distraint Frame (parked=true, elevated cockpit at y=3.5, 8.5 m horizontal distance).
    env.player.parked = true;
    env.player.position.set(8.5, 3.5, 0);
    env.setInteract(true);

    for (let i = 0; i < 12; i++) pod.update(0.1);

    expect(pod.installed).toBe(true);
    expect(onInstalled).toHaveBeenCalledTimes(1);
    expect(env.signals).toContain('upgrade:howitzer');

    // Reset clears installation state cleanly.
    pod.reset();
    expect(pod.installed).toBe(false);
    expect(pod.active).toBe(false);
    expect(pod.phase).toBe('idle');

    pod.dispose();
  });
});
