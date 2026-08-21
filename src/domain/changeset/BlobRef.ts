/** File content is never inlined in the IR; it is referenced. */
export type BlobRef =
	// read via git cat-file
	| { kind: "odb"; oid: string }
	// oid from git hash-object = staleness check
	| { kind: "worktree"; path: string; oid: string }
	// .prreview/blobs/<oid>, content-addressed
	| { kind: "stored"; oid: string };
