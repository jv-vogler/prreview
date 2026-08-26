import type { ChangesetId } from "../../domain/changeset/ChangesetId";

const FALLBACK_KEY = "session";

export function sessionKeyFor(changesetId: ChangesetId): string {
	const slug = changesetId
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return slug === "" ? FALLBACK_KEY : slug;
}
