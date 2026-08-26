export type BlobRef =
	| { kind: "odb"; oid: string }
	| { kind: "worktree"; path: string; oid: string }
	| { kind: "stored"; oid: string };
