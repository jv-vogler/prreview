import { changesetIdFor } from "../../domain/changeset/ChangesetId";
import type { ChangesetRef } from "../../domain/changeset/ChangesetRef";
import type { ChangesetSource } from "../../domain/changeset/ChangesetSource";
import type { DiffLine } from "../../domain/changeset/DiffLine";
import type { FileDiff } from "../../domain/changeset/FileDiff";
import type { Hunk } from "../../domain/changeset/Hunk";
import { type IncludedFile, truncate } from "./truncate";

/**
 * The numbered unified diff of ARCHITECTURE §7: a normal unified diff with
 * explicit old/new line numbers printed on every line and fileId/hunkId in
 * the headers, because models read diffs natively but are unreliable at
 * deriving line numbers arithmetically from `@@` headers — NUD turns anchor
 * emission into transcription for ~4 tokens of overhead per line. The
 * document always opens with a changeset header and the full file list with
 * per-file stats, so the agent knows what it has not been shown.
 */

export interface NudInput {
	ref: ChangesetRef;
	roundId: string;
	files: readonly FileDiff[];
}

const LINE_NUMBER_WIDTH = 6;
/** the line does not exist on that side */
const ABSENT_LINE_NUMBER = ".";
/** U+2212, matching the header spec's typographic minus */
const MINUS = "−";
const NO_NEWLINE_MARKER = "\\ No newline at end of file";
const SIGILS: Record<DiffLine["type"], string> = {
	context: " ",
	add: "+",
	del: "-",
};

export function serializeNud(input: NudInput): string {
	const { included, statOnly, truncated } = truncate(input.files);
	const sections = [
		changesetHeader(input),
		fileList(input.files, statOnly, truncated),
		...included.filter(({ file }) => file.hunks.length > 0).map(fileSection),
	];
	return `${sections.map((section) => section.join("\n")).join("\n\n")}\n`;
}

function changesetHeader(input: NudInput): string[] {
	return [
		`=== CHANGESET ${changesetIdFor(input.ref.source)}`,
		`source: ${describeSource(input.ref.source)}`,
		`base: ${input.ref.baseSha}`,
		`head: ${input.ref.headSha ?? "worktree"}`,
		`round: ${input.roundId}`,
	];
}

function describeSource(source: ChangesetSource): string {
	switch (source.kind) {
		case "pr":
			return `pr ${source.repo}#${source.number}`;
		case "branch":
			return `branch ${source.branch}..${source.base}`;
		case "range":
			return `range ${source.from}..${source.to}`;
		case "worktree":
			return "working tree (staged + unstaged)";
	}
}

function fileList(
	files: readonly FileDiff[],
	statOnly: readonly FileDiff[],
	truncated: readonly FileDiff[],
): string[] {
	const statOnlySet = new Set(statOnly);
	const truncatedSet = new Set(truncated);
	const totalAdditions = sum(files, (file) => file.additions);
	const totalDeletions = sum(files, (file) => file.deletions);
	const entries = files.map((file) => {
		let entry = file.path + fileStats(file) + originSuffix(file);
		if (file.isBinary) {
			entry += "  [binary]";
		}
		if (statOnlySet.has(file)) {
			entry += "  [generated — stat only]";
		}
		if (truncatedSet.has(file)) {
			entry += "  [not shown]";
		}
		return entry;
	});
	return [
		`=== FILES (${files.length} changed, +${totalAdditions} ${MINUS}${totalDeletions})`,
		...entries,
	];
}

function fileSection(included: IncludedFile): string[] {
	const { file, cutAtChangedLines } = included;
	const rows = [
		`=== FILE ${file.id}  ${file.path}${fileStats(file)}${originSuffix(file)}`,
	];
	let changedLinesLeft = cutAtChangedLines ?? Number.POSITIVE_INFINITY;
	for (const hunk of file.hunks) {
		rows.push(hunkHeader(hunk));
		for (const line of hunk.lines) {
			rows.push(diffRow(line));
			if (line.noEol === true) {
				rows.push(NO_NEWLINE_MARKER);
			}
			if (line.type === "context") {
				continue;
			}
			changedLinesLeft--;
			if (changedLinesLeft === 0) {
				rows.push(
					`... truncated — Read ${file.path} in the workspace for the rest`,
				);
				return rows;
			}
		}
	}
	return rows;
}

function fileStats(file: FileDiff): string {
	return `  (${file.status}, +${file.additions} ${MINUS}${file.deletions})`;
}

function originSuffix(file: FileDiff): string {
	if (file.oldPath === undefined) {
		return "";
	}
	const verb = file.status === "copied" ? "copied" : "renamed";
	return `  ${verb} from ${file.oldPath}`;
}

const FUNCTION_CONTEXT_PATTERN = /^@@[^@]*@@ ?(.*)$/;

function hunkHeader(hunk: Hunk): string {
	const range = `-${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines}`;
	const functionContext = FUNCTION_CONTEXT_PATTERN.exec(hunk.header)?.[1] ?? "";
	const suffix = functionContext === "" ? "" : ` ${functionContext}`;
	return `@@ HUNK ${hunk.id} @@ ${range} @@${suffix}`;
}

function diffRow(line: DiffLine): string {
	const oldNumber = lineNumberCell(line.oldLine);
	const newNumber = lineNumberCell(line.newLine);
	return `${oldNumber} | ${newNumber} | ${SIGILS[line.type]}${line.content}`;
}

function lineNumberCell(lineNumber: number | undefined): string {
	const text =
		lineNumber === undefined ? ABSENT_LINE_NUMBER : String(lineNumber);
	return text.padStart(LINE_NUMBER_WIDTH);
}

function sum(
	files: readonly FileDiff[],
	value: (file: FileDiff) => number,
): number {
	return files.reduce((total, file) => total + value(file), 0);
}
