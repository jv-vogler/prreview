/**
 * Reading state of one hunk, keyed by hunkId. Absent from the coverage record
 * means "unseen". Between the two seen states transitions only move rightward;
 * a deliberate return to `unseen` is allowed (applyHunkCoverage).
 */
export type HunkCoverage = "unseen" | "viewed" | "reviewed";
