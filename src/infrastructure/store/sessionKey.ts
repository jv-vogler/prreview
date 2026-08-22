import type { ChangesetId } from "../../domain/changeset/ChangesetId";

const FALLBACK_KEY = "session";

/**
 * Filesystem-safe directory name for one session. `"pr:acme/api#482"` →
 * `"pr-acme-api-482"`, `"worktree"` stays `"worktree"`. Distinct ids whose
 * punctuation collapses identically would share a key; accepted — sessions
 * are per-checkout and short-lived.
 */
export function sessionKeyFor(changesetId: ChangesetId): string {
	const slug = changesetId
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return slug === "" ? FALLBACK_KEY : slug;
}
