import type { ChangesetSource } from "./ChangesetSource";

export type ChangesetId = string;

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
