/**
 * Reading state of one hunk, keyed by hunkId. Absent from the coverage record
 * means "unseen". Transitions only ever move rightward (upgradeHunkCoverage).
 */
export type HunkCoverage = "unseen" | "viewed" | "reviewed";
