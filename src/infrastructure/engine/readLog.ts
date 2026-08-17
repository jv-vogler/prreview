import { isAbsolute, resolve } from "node:path";
import type { ReadLog } from "../../application/ports/Engine";
import type { StreamJsonRecord } from "./streamJson";

/**
 * Records every file the agent actually saw (CON-007, spike 6). Extraction
 * cannot be input-only: `Read` carries an absolute `input.file_path`, while
 * `Grep`/`Glob` usually carry no path input at all and the files they
 * surfaced appear in the **tool_result content** as cwd-relative paths,
 * joined to their call by `tool_use_id`. cwd comes from the stream's `init`
 * event, never from prreview's own process.
 *
 * MCP tools reach the model through a ToolSearch → tool_reference
 * indirection (CON-008); those calls carry no grounding and are ignored
 * entirely. Any other unknown tool is recorded by name only, with no paths,
 * so a new CLI tool degrades to "no paths recorded" rather than wrong ones.
 */
export interface ReadLogRecorder {
	accept(record: StreamJsonRecord): void;
	/** deduplicated and sorted; safe to call at any point */
	result(): ReadLog;
	/** tool names seen that carry no path harvesting rule */
	unknownTools(): string[];
}

/** Grep's default files_with_matches mode prefixes its list with this header. */
const GREP_HEADER = /^Found \d+ files?$/;
/** Grep and Glob both say this instead of a list when nothing matched. */
const NO_MATCH_LINES = new Set(["No files found", "No matches found"]);
/** the MCP indirection of CON-008 — never grounding evidence */
const IGNORED_TOOLS = new Set(["ToolSearch", "tool_reference"]);
const SEARCH_TOOLS = new Set(["Grep", "Glob"]);

export function createReadLogRecorder(): ReadLogRecorder {
	const reads = new Set<string>();
	const searchHits = new Set<string>();
	const unknown = new Set<string>();
	/** tool_use_id → tool name, so a tool_result knows which parser to use */
	const toolNameById = new Map<string, string>();
	let cwd: string | null = null;

	function accept(record: StreamJsonRecord): void {
		if (record.kind === "init") {
			cwd = record.cwd;
			return;
		}
		if (record.kind === "tool-use") {
			acceptToolUse(record.id, record.name, record.input);
			return;
		}
		if (record.kind === "tool-result") {
			acceptToolResult(record.toolUseId, record.content);
		}
	}

	function acceptToolUse(
		id: string,
		name: string,
		input: Record<string, unknown>,
	): void {
		if (IGNORED_TOOLS.has(name)) {
			return;
		}
		toolNameById.set(id, name);
		if (name === "Read") {
			const filePath = input.file_path;
			if (typeof filePath === "string" && filePath !== "") {
				reads.add(absolutize(filePath));
			}
			return;
		}
		if (!SEARCH_TOOLS.has(name)) {
			unknown.add(name);
		}
	}

	function acceptToolResult(toolUseId: string, content: unknown): void {
		const name = toolNameById.get(toolUseId);
		if (name === undefined || !SEARCH_TOOLS.has(name)) {
			return;
		}
		for (const line of textLines(content)) {
			if (GREP_HEADER.test(line) || NO_MATCH_LINES.has(line)) {
				continue;
			}
			searchHits.add(absolutize(line));
		}
	}

	/** paths from tool_result are cwd-relative; Read's are already absolute */
	function absolutize(path: string): string {
		if (isAbsolute(path)) {
			return path;
		}
		return cwd === null ? path : resolve(cwd, path);
	}

	return {
		accept,
		result: () => ({
			reads: [...reads].sort(),
			searchHits: [...searchHits].sort(),
		}),
		unknownTools: () => [...unknown].sort(),
	};
}

/**
 * tool_result content is a string in every observed case, but the CLI's
 * schema also allows a content-block array; both are flattened to lines.
 */
function textLines(content: unknown): string[] {
	return contentText(content)
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "");
}

function contentText(content: unknown): string {
	if (typeof content === "string") {
		return content;
	}
	if (!Array.isArray(content)) {
		return "";
	}
	return content
		.map((block) =>
			typeof block === "object" &&
			block !== null &&
			typeof (block as { text?: unknown }).text === "string"
				? (block as { text: string }).text
				: "",
		)
		.join("\n");
}
