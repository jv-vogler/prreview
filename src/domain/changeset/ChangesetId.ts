import type { ChangesetSource } from "./ChangesetSource";

/** "pr:acme/api#482" | "branch:feat-x..main" | "range:a1b2c3..d4e5f6" | "worktree" */
export type ChangesetId = string;

/** Sessions are keyed by this. */
export function changesetIdFor(source: ChangesetSource): ChangesetId {
	switch (source.kind) {
		case "pr":
			return `pr:${source.repo}#${source.number}`;
		case "branch":
			return `branch:${source.branch}..${source.base}`;
		case "range":
			return `range:${source.from}..${source.to}`;
		case "worktree":
			return "worktree";
	}
}
