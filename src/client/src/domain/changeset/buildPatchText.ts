import type { FileDiffDto } from "@dto/ChangesetDto";

const NO_EOL_MARKER = "\\ No newline at end of file";

const REGULAR_FILE_MODE = "100644";

const LINE_PREFIX = {
	context: " ",
	add: "+",
	del: "-",
} as const;

export function buildPatchText(files: readonly FileDiffDto[]): string {
	return files.map(buildFilePatch).join("");
}

function buildFilePatch(file: FileDiffDto): string {
	const oldPath = file.oldPath ?? file.path;
	const lines = [
		`diff --git a/${oldPath} b/${file.path}`,
		...modeLines(file),
		...similarityLines(file, oldPath),
		...indexLine(file),
		...hunkLines(file, oldPath),
	];
	return `${lines.join("\n")}\n`;
}

function modeLines(file: FileDiffDto): string[] {
	if (file.status === "added") {
		return [`new file mode ${REGULAR_FILE_MODE}`];
	}
	if (file.status === "deleted") {
		return [`deleted file mode ${REGULAR_FILE_MODE}`];
	}
	return [];
}

function similarityLines(file: FileDiffDto, oldPath: string): string[] {
	if (file.status !== "renamed" && file.status !== "copied") {
		return [];
	}
	const verb = file.status === "renamed" ? "rename" : "copy";
	return [
		`similarity index ${file.hunks.length === 0 ? "100%" : "75%"}`,
		`${verb} from ${oldPath}`,
		`${verb} to ${file.path}`,
	];
}

function indexLine(file: FileDiffDto): string[] {
	const oldOid = file.oldBlob?.oid;
	const newOid = file.newBlob?.oid;
	return oldOid === undefined || newOid === undefined
		? []
		: [`index ${oldOid}..${newOid}`];
}

function hunkLines(file: FileDiffDto, oldPath: string): string[] {
	if (file.hunks.length === 0) {
		return [];
	}
	const lines = [
		file.status === "added" ? "--- /dev/null" : `--- a/${oldPath}`,
		file.status === "deleted" ? "+++ /dev/null" : `+++ b/${file.path}`,
	];
	for (const hunk of file.hunks) {
		lines.push(hunk.header);
		for (const line of hunk.lines) {
			lines.push(LINE_PREFIX[line.type] + line.content);
			if (line.noEol === true) {
				lines.push(NO_EOL_MARKER);
			}
		}
	}
	return lines;
}
