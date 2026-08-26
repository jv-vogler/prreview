import type { DiffLine } from "../changeset/DiffLine";
import type { FileDiff } from "../changeset/FileDiff";
import type { Hunk } from "../changeset/Hunk";

export function renderNumberedDiff(files: readonly FileDiff[]): string {
	if (files.length === 0) {
		return "(no files changed)";
	}
	return files.map(renderFile).join("\n\n");
}

function renderFile(file: FileDiff): string {
	const heading = `### ${file.path}${file.oldPath === undefined || file.oldPath === file.path ? "" : ` (renamed from ${file.oldPath})`} — ${file.status}`;
	if (file.isBinary) {
		return `${heading}\n\n(binary file, no text diff)`;
	}
	const body = file.hunks.map(renderHunk).join("\n");
	return `${heading}\n\n\`\`\`diff\n${body}\n\`\`\``;
}

const DIFF_MARKER: Record<DiffLine["type"], string> = {
	add: "+",
	del: "-",
	context: " ",
};

function renderHunk(hunk: Hunk): string {
	const lines = hunk.lines.map((line) => {
		const marker = DIFF_MARKER[line.type];
		const lineNumber = line.newLine ?? line.oldLine ?? "";
		return `${lineNumber} ${marker} ${line.content}`;
	});
	return [`@@ ${hunk.header} @@`, ...lines].join("\n");
}
