/** Identity of what is being reviewed. */
export type ChangesetSource =
	| { kind: "pr"; repo: string; number: number }
	| { kind: "branch"; branch: string; base: string }
	| { kind: "range"; from: string; to: string }
	// staged + unstaged together
	| { kind: "worktree" };
