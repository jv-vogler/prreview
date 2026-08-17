import type { FileDiff } from "../../domain/changeset/FileDiff";
import { NUD_GLOBAL_LINE_CAP, NUD_PER_FILE_LINE_CAP } from "./limits";

export interface IncludedFile {
	file: FileDiff;
	/**
	 * present when the file exceeds the per-file cap: the serializer emits
	 * exactly this many changed lines, then the literal cut marker telling the
	 * agent to Read the file in the workspace for the rest
	 */
	cutAtChangedLines?: number;
}

export interface TruncatedFiles {
	/** rendered as numbered diff lines, in the changeset's original file order */
	included: IncludedFile[];
	/** generated files: collapsed to a one-line stat entry in the file list */
	statOnly: FileDiff[];
	/** dropped by the global cap: listed with per-file stats, marked `not shown` */
	truncated: FileDiff[];
}

/**
 * The §7 truncation policy, pure over the round's FileDiff[]. Generated files
 * never spend budget (they collapse to stats); everything else is admitted
 * against a global soft cap of NUD_GLOBAL_LINE_CAP changed lines in priority
 * order — non-test source files first, then tests — where each file costs
 * min(changed lines, NUD_PER_FILE_LINE_CAP). The cap is soft: a file is
 * admitted whenever the budget is not yet exhausted, so the total may overshoot
 * by at most one capped file. Priority decides only *which* files make it;
 * `included` keeps the original order so the agent reads the diff as laid out.
 */
export function truncate(files: readonly FileDiff[]): TruncatedFiles {
	const statOnly = files.filter((file) => file.isGenerated);
	const budgetCandidates = files.filter((file) => !file.isGenerated);
	const byPriority = [
		...budgetCandidates.filter((file) => !isTestPath(file.path)),
		...budgetCandidates.filter((file) => isTestPath(file.path)),
	];

	const admitted = new Set<FileDiff>();
	let spentChangedLines = 0;
	for (const file of byPriority) {
		if (spentChangedLines >= NUD_GLOBAL_LINE_CAP) {
			continue;
		}
		admitted.add(file);
		spentChangedLines += Math.min(changedLines(file), NUD_PER_FILE_LINE_CAP);
	}

	return {
		included: files
			.filter((file) => admitted.has(file))
			.map((file) =>
				changedLines(file) > NUD_PER_FILE_LINE_CAP
					? { file, cutAtChangedLines: NUD_PER_FILE_LINE_CAP }
					: { file },
			),
		statOnly,
		truncated: budgetCandidates.filter((file) => !admitted.has(file)),
	};
}

function changedLines(file: FileDiff): number {
	return file.additions + file.deletions;
}

const TEST_DIRECTORY_NAMES = new Set([
	"test",
	"tests",
	"__tests__",
	"spec",
	"e2e",
]);
const TEST_BASENAME_PATTERN = /\.(test|spec)\.[^.]+$|_test\.[^.]+$/;

function isTestPath(path: string): boolean {
	const segments = path.split("/");
	const basename = segments[segments.length - 1] ?? "";
	if (TEST_BASENAME_PATTERN.test(basename)) {
		return true;
	}
	return segments
		.slice(0, -1)
		.some((segment) => TEST_DIRECTORY_NAMES.has(segment));
}
