import { diffLines } from "diff";
import type { LineIndex } from "../changeset/LineIndex";
import type { Anchor, AnchorStatus } from "./Anchor";
import { captureSnapshot } from "./captureSnapshot";
import { computePlacement } from "./computePlacement";
import { levenshteinRatio } from "./levenshteinRatio";
import { normalizeLine } from "./normalizeLine";

/** step 4 accepts a non-unique candidate only at this context score or above */
const EXACT_SEARCH_MIN_SCORE = 4;
/** …and only this far ahead of the runner-up */
const EXACT_SEARCH_MIN_MARGIN = 2;
/** step 5 searches this many lines around the predicted position */
const FUZZY_SEARCH_RADIUS = 40;
/** step 5 requires this similarity on both boundary lines */
const FUZZY_MIN_BOUNDARY_RATIO = 0.9;
const LINE_JOIN_SEPARATOR = "\n";

export interface ReanchorInput {
	anchor: Anchor;
	/** the anchored side's prior content, read back via `anchor.snapshot.blobOid` */
	oldLines: string[];
	/** the same file (rename-mapped by the caller) in the new round */
	newFile: { fileId: string; path: string; blobOid: string; lines: string[] };
	/** the new round's LineIndex for that file, for placement */
	newLineIndex: LineIndex;
}

export interface ReanchorResult {
	anchor: Anchor;
	status: AnchorStatus;
	/** true exactly when step 5 (fuzzy) landed the anchor (ARCHITECTURE §6) */
	touchedByDelta: boolean;
}

interface Candidate {
	startLine: number;
	score: number;
}

/**
 * The six-step re-anchoring algorithm of ARCHITECTURE §6, first hit wins:
 * (1) blob-oid identity, (2) exact position hash, (3) Myers diff shift,
 * (4) exact-content search scored by context, (5) fuzzy near the predicted
 * position, (6) orphaned — the anchor is kept as-is. Every landed anchor is
 * rebuilt against the new blob: identity from `newFile` (so renames update
 * path and fileId), snapshot recaptured, placement recomputed.
 */
export function reanchor(input: ReanchorInput): ReanchorResult {
	const { anchor, newFile } = input;

	// Step 1: blob-oid identity. Content unchanged, position unchanged; only
	// the file identity and placement can differ (pure rename, base-only delta).
	if (newFile.blobOid === anchor.snapshot.blobOid) {
		return landed(input, anchor.startLine, anchor.endLine, "anchored", false);
	}

	// A file-level anchor has no position to lose; it follows the file.
	const isFileLevel = anchor.startLine === 0 && anchor.endLine === 0;
	if (isFileLevel) {
		return landed(input, 0, 0, "anchored", false);
	}

	const newNormalized = newFile.lines.map(normalizeLine);
	const rangeLength = anchor.endLine - anchor.startLine + 1;
	const targetLines = anchor.snapshot.targetLines;

	// Step 2: exact position hash.
	const sameRangeInNewBlob = newNormalized.slice(
		anchor.startLine - 1,
		anchor.endLine,
	);
	if (
		anchor.endLine <= newFile.lines.length &&
		linesEqual(sameRangeInNewBlob, targetLines)
	) {
		return landed(input, anchor.startLine, anchor.endLine, "anchored", false);
	}

	// Step 3: diff shift. A target wholly inside an unchanged region of the
	// Myers diff translates by that region's offset — the 95% case.
	const regions = unchangedRegions(input.oldLines, newFile.lines);
	for (const region of regions) {
		const regionOldEnd = region.oldStart + region.lineCount - 1;
		if (anchor.startLine >= region.oldStart && anchor.endLine <= regionOldEnd) {
			const offset = region.newStart - region.oldStart;
			return landed(
				input,
				anchor.startLine + offset,
				anchor.endLine + offset,
				"moved",
				false,
			);
		}
	}

	const predictedStart = predictPosition(regions, anchor.startLine);

	// Step 4: exact-content search for moved code, scored by context, tie-broken
	// by predicted position. Refuses to guess between look-alikes: accepted only
	// when unique, or when clearly ahead of the runner-up.
	const exactCandidates = findExactCandidates(newNormalized, anchor.snapshot);
	orderCandidates(exactCandidates, predictedStart);
	const acceptedExact = acceptExactCandidate(exactCandidates);
	if (acceptedExact !== null) {
		return landed(
			input,
			acceptedExact.startLine,
			acceptedExact.startLine + rangeLength - 1,
			"moved",
			false,
		);
	}

	// Step 5: fuzzy within ±40 lines of the predicted position, requiring
	// normalized Levenshtein ≥ 0.9 on the boundary lines, scored by context.
	const fuzzyCandidates = findFuzzyCandidates(
		newNormalized,
		anchor.snapshot,
		predictedStart,
	);
	orderCandidates(fuzzyCandidates, predictedStart);
	const bestFuzzy = fuzzyCandidates[0];
	if (bestFuzzy !== undefined) {
		return landed(
			input,
			bestFuzzy.startLine,
			bestFuzzy.startLine + rangeLength - 1,
			"fuzzy",
			true,
		);
	}

	// Step 6: orphaned. The code is truly gone; the anchor is kept as-is.
	return { anchor, status: "orphaned", touchedByDelta: false };
}

function landed(
	input: ReanchorInput,
	startLine: number,
	endLine: number,
	status: AnchorStatus,
	touchedByDelta: boolean,
): ReanchorResult {
	const { anchor, newFile, newLineIndex } = input;
	return {
		anchor: {
			fileId: newFile.fileId,
			path: newFile.path,
			side: anchor.side,
			startLine,
			endLine,
			placement: computePlacement({
				side: anchor.side,
				startLine,
				endLine,
				lineIndex: newLineIndex,
				blobLineCount: newFile.lines.length,
			}),
			snapshot: captureSnapshot(
				newFile.lines,
				startLine,
				endLine,
				newFile.blobOid,
			),
		},
		status,
		touchedByDelta,
	};
}

function linesEqual(a: string[], b: string[]): boolean {
	return a.length === b.length && a.every((line, index) => line === b[index]);
}

interface UnchangedRegion {
	oldStart: number;
	newStart: number;
	lineCount: number;
}

function unchangedRegions(
	oldLines: string[],
	newLines: string[],
): UnchangedRegion[] {
	const changes = diffLines(
		oldLines.join(LINE_JOIN_SEPARATOR),
		newLines.join(LINE_JOIN_SEPARATOR),
	);
	const regions: UnchangedRegion[] = [];
	let oldPosition = 1;
	let newPosition = 1;
	for (const change of changes) {
		const lineCount = change.count ?? 0;
		if (change.added) {
			newPosition += lineCount;
			continue;
		}
		if (change.removed) {
			oldPosition += lineCount;
			continue;
		}
		regions.push({ oldStart: oldPosition, newStart: newPosition, lineCount });
		oldPosition += lineCount;
		newPosition += lineCount;
	}
	return regions;
}

/**
 * Where an old-blob line most plausibly sits in the new blob: exact for a
 * line inside an unchanged region, otherwise the new-side position of the
 * nearest unchanged region at or after it (where the deleted/edited block
 * used to be).
 */
function predictPosition(regions: UnchangedRegion[], oldLine: number): number {
	let prediction = 1;
	for (const region of regions) {
		const regionOldEnd = region.oldStart + region.lineCount - 1;
		if (oldLine < region.oldStart) {
			return region.newStart;
		}
		if (oldLine <= regionOldEnd) {
			return region.newStart + (oldLine - region.oldStart);
		}
		prediction = region.newStart + region.lineCount;
	}
	return prediction;
}

function findExactCandidates(
	newNormalized: string[],
	snapshot: Anchor["snapshot"],
): Candidate[] {
	const targetLines = snapshot.targetLines;
	const candidates: Candidate[] = [];
	const lastStart = newNormalized.length - targetLines.length + 1;
	for (let startLine = 1; startLine <= lastStart; startLine++) {
		const window = newNormalized.slice(
			startLine - 1,
			startLine - 1 + targetLines.length,
		);
		if (linesEqual(window, targetLines)) {
			candidates.push({
				startLine,
				score: contextScore(newNormalized, startLine, snapshot),
			});
		}
	}
	return candidates;
}

function findFuzzyCandidates(
	newNormalized: string[],
	snapshot: Anchor["snapshot"],
	predictedStart: number,
): Candidate[] {
	const targetLines = snapshot.targetLines;
	if (targetLines.length === 0) {
		return [];
	}
	const firstTargetLine = targetLines[0];
	const lastTargetLine = targetLines[targetLines.length - 1];
	const lastPossibleStart = newNormalized.length - targetLines.length + 1;
	const windowStart = Math.max(1, predictedStart - FUZZY_SEARCH_RADIUS);
	const windowEnd = Math.min(
		lastPossibleStart,
		predictedStart + FUZZY_SEARCH_RADIUS,
	);
	const candidates: Candidate[] = [];
	for (let startLine = windowStart; startLine <= windowEnd; startLine++) {
		const firstRatio = levenshteinRatio(
			firstTargetLine,
			newNormalized[startLine - 1],
		);
		if (firstRatio < FUZZY_MIN_BOUNDARY_RATIO) {
			continue;
		}
		const lastRatio = levenshteinRatio(
			lastTargetLine,
			newNormalized[startLine - 2 + targetLines.length],
		);
		if (lastRatio < FUZZY_MIN_BOUNDARY_RATIO) {
			continue;
		}
		candidates.push({
			startLine,
			score: contextScore(newNormalized, startLine, snapshot),
		});
	}
	return candidates;
}

/** score by matching context lines, up to 3 before and 3 after — max 6 */
function contextScore(
	newNormalized: string[],
	candidateStart: number,
	snapshot: Anchor["snapshot"],
): number {
	const { contextBefore, contextAfter, targetLines } = snapshot;
	let score = 0;
	for (let distance = 0; distance < contextBefore.length; distance++) {
		// contextBefore is in file order: its last entry sits just above the target
		const expected = contextBefore[contextBefore.length - 1 - distance];
		const actualIndex = candidateStart - 2 - distance;
		if (actualIndex >= 0 && newNormalized[actualIndex] === expected) {
			score++;
		}
	}
	for (let distance = 0; distance < contextAfter.length; distance++) {
		const actualIndex = candidateStart - 1 + targetLines.length + distance;
		if (
			actualIndex < newNormalized.length &&
			newNormalized[actualIndex] === contextAfter[distance]
		) {
			score++;
		}
	}
	return score;
}

/** highest score first, then closest to the predicted position, then earliest */
function orderCandidates(
	candidates: Candidate[],
	predictedStart: number,
): void {
	candidates.sort((a, b) => {
		if (a.score !== b.score) {
			return b.score - a.score;
		}
		const distanceA = Math.abs(a.startLine - predictedStart);
		const distanceB = Math.abs(b.startLine - predictedStart);
		if (distanceA !== distanceB) {
			return distanceA - distanceB;
		}
		return a.startLine - b.startLine;
	});
}

function acceptExactCandidate(candidates: Candidate[]): Candidate | null {
	const best = candidates[0];
	if (best === undefined) {
		return null;
	}
	if (candidates.length === 1) {
		return best;
	}
	const runnerUp = candidates[1];
	const clearlyAhead =
		best.score >= EXACT_SEARCH_MIN_SCORE &&
		best.score - runnerUp.score >= EXACT_SEARCH_MIN_MARGIN;
	return clearlyAhead ? best : null;
}
