/** The finish palette every model draws from, so the arsenal reads as one manufacturer's work. */
import { Kind, type Finish } from './mesher';

export const F = {
  /** Hard-anodized receiver: dark, slightly blue, the default gun body. */
  anodized: { color: 0x34373d, rough: 0.46, metal: 0.3, wear: 0.85 },
  anodizedGrey: { color: 0x6a7078, rough: 0.5, metal: 0.25, wear: 0.9 },
  parkerized: { color: 0x3c3e41, rough: 0.6, metal: 0.35, wear: 0.8 },
  blued: { color: 0x1d2128, rough: 0.24, metal: 0.95, wear: 0.65 },
  steel: { color: 0x8d9299, rough: 0.34, metal: 1, wear: 0.15, kind: Kind.brushed },
  steelDark: { color: 0x4a4d52, rough: 0.42, metal: 1, wear: 0.3 },
  chrome: { color: 0xc9ccd1, rough: 0.14, metal: 1, wear: 0.05 },
  barrel: { color: 0x383a3e, rough: 0.36, metal: 1, wear: 0.4, heat: 1, kind: Kind.brushed },
  barrelBlack: { color: 0x1e1f22, rough: 0.5, metal: 0.9, wear: 0.5, heat: 1 },
  /** Interior of a bore or a port. */
  black: { color: 0x08090a, rough: 0.8, metal: 0.2, wear: 0 },
  polymer: { color: 0x26282c, rough: 0.55, metal: 0.02, wear: 0.3 },
  polymerGrey: { color: 0x474b52, rough: 0.6, metal: 0.02, wear: 0.4 },
  polymerStipple: { color: 0x2a2c31, rough: 0.8, metal: 0.02, wear: 0.2, kind: Kind.stipple },
  rubber: { color: 0x141517, rough: 0.86, metal: 0, wear: 0, kind: Kind.rubber },
  carbon: { color: 0x2a2c30, rough: 0.34, metal: 0.25, wear: 0.3, kind: Kind.carbon },
  brass: { color: 0xb08d4c, rough: 0.3, metal: 1, wear: 0.05 },
  copper: { color: 0xb5694a, rough: 0.34, metal: 1, wear: 0.05 },
  copperCoil: { color: 0xc9744a, rough: 0.28, metal: 1, wear: 0, kind: Kind.brushed },
  /** Military olive, for the launcher. */
  olive: { color: 0x3c4a33, rough: 0.6, metal: 0.05, wear: 1 },
  oliveDark: { color: 0x2a3326, rough: 0.64, metal: 0.05, wear: 1 },
  /** Industrial safety yellow, for the Stakegun's site-tool personality. */
  yellow: { color: 0xc2951f, rough: 0.5, metal: 0.05, wear: 1 },
  red: { color: 0x8a1712, rough: 0.46, metal: 0.05, wear: 0.9 },
  white: { color: 0xc7cbd0, rough: 0.5, metal: 0.05, wear: 0.9 },
  /** Fire-engine enamel on the Kiln's tanks. */
  enamelRed: { color: 0x7a1d17, rough: 0.28, metal: 0.1, wear: 1 },
  /** Combat sleeve. */
  fabric: { color: 0x3a4048, rough: 0.82, metal: 0, wear: 0, kind: Kind.fabric },
  fabricDark: { color: 0x262a30, rough: 0.86, metal: 0, wear: 0, kind: Kind.fabric },
  /** Glove body, palm reinforcement. */
  leather: { color: 0x25272b, rough: 0.5, metal: 0, wear: 0.1, kind: Kind.leather },
  leatherGrey: { color: 0x3e4249, rough: 0.56, metal: 0, wear: 0.15, kind: Kind.leather },
  webbing: { color: 0x1d1f23, rough: 0.8, metal: 0, wear: 0, kind: Kind.fabric },
  walnut: { color: 0x4a2d1c, rough: 0.42, metal: 0, wear: 0.15, kind: Kind.wood },
  walnutDark: { color: 0x2f1c12, rough: 0.46, metal: 0, wear: 0.15, kind: Kind.wood },
} as const satisfies Record<string, Finish>;
