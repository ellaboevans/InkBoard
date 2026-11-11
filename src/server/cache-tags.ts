/**
 * Cache tags shared by the public board (readers) and admin mutations.
 * Phase 3's cached board data uses `cacheTag(BOARD_TAG)`; every mutation that
 * changes what readers can see must call `updateTag(BOARD_TAG)`.
 */
export const BOARD_TAG = "board";
export const poemTag = (poemId: string) => `poem:${poemId}`;
