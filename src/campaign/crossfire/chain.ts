/**
 * Multi-Map Chain State & Diegetic Seat-Transfer Curtain for the 4-Part "Crossfire" Campaign
 * (`Form 7742-W: Cross-Border Liability Transfer`).
 *
 * Persists mission continuity across page transitions (Valken Airbase -> The Strait ->
 * Fortress Halcyon -> Strait Dusk Egress) in `sessionStorage` under `'op2.crossfire.chain'`,
 * preserves dev/unlock query flags via `contractSearch()`, and stays 100% Node/Vitest-safe.
 */
import type { ContractId } from '../../contracts/data';
import { contractSearch } from '../../contracts/select';
import { allowPageNavigation } from '../../input';

export const CROSSFIRE_CHAIN_KEY = 'op2.crossfire.chain';

export const CROSSFIRE_DEFAULT_LANCER_MAX_HP = 7500;
export const CROSSFIRE_CURTAIN_HOLD_MS = 1400;

export type CrossfirePart = 1 | 2 | 3 | 4;
export type CrossfireContractor = 'A' | 'B';

export const CROSSFIRE_PART_CONTRACTS = {
  1: 'crossfire',
  2: 'crossfire_strait',
  3: 'crossfire_halcyon',
  4: 'crossfire_return',
} as const;

export type CrossfireContractId = (typeof CROSSFIRE_PART_CONTRACTS)[CrossfirePart];

export interface CrossfireChainState {
  active: boolean;
  part: CrossfirePart;
  lancerHp: number;
  lancerMaxHp: number;
  score: number;
  kills: number;
  elapsed: number;
  deaths: number;
  contractor: CrossfireContractor;
  startedAt: number;
}

/**
 * Authoritative registry of every `cf.*` mission director call invoked across all 4 Crossfire
 * mission scripts. The runtime Crossfire director wires every entry in this table.
 */
export const CROSSFIRE_CALL_DOCS = {
  // Part 1 — Valken Airbase (`crossfireAirbase.ts`)
  'cf.airbaseInit': 'Initialize Part 1 chain state, dawn airbase staging convoy (2 Jackals, 1 Aegis MBT, staging carriers), Viper-2/3 wingmen, parked F-22 Raptors, satchel breach charge, and locked B-1B Lancer.',
  'cf.airbaseBreach': 'Detonate the South Radar Gate satchel breach charge and open the south_gate lane so friendly technicals, Aegis tank, and assault infantry surge into Valken Airbase.',
  'cf.apronFuelWatch': 'Mark and watch JP-8 fuel depots on the Fuel Apron; triggers 3-stage pipeline chain detonation, blows the Inner Blast Gate open, releases friendly armor, and signals `cf:fuel_blown`.',
  'cf.atcConsole': 'Arm the interactive Hangar Override & IFF Spoof Console at ATC Level 3 (`AIRBASE_ATC_CONSOLE`); signals `cf:atc_override_done`.',
  'cf.buddyRaptorsBoard': 'Order essential Viper-2 and Viper-3 wingmen to sprint to parked F-22 Raptors, board cockpits, and spool engines; signals `cf:raptors_spooled`.',
  'cf.lancerReady': 'Unlock the 28.2 m B-1B Lancer in the Alert Hangar for player boarding and runway takeoff; signals `cf:lancer_boarded` and `cf:lancer_airborne`.',
  'cf.buddyRaptorsTakeoff': 'Launch both AI buddy F-22 Raptors off Runway 01/19 to hold overhead escort until the player rotates.',
  'cf.airbaseEscapeCutscene': 'Stage the 3-ship B-1B Lancer + twin F-22 Raptor formation climb-out cutscene so Darrow and Council finish dialogue cleanly before Strait handoff.',
  'cf.handoffToStrait': 'Persist Part 1 stats and transfer Contractor A -> Contractor B into `crossfire_strait`.',

  // Part 2 — Open-Sea Strait Outbound (`crossfireStrait.ts`)
  'cf.straitOutboundInit': 'Spawn Contractor B in the F-22 Raptor, spawn the 7,500 HP AI B-1B Lancer on `STRAIT_OUTBOUND_LANCER_PATH`, and launch escort wingmen.',
  'cf.straitWave': 'Spawn a named air-intercept wave (`outbound_probe`, `destroyer_strike`, `coastal_aces`, `return_ambush`, `return_final`); signals `cf:wave_cleared_<arg>`.',
  'cf.straitDestroyersHot': 'Activate SeaRAM SAMs and CIWS on `SNS Ironclad` and `SNS Bastion`; signals `cf:destroyers_suppressed` and `cf:lancer_midstrait`.',
  'cf.straitFeetDryWatch': 'Watch the B-1B Lancer crossing `STRAIT_FEET_DRY_Z` at Halcyon coast; signals `cf:strait_feet_dry`.',
  'cf.handoffToHalcyon': 'Persist surviving Lancer HP and transfer Contractor B -> Contractor A into `crossfire_halcyon`.',

  // Part 3 — Fortress Halcyon Combined-Arms War (`crossfireHalcyon.ts`)
  'cf.halcyonInit': 'Spawn Contractor A in the overhauled 4-mode B-1B Lancer over Halcyon, deploy Mercer beachhead armor/infantry, F-22 escorts, and initial Halcyon flak/CAP.',
  'cf.halcyonBreachWatch': 'Monitor Section B blast wall and outer flak bastions; unblock NavGraph breach lanes and signal `cf:halcyon_breached`.',
  'cf.halcyonArmorPush': 'Send Mercer tanks and APCs through the breach while activating Halcyon mortar trenches and SAM batteries; signals `cf:halcyon_ridge_clear`.',
  'cf.halcyonValkyrieDrop': 'Send allied fast-rope Valkyrie choppers into inner fortress LZs (`lz_inner_west`, `lz_inner_east`) once mortars/SAMs fall.',
  'cf.halcyonWarMachine': 'Unleash enemy tank armor rollouts, hangar scrambles, and full facility destruction tracking across Halcyon; signals `cf:halcyon_war_broken`.',
  'cf.halcyonCitadelSiege': 'Lock Tier-3 Reinforced Command HQ (`citadel_command_hq`) as primary thermobaric target while Mercer storms the plaza; signals `cf:halcyon_hq_destroyed`.',
  'cf.halcyonLeveled': 'Trigger Halcyon devastation shockwave and ordnance-low Lancer sea egress; signals `cf:halcyon_egress_ready`.',
  'cf.handoffToReturn': 'Persist battle-damaged Lancer HP and transfer Contractor A -> Contractor B into `crossfire_return`.',

  // Part 4 — Strait Dusk Egress (`crossfireReturn.ts`)
  'cf.straitReturnInit': 'Set dusk atmosphere, spawn Contractor B in F-22 Raptor, and spawn the smoking AI B-1B Lancer sprinting south along `STRAIT_INBOUND_LANCER_PATH`.',
  'cf.straitCarrierUmbrella': 'Activate CVN-91 and escort frigate CIWS/SAM umbrella as the Lancer approaches `STRAIT_CARRIER_RECOVERY_Z`; signals `cf:lancer_recovered`.',
  'cf.crossfireDebrief': 'Run carrier flyby debrief camera, record full 4-part Crossfire completion, and clear `sessionStorage` chain state.',
} as const;

export type CrossfireCallName = keyof typeof CROSSFIRE_CALL_DOCS;

/** Set of all documented `cf.*` director call names for runtime binding & test verification. */
export const CROSSFIRE_CALLS: ReadonlySet<string> = new Set<string>(Object.keys(CROSSFIRE_CALL_DOCS));

/** Documented `cf:*` campaign signals raised by the Crossfire runtime director. */
export const CROSSFIRE_SIGNALS = {
  // Part 1
  fuelBlown: 'cf:fuel_blown',
  atcOverrideDone: 'cf:atc_override_done',
  raptorsSpooled: 'cf:raptors_spooled',
  lancerBoarded: 'cf:lancer_boarded',
  lancerAirborne: 'cf:lancer_airborne',
  // Part 2
  waveClearedOutboundProbe: 'cf:wave_cleared_outbound_probe',
  waveClearedDestroyerStrike: 'cf:wave_cleared_destroyer_strike',
  waveClearedCoastalAces: 'cf:wave_cleared_coastal_aces',
  destroyersSuppressed: 'cf:destroyers_suppressed',
  lancerMidstrait: 'cf:lancer_midstrait',
  straitFeetDry: 'cf:strait_feet_dry',
  // Part 3
  halcyonBreached: 'cf:halcyon_breached',
  halcyonRidgeClear: 'cf:halcyon_ridge_clear',
  halcyonArmoryDown: 'cf:halcyon_armory_down',
  halcyonAirfieldDown: 'cf:halcyon_airfield_down',
  halcyonFuelDown: 'cf:halcyon_fuel_down',
  halcyonRadarDown: 'cf:halcyon_radar_down',
  halcyonWarBroken: 'cf:halcyon_war_broken',
  halcyonHqDestroyed: 'cf:halcyon_hq_destroyed',
  halcyonEgressReady: 'cf:halcyon_egress_ready',
  // Part 4
  waveClearedReturnAmbush: 'cf:wave_cleared_return_ambush',
  waveClearedReturnFinal: 'cf:wave_cleared_return_final',
  lancerRecovered: 'cf:lancer_recovered',
} as const;

export function createInitialChainState(overrides: Partial<CrossfireChainState> = {}): CrossfireChainState {
  const maxHp = overrides.lancerMaxHp ?? CROSSFIRE_DEFAULT_LANCER_MAX_HP;
  return {
    active: true,
    part: 1,
    lancerHp: overrides.lancerHp ?? maxHp,
    lancerMaxHp: maxHp,
    score: 0,
    kills: 0,
    elapsed: 0,
    deaths: 0,
    contractor: 'A',
    startedAt: Date.now(),
    ...overrides,
  };
}

function isValidPart(v: unknown): v is CrossfirePart {
  return v === 1 || v === 2 || v === 3 || v === 4;
}

function isValidContractor(v: unknown): v is CrossfireContractor {
  return v === 'A' || v === 'B';
}

function isFiniteNonNeg(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}

function hasSessionStorage(): boolean {
  return typeof sessionStorage !== 'undefined' && sessionStorage !== null;
}

/** Persist the Crossfire multi-map chain state to `sessionStorage`. Safe in Node/Vitest. */
export function saveChainState(state: CrossfireChainState): void {
  if (!hasSessionStorage()) return;
  try {
    sessionStorage.setItem(CROSSFIRE_CHAIN_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage quota or restricted-context errors.
  }
}

/** Load and validate the Crossfire chain state from `sessionStorage`, or `null` if absent/corrupt. */
export function loadChainState(): CrossfireChainState | null {
  if (!hasSessionStorage()) return null;
  try {
    const raw = sessionStorage.getItem(CROSSFIRE_CHAIN_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const obj = parsed as Record<string, unknown>;
    if (
      typeof obj.active !== 'boolean'
      || !isValidPart(obj.part)
      || !isFiniteNonNeg(obj.lancerHp)
      || !isFiniteNonNeg(obj.lancerMaxHp)
      || obj.lancerMaxHp <= 0
      || !isFiniteNonNeg(obj.score)
      || !isFiniteNonNeg(obj.kills)
      || !isFiniteNonNeg(obj.elapsed)
      || !isFiniteNonNeg(obj.deaths)
      || !isValidContractor(obj.contractor)
      || !isFiniteNonNeg(obj.startedAt)
    ) {
      return null;
    }
    return {
      active: obj.active,
      part: obj.part,
      lancerHp: Math.min(obj.lancerHp, obj.lancerMaxHp),
      lancerMaxHp: obj.lancerMaxHp,
      score: obj.score,
      kills: obj.kills,
      elapsed: obj.elapsed,
      deaths: obj.deaths,
      contractor: obj.contractor,
      startedAt: obj.startedAt,
    };
  } catch {
    return null;
  }
}

/** Merge a partial update onto the current chain state (or create a fresh one) and save it. */
export function patchChainState(patch: Partial<CrossfireChainState>): CrossfireChainState {
  const base = loadChainState() ?? createInitialChainState();
  const lancerMaxHp = patch.lancerMaxHp ?? base.lancerMaxHp;
  const rawHp = patch.lancerHp ?? base.lancerHp;
  const next: CrossfireChainState = {
    ...base,
    ...patch,
    lancerMaxHp,
    lancerHp: Math.max(0, Math.min(lancerMaxHp, rawHp)),
  };
  saveChainState(next);
  return next;
}

/** Clear the Crossfire chain state from `sessionStorage`. Safe in Node/Vitest. */
export function clearChainState(): void {
  if (!hasSessionStorage()) return;
  try {
    sessionStorage.removeItem(CROSSFIRE_CHAIN_KEY);
  } catch {
    // Ignore restricted-context errors.
  }
}

/**
 * Compute the navigation query string for `nextContractId`, preserving `?dev=1`, `?unlock=1`, etc.
 * via `contractSearch()`.
 */
export function buildCrossfireSearch(nextContractId: string, currentSearch?: string): string {
  const from = currentSearch ?? (typeof location !== 'undefined' ? location.search : '');
  const next = new URLSearchParams(contractSearch(nextContractId as ContractId, from));
  next.delete('custom');
  return `?${next.toString()}`;
}

export interface CrossfireTransitionOptions {
  /** Override curtain hold duration in ms (defaults to `CROSSFIRE_CURTAIN_HOLD_MS` = 1400 ms). */
  holdMs?: number;
  /** Optional subtitle telemetry line rendered below the main seat-transfer headline. */
  sublabel?: string;
}

const CURTAIN_ID = 'op2-crossfire-handoff-curtain';
let transitioning = false;

function renderHandoffCurtain(
  label: string,
  state: CrossfireChainState,
  holdMs: number,
  sublabel?: string,
): HTMLElement | null {
  if (typeof document === 'undefined' || !document.body) return null;

  document.getElementById(CURTAIN_ID)?.remove();

  const hullPct = Math.round((state.lancerHp / Math.max(1, state.lancerMaxHp)) * 100);
  const seatCode = state.contractor === 'A' ? '#7712-A (B-1B LANCER)' : '#7712-B (F-22 RAPTOR)';

  const root = document.createElement('div');
  root.id = CURTAIN_ID;
  root.setAttribute('role', 'status');
  root.setAttribute('aria-live', 'assertive');
  Object.assign(root.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '999999',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '32px',
    background:
      'radial-gradient(ellipse at 50% 42%, rgba(28, 38, 52, 0.96) 0%, rgba(8, 12, 18, 0.99) 74%), '
      + 'repeating-linear-gradient(0deg, rgba(255,255,255,0.025) 0px, rgba(255,255,255,0.025) 1px, transparent 1px, transparent 3px)',
    color: '#e8eef5',
    fontFamily: '"JetBrains Mono", "Fira Code", ui-monospace, SFMono-Regular, Menlo, monospace',
    letterSpacing: '0.08em',
    opacity: '0',
    transition: 'opacity 220ms ease-out',
    pointerEvents: 'all',
    userSelect: 'none',
  });

  const panel = document.createElement('div');
  Object.assign(panel.style, {
    width: 'min(760px, 92vw)',
    border: '1px solid rgba(244, 178, 56, 0.45)',
    borderTop: '3px solid #f4b238',
    background: 'rgba(10, 15, 22, 0.88)',
    boxShadow: '0 24px 80px rgba(0, 0, 0, 0.72), inset 0 0 32px rgba(244, 178, 56, 0.06)',
    padding: '28px 32px',
  });

  const kicker = document.createElement('div');
  kicker.textContent = `BUREAU NEURAL-SEAT HANDOFF // FORM 7742-W // PART 0${state.part} OF 04`;
  Object.assign(kicker.style, {
    fontSize: '11px',
    color: '#f4b238',
    letterSpacing: '0.18em',
    marginBottom: '12px',
    textTransform: 'uppercase',
  });

  const headline = document.createElement('div');
  headline.textContent = label;
  Object.assign(headline.style, {
    fontSize: 'clamp(16px, 2.2vw, 22px)',
    fontWeight: '700',
    color: '#ffffff',
    lineHeight: '1.35',
    marginBottom: '10px',
  });

  const sub = document.createElement('div');
  sub.textContent = sublabel ?? 'SPOOFED NORTHERN IFF LOCKED · TRANSFERRING FLIGHT CORRIDOR TELEMETRY';
  Object.assign(sub.style, {
    fontSize: '12px',
    color: '#8fa6bf',
    marginBottom: '22px',
  });

  const barTrack = document.createElement('div');
  Object.assign(barTrack.style, {
    width: '100%',
    height: '6px',
    background: 'rgba(255, 255, 255, 0.08)',
    border: '1px solid rgba(255, 255, 255, 0.14)',
    overflow: 'hidden',
    marginBottom: '18px',
  });

  const barFill = document.createElement('div');
  Object.assign(barFill.style, {
    width: '0%',
    height: '100%',
    background: 'linear-gradient(90deg, #e08e1b 0%, #ffd25a 65%, #7de8ff 100%)',
    boxShadow: '0 0 14px rgba(244, 178, 56, 0.75)',
    transition: `width ${Math.max(200, holdMs - 140)}ms cubic-bezier(0.22, 0.61, 0.36, 1)`,
  });
  barTrack.appendChild(barFill);

  const telemetry = document.createElement('div');
  Object.assign(telemetry.style, {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: '12px',
    fontSize: '11px',
    color: '#b4c6d8',
    borderTop: '1px solid rgba(255, 255, 255, 0.1)',
    paddingTop: '14px',
  });

  const cells: readonly [string, string][] = [
    ['ACTIVE SEAT', seatCode],
    ['B-1B LANCER HULL', `${hullPct}% (${Math.round(state.lancerHp)} / ${Math.round(state.lancerMaxHp)})`],
    ['CONTRACT LEDGER', `${state.kills} KIA · ${state.score.toLocaleString()} PTS`],
  ];
  for (const [k, v] of cells) {
    const cell = document.createElement('div');
    const lbl = document.createElement('div');
    lbl.textContent = k;
    Object.assign(lbl.style, { fontSize: '10px', color: '#6b8299', marginBottom: '4px' });
    const val = document.createElement('div');
    val.textContent = v;
    Object.assign(val.style, { color: '#e8eef5', fontWeight: '600' });
    cell.appendChild(lbl);
    cell.appendChild(val);
    telemetry.appendChild(cell);
  }

  panel.appendChild(kicker);
  panel.appendChild(headline);
  panel.appendChild(sub);
  panel.appendChild(barTrack);
  panel.appendChild(telemetry);
  root.appendChild(panel);
  document.body.appendChild(root);

  // Trigger CSS fade-in and progress sweep on the next animation frame.
  const startAnim = (): void => {
    root.style.opacity = '1';
    barFill.style.width = '100%';
  };
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => requestAnimationFrame(startAnim));
  } else {
    startAnim();
  }

  return root;
}

/**
 * Save chain state, display the diegetic Bureau Neural-Seat Handoff Curtain for 1.4 s,
 * and navigate cleanly to `nextContractId` via `location.assign(contractSearch(...))`.
 *
 * Safe to call in headless Node/Vitest environments (persists state and resolves without DOM/location errors).
 */
export async function transitionToCrossfirePart(
  nextContractId: string,
  patch: Partial<CrossfireChainState>,
  label: string,
  options: CrossfireTransitionOptions = {},
): Promise<string> {
  const nextState = patchChainState({ active: true, ...patch });
  const targetSearch = buildCrossfireSearch(nextContractId);

  if (typeof location === 'undefined') {
    return targetSearch;
  }

  if (transitioning) return targetSearch;
  transitioning = true;

  const holdMs = options.holdMs ?? CROSSFIRE_CURTAIN_HOLD_MS;
  try {
    renderHandoffCurtain(label, nextState, holdMs, options.sublabel);
    if (holdMs > 0) {
      await new Promise<void>(resolve => {
        setTimeout(resolve, holdMs);
      });
    }
    allowPageNavigation(true);
    location.assign(targetSearch);
  } finally {
    transitioning = false;
  }
  return targetSearch;
}
