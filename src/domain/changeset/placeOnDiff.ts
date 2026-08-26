import type { FileDiff } from "../changeset/FileDiff";
import { buildLineIndex, type LineIndex } from "../changeset/LineIndex";

export type AnchorSide = "old" | "new";

export interface DiffTarget {
	path: string;
	startLine: number;
	endLine: number;
}

export type DiffPlacement =
	| { kind: "exact"; fileId: string; side: AnchorSide; line: number }
	| {
			kind: "clamped";
			fileId: string;
			side: AnchorSide;
			line: number;
			requestedStartLine: number;
			requestedEndLine: number;
	  }
	| { kind: "unplaceable" };

interface RenderableLine {
	side: AnchorSide;
	line: number;
}

export type DiffAnchor = "end" | "middle";

export function placeOnDiff(
	target: DiffTarget,
	files: readonly FileDiff[],
	anchor: DiffAnchor = "end",
): DiffPlacement {
	const file = files.find((candidate) => candidate.path === target.path);
	if (file === undefined) {
		return { kind: "unplaceable" };
	}

	const index = buildLineIndex(file);
	const renderableLines = collectRenderableLines(index);
	if (renderableLines.length === 0) {
		return { kind: "unplaceable" };
	}

	const anchorLine = anchor === "middle" ? middleLine(target) : target.endLine;

	const exactSide = exactSideFor(target, index);
	if (exactSide !== null) {
		return {
			kind: "exact",
			fileId: file.id,
			side: exactSide,
			line: anchorLine,
		};
	}

	const nearest = nearestRenderableLine(anchorLine, renderableLines);
	return {
		kind: "clamped",
		fileId: file.id,
		side: nearest.side,
		line: nearest.line,
		requestedStartLine: target.startLine,
		requestedEndLine: target.endLine,
	};
}

function middleLine(target: DiffTarget): number {
	return Math.round((target.startLine + target.endLine) / 2);
}

function exactSideFor(target: DiffTarget, index: LineIndex): AnchorSide | null {
	if (isRangeRenderable(target, index.newLines)) {
		return "new";
	}
	if (isRangeRenderable(target, index.oldLines)) {
		return "old";
	}
	return null;
}

function isRangeRenderable(
	target: DiffTarget,
	lines: ReadonlyMap<number, string>,
): boolean {
	for (let line = target.startLine; line <= target.endLine; line++) {
		if (!lines.has(line)) {
			return false;
		}
	}
	return true;
}

function collectRenderableLines(index: LineIndex): RenderableLine[] {
	const lines: RenderableLine[] = [];
	for (const line of index.newLines.keys()) {
		lines.push({ side: "new", line });
	}
	for (const line of index.oldLines.keys()) {
		lines.push({ side: "old", line });
	}
	return lines;
}

function nearestRenderableLine(
	target: number,
	candidates: readonly RenderableLine[],
): RenderableLine {
	let best = candidates[0];
	let bestDistance = Math.abs(best.line - target);
	for (const candidate of candidates.slice(1)) {
		const distance = Math.abs(candidate.line - target);

		const strictlyCloser = distance < bestDistance;
		const tiedButNewSide =
			distance === bestDistance &&
			candidate.side === "new" &&
			best.side !== "new";
		if (strictlyCloser || tiedButNewSide) {
			best = candidate;
			bestDistance = distance;
		}
	}
	return best;
}
