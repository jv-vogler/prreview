export type ChangesetSource =
	| { kind: "pr"; repo: string; number: number }
	| { kind: "branch"; branch: string; base: string }
	| { kind: "range"; from: string; to: string }
	| { kind: "worktree" };
