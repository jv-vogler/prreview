import type { BlobRef } from "../../domain/changeset/BlobRef";
import type { FileDiff } from "../../domain/changeset/FileDiff";
import { isDeleted } from "../finding/curation";
import { findingIdAt } from "../finding/findingId";
import type { ReviewFinding } from "./ReviewPass";
import type { ReviewCheckpoint, StoredReview } from "./StoredReview";

export interface CurrentDiff {
	baseSha: string;
	files: readonly FileDiff[];
}

export interface CarriedFinding {
	id: string;
	finding: ReviewFinding;
	movedDependencies: string[];
	unrecorded: boolean;
	recheck: boolean;
}

export interface ReusePlan {
	unchanged: FileDiff[];
	changed: FileDiff[];
	added: FileDiff[];
	removed: string[];
	baseMoved: boolean;
	carried: CarriedFinding[];
	recheck: CarriedFinding[];
}

export function checkpointOf(
	current: CurrentDiff,
	headSha: string | null,
): ReviewCheckpoint {
	return {
		baseSha: current.baseSha,
		headSha,
		files: current.files.map((file) => ({
			path: file.path,
			oldOid: oidOf(file.oldBlob),
			newOid: oidOf(file.newBlob),
		})),
	};
}

export function planReuse(
	checkpoint: ReviewCheckpoint,
	current: CurrentDiff,
	stored: StoredReview,
): ReusePlan {
	const before = new Map(checkpoint.files.map((file) => [file.path, file]));
	const unchanged: FileDiff[] = [];
	const changed: FileDiff[] = [];
	const added: FileDiff[] = [];

	for (const file of current.files) {
		const was = before.get(file.path);
		if (was === undefined) {
			added.push(file);
		} else if (
			was.oldOid === oidOf(file.oldBlob) &&
			was.newOid === oidOf(file.newBlob)
		) {
			unchanged.push(file);
		} else {
			changed.push(file);
		}
	}

	const present = new Set(current.files.map((file) => file.path));
	const removed = checkpoint.files
		.map((file) => file.path)
		.filter((path) => !present.has(path));
	const moved = new Set([
		...changed.map((file) => file.path),
		...added.map((file) => file.path),
		...removed,
	]);
	const unchangedPaths = new Set(unchanged.map((file) => file.path));

	const carried = stored.pass.findings
		.map((finding, index) => toCarried(finding, index, stored, moved))
		.filter(
			(candidate): candidate is CarriedFinding =>
				candidate !== null && unchangedPaths.has(candidate.finding.path),
		);

	return {
		unchanged,
		changed,
		added,
		removed,
		baseMoved: checkpoint.baseSha !== current.baseSha,
		carried,
		recheck: carried.filter((candidate) => candidate.recheck),
	};
}

function toCarried(
	finding: ReviewFinding,
	index: number,
	stored: StoredReview,
	moved: ReadonlySet<string>,
): CarriedFinding | null {
	const id = findingIdAt(stored, index);
	if (isDeleted(stored.findingEdits[id])) {
		return null;
	}
	const movedDependencies = (finding.dependsOn ?? []).filter((path) =>
		moved.has(path),
	);
	const unrecorded = finding.dependsOn === undefined;
	return {
		id,
		finding,
		movedDependencies,
		unrecorded,
		recheck: unrecorded || movedDependencies.length > 0,
	};
}

function oidOf(blob: BlobRef | null): string | null {
	return blob === null ? null : blob.oid;
}
