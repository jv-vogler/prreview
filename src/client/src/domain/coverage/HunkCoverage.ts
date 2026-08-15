/**
 * Client mirror of the server's coverage state (ARCHITECTURE §9): absent from
 * a record means "unseen"; transitions only move rightward. Re-declared here
 * because the client may import nothing of the server but the dto folder
 * (CON-002) — drift would surface in the mirrored tests.
 */
export type HunkCoverage = "unseen" | "viewed" | "reviewed";
