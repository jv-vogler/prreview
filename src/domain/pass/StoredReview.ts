import type { ChangesetId } from "../changeset/ChangesetId";
import type { ReviewPass } from "./ReviewPass";

export interface FindingEdit {
	body?: string;
	deleted?: boolean;
}

export interface PublishedRecord {
	reviewId: number;
	htmlUrl: string;
	publishedAt: string;
	findingIds: string[];
}

export interface CheckpointFile {
	path: string;
	oldOid: string | null;
	newOid: string | null;
}

export interface ReviewCheckpoint {
	baseSha: string;
	headSha: string | null;
	files: CheckpointFile[];
}

export interface StoredReview {
	changesetId: ChangesetId;
	createdAt: string;
	headSha: string | null;
	pass: ReviewPass;
	residue: string[];
	findingEdits: Record<string, FindingEdit>;
	findingIds?: string[];
	nextFindingId?: number;
	carriedFindingIds?: string[];
	checkpoint?: ReviewCheckpoint;
	published: PublishedRecord | null;
}
