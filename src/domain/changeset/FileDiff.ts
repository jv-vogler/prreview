import type { BlobRef } from "./BlobRef";
import type { Hunk } from "./Hunk";

export interface FileDiff {
	id: string;
	path: string;
	oldPath?: string;
	status:
		| "added"
		| "modified"
		| "deleted"
		| "renamed"
		| "copied"
		| "type-changed";
	additions: number;
	deletions: number;
	isBinary: boolean;
	isGenerated: boolean;
	language?: string;
	oldBlob: BlobRef | null;
	newBlob: BlobRef | null;
	hunks: Hunk[];
}
