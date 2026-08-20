import { isAbsolute, resolve } from "node:path";
import type { ReadLog } from "../../application/ports/Engine";
import type { ReadRange } from "../../domain/review/groundingGate";
import type { StreamJsonRecord } from "./streamJson";

/**
 * Records every file the agent actually saw (CON-007, spike 6). Extraction
 * cannot be input-only: `Read` carries an absolute `input.file_path`, while
 * `Grep`/`Glob` usually carry no path input at all and the files they
 * surfaced appear in the **tool_result content** as cwd-relative paths,
 * joined to their call by `tool_use_id`. cwd comes from the stream's `init`
 * event, never from prreview's own process.
 *
 * `Read`'s `offset`/`limit` are recorded alongside its path, because the range
 * is the difference between grounding a claim about line 12 and grounding one
 * about line 900 of the same file.
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
	/** keyed by path and range, so one file read twice at two ranges is two entries */
	const reads = new Map<string, ReadRange>();
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
				recordRead(absolutize(filePath), input);
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

	/**
	 * A `Read` with its range, when it asked for one.
	 *
	 * An absent `offset` is recorded as absent and read downstream as "the whole
	 * file". That is an over-approximation: `Read` with no arguments returns
	 * roughly the first 2000 lines, so a citation on line 4000 of a 5000-line
	 * file is still counted as grounded. Encoding 2000 here would be an
	 * unmeasured CLI default baked into a gate, which is exactly what the spike
	 * discipline exists to prevent - it belongs in `spikes/` and
	 * `docs/engine-notes.md` before it belongs in code.
	 */
	function recordRead(path: string, input: Record<string, unknown>): void {
		const offset = positiveInt(input.offset);
		const limit = positiveInt(input.limit);
		const entry: ReadRange = {
			path,
			...(offset === undefined ? {} : { offset }),
			...(limit === undefined ? {} : { limit }),
		};
		reads.set(`${path}\u0000${offset ?? ""}\u0000${limit ?? ""}`, entry);
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
			reads: [...reads.values()].sort((left, right) =>
				left.path === right.path
					? (left.offset ?? 0) - (right.offset ?? 0)
					: left.path.localeCompare(right.path),
			),
			searchHits: [...searchHits].sort(),
		}),
		unknownTools: () => [...unknown].sort(),
	};
}

/** a line number the CLI actually sent; anything else is treated as absent */
function positiveInt(value: unknown): number | undefined {
	return typeof value === "number" && Number.isInteger(value) && value > 0
		? value
		: undefined;
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
