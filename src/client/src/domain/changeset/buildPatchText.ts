import type { FileDiffDto } from "@dto/ChangesetDto";

const NO_EOL_MARKER = "\\ No newline at end of file";
/** git's default mode for regular files; the IR carries no mode, and the renderer only displays it */
const REGULAR_FILE_MODE = "100644";

const LINE_PREFIX = {
	context: " ",
	add: "+",
	del: "-",
} as const;

/**
 * Serializes the changeset IR back into git unified-diff text. The server
 * parsed real git output into the IR (hunk headers verbatim, prefixes
 * stripped, noEol per line), so this is a faithful inverse for everything a
 * renderer needs: file headers with rename/add/delete markers, index lines
 * when both oids are known, hunks, and no-EOF markers.
 */
export function buildPatchText(files: readonly FileDiffDto[]): string {
	return files.map(buildFilePatch).join("");
}

function buildFilePatch(file: FileDiffDto): string {
	const oldPath = file.oldPath ?? file.path;
	const lines: string[] = [`diff --git a/${oldPath} b/${file.path}`];

	if (file.status === "added") {
		lines.push(`new file mode ${REGULAR_FILE_MODE}`);
	}
	if (file.status === "deleted") {
		lines.push(`deleted file mode ${REGULAR_FILE_MODE}`);
	}
	if (file.status === "renamed" || file.status === "copied") {
		const similarity = file.hunks.length === 0 ? "100%" : "75%";
		const verb = file.status === "renamed" ? "rename" : "copy";
		lines.push(
			`similarity index ${similarity}`,
			`${verb} from ${oldPath}`,
			`${verb} to ${file.path}`,
		);
	}

	const oldOid = file.oldBlob?.oid;
	const newOid = file.newBlob?.oid;
	if (oldOid !== undefined && newOid !== undefined) {
		lines.push(`index ${oldOid}..${newOid}`);
	}

	if (file.hunks.length > 0) {
		lines.push(
			file.status === "added" ? "--- /dev/null" : `--- a/${oldPath}`,
			file.status === "deleted" ? "+++ /dev/null" : `+++ b/${file.path}`,
		);
		for (const hunk of file.hunks) {
			lines.push(hunk.header);
			for (const line of hunk.lines) {
				lines.push(LINE_PREFIX[line.type] + line.content);
				if (line.noEol === true) {
					lines.push(NO_EOL_MARKER);
				}
			}
		}
	}

	return `${lines.join("\n")}\n`;
}
