import type { BlobRef } from "../../domain/changeset/BlobRef";
import type { FileDiff } from "../../domain/changeset/FileDiff";
import { isDeleted } from "../finding/curation";
import { findingIdAt } from "../finding/findingId";
import type { ReviewFinding } from "./reviewSchema";
import type { ReviewCheckpoint, StoredReview } from "./StoredReview";

/**
 * What a re-review may take from the pass before it instead of paying for it
 * again. Every rule here is mechanical: blob identity says which files are
 * the same diff byte for byte, and a finding anchored in one of those files
 * needs no re-anchoring, because its hunks and line numbers have not moved.
 *
 * What blob identity cannot say is whether a change somewhere else resolved
 * a finding. That is why `dependsOn` exists, why a finding that names
 * nothing is always re-checked, and why a finding carried without a
 * re-check is marked as such rather than presented as freshly verified.
 */

/** The changeset as it stands now, against which the checkpoint is read. */
export interface CurrentDiff {
	baseSha: string;
	files: readonly FileDiff[];
}

export interface CarriedFinding {
	id: string;
	finding: ReviewFinding;
	/** the files this finding leaned on that have moved since it was written */
	movedDependencies: string[];
	/** the pass recorded nothing this finding leaned on, so nothing vouches for it */
	unrecorded: boolean;
	/** true when either of the two above is true */
	recheck: boolean;
}

export interface ReusePlan {
	/** same `(oldOid, newOid)` as the checkpoint: the same diff, byte for byte */
	unchanged: FileDiff[];
	changed: FileDiff[];
	added: FileDiff[];
	/** paths the checkpoint had that this changeset no longer does */
	removed: string[];
	baseMoved: boolean;
	/** findings on unchanged files that the reader has not dismissed */
	carried: CarriedFinding[];
	/** the subset of `carried` the agent has to look at again */
	recheck: CarriedFinding[];
}

/**
 * What a pass records so a later one can say what has moved: the same blob
 * identity `planReuse` reads back, written by the only module that knows
 * what it means.
 */
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
		// the reader removed it on purpose; carrying it would put it back
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
