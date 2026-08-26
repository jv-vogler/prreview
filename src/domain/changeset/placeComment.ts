import type { FileDiff } from "../changeset/FileDiff";
import { buildLineIndex, type LineIndex } from "../changeset/LineIndex";

/** which side of the diff a placed comment anchors to */
export type CommentAnchorSide = "old" | "new";

export interface CommentTarget {
	path: string;
	startLine: number;
	endLine: number;
}

/**
 * Whether one finding reaches a human, and where (TASK-040). `exact` means
 * every line in the requested range is an actual rendered diff line;
 * `clamped` means the file is in the diff but the range is not, so the
 * nearest rendered line stands in, carrying the original range for display;
 * `unplaceable` means there is nothing in the diff to anchor to at all.
 */
export type CommentPlacement =
	| { kind: "exact"; fileId: string; side: CommentAnchorSide; line: number }
	| {
			kind: "clamped";
			fileId: string;
			side: CommentAnchorSide;
			line: number;
			requestedStartLine: number;
			requestedEndLine: number;
	  }
	| { kind: "unplaceable" };

interface RenderableLine {
	side: CommentAnchorSide;
	line: number;
}

/**
 * Decides where — or whether — a finding's `{path, startLine, endLine}`
 * lands on the rendered diff (REQ-010). `path` must match a file in the diff
 * exactly, as the prompt instructs the agent to use it (reviewPrompt.ts's
 * `## Anchoring`).
 */
export function placeComment(
	target: CommentTarget,
	files: readonly FileDiff[],
): CommentPlacement {
	const file = files.find((candidate) => candidate.path === target.path);
	if (file === undefined) {
		return { kind: "unplaceable" };
	}

	const index = buildLineIndex(file);
	const renderableLines = collectRenderableLines(index);
	if (renderableLines.length === 0) {
		// present in the diff, but nothing about it is rendered (binary, a
		// pure rename with no hunks) — there is still nowhere to clamp to
		return { kind: "unplaceable" };
	}

	const exactSide = exactSideFor(target, index);
	if (exactSide !== null) {
		return {
			kind: "exact",
			fileId: file.id,
			side: exactSide,
			line: target.endLine,
		};
	}

	const nearest = nearestRenderableLine(target.endLine, renderableLines);
	return {
		kind: "clamped",
		fileId: file.id,
		side: nearest.side,
		line: nearest.line,
		requestedStartLine: target.startLine,
		requestedEndLine: target.endLine,
	};
}

/** the new side is tried first, matching the prompt's own default anchoring */
function exactSideFor(
	target: CommentTarget,
	index: LineIndex,
): CommentAnchorSide | null {
	if (isRangeRenderable(target, index.newLines)) {
		return "new";
	}
	if (isRangeRenderable(target, index.oldLines)) {
		return "old";
	}
	return null;
}

function isRangeRenderable(
	target: CommentTarget,
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
		// ties favor the new side, matching the prompt's default anchoring
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
