/**
 * The size of everything the player has to clear. A map builder takes these numbers, not their own: parkour.test.ts puts each one in
 * real Rapier under the real Player, and fails if the move it teaches stops working, or if a lesser one starts to.
 */
export const PARKOUR = {
  /** The LZ cut. One jump with forward held. Running at it does nothing. */
  mantle: { ledge: 3 },
  /**
   * The wreck's deck. One jump does not reach, and two do, with forward held. From a stand at the hull, or from a run with the second
   * press made 5 m or more out: pressed any closer on a run, the second jump is a wall kick and throws the player off the hull.
   */
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
   * their arc away, so 22 m beats every jump and dash. A wall run with nothing added only makes it from the very lip. Leaving the wall
   * with a jump and jumping again makes it from anywhere in the last 8 m of the deck, which is what the level teaches.
   */
  wallRun: { gap: 22, headroom: 3, wallPast: 4, width: 7 },
} as const;
