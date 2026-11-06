/**
 * The size of everything the player has to clear. A map builder takes these numbers, not their own: parkour.test.ts puts each one in
 * real Rapier under the real Player, and fails if the move it teaches stops working, or if a lesser one starts to.
 */
export const PARKOUR = {
  /** The LZ cut. One jump and a hold of forward. Plain jumping, single or double, does not clear it. */
  mantle: { ledge: 3 },
  /** The wreck's deck. One jump does not reach. A double jump gets the hands to the edge. */
  doubleJump: { ledge: 4.2 },
  /** The citadel's blast door. It is low enough to stop a standing body before a run gets there, and a slide goes under. */
  slide: {
    doorHeight: 3.6,
    /** Fully open to fully shut. Quick enough that a run with both dashes still meets a leaf too low to stand under. */
    closeSeconds: 2.8,
    /** Metres of run from the door to the line that starts it closing. */
    triggerRange: 22,
  },
  /** The Coolant Hall. Double jump falls short. Double jump and one dash makes it. */
  dash: { gap: 18 },
  /**
   * The cable gallery. `headroom` is what does the work: the longest flights on foot are low and flat, and a ceiling this low takes
   * their arc away while a wall run never needs one. The wall starts at the lip, because a run begun earlier reaches less far.
   */
  wallRun: { gap: 22, headroom: 3, wallFromLip: 0, wallPast: 4, width: 7 },
} as const;
