import { createReadStream } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createReadLogRecorder } from "./readLog";
import { parseStreamJson, type StreamJsonRecord } from "./streamJson";

const FIXTURES_DIR = fileURLToPath(
	new URL("../../../test/fixtures/claude/", import.meta.url),
);

async function recordFixture(name: string) {
	const recorder = createReadLogRecorder();
	const stream = (async function* () {
		for await (const chunk of createReadStream(`${FIXTURES_DIR}${name}`)) {
			yield chunk as Buffer;
		}
	})();
	for await (const record of parseStreamJson(stream)) {
		recorder.accept(record);
	}
	return recorder;
}

function feed(records: StreamJsonRecord[]) {
	const recorder = createReadLogRecorder();
	for (const record of records) {
		recorder.accept(record);
	}
	return recorder;
}

const INIT: StreamJsonRecord = {
	kind: "init",
	sessionId: "s1",
	cwd: "/work/repo",
	model: "m1",
};

describe("createReadLogRecorder", () => {
	it("takes Read targets from tool_use input.file_path (absolute)", async () => {
		const recorder = await recordFixture("tooluse.jsonl");
		expect(recorder.result().reads).toEqual([
			"/tmp/claude-1000/-home-jvogler-Projects-personal-prreview/e0c177c1-ea10-46d7-ad41-ded12cc9e734/scratchpad/s3/miniws/notes.txt",
		]);
		expect(recorder.result().searchHits).toEqual([]);
	});

	it("harvests Grep and Glob hits from tool_result content, cwd-joined", async () => {
		const recorder = await recordFixture("understanding.jsonl");
		const { reads, searchHits } = recorder.result();
		expect(reads).toEqual([
			"/tmp/prreview-capture-33zpuC/miniweb/src/greeting.ts",
			"/tmp/prreview-capture-33zpuC/miniweb/src/main.ts",
		]);
		// Grep returned "Found 2 files\nsrc/greeting.ts\nsrc/main.ts": the header
		// is skipped and both relative paths resolve against the init cwd
		expect(searchHits).toEqual([
			"/tmp/prreview-capture-33zpuC/miniweb/src/greeting.ts",
			"/tmp/prreview-capture-33zpuC/miniweb/src/main.ts",
		]);
	});

	it("skips Grep's `Found N files` header line", () => {
		const recorder = feed([
			INIT,
			{ kind: "tool-use", id: "t1", name: "Grep", input: { pattern: "x" } },
			{
				kind: "tool-result",
				toolUseId: "t1",
				content: "Found 2 files\nsrc/a.ts\nsrc/b.ts",
			},
		]);
		expect(recorder.result().searchHits).toEqual([
			"/work/repo/src/a.ts",
			"/work/repo/src/b.ts",
		]);
	});

	it("records nothing for a search that found no files", () => {
		const recorder = feed([
			INIT,
			{ kind: "tool-use", id: "t1", name: "Glob", input: { pattern: "*.md" } },
			{ kind: "tool-result", toolUseId: "t1", content: "No files found" },
		]);
		expect(recorder.result()).toEqual({ reads: [], searchHits: [] });
	});

	it("ignores the ToolSearch/tool_reference MCP indirection entirely (CON-008)", () => {
		const recorder = feed([
			INIT,
			{ kind: "tool-use", id: "t1", name: "ToolSearch", input: { query: "q" } },
			{ kind: "tool-result", toolUseId: "t1", content: "mcp__x__y\nmcp__x__z" },
			{
				kind: "tool-use",
				id: "t2",
				name: "tool_reference",
				input: { name: "mcp__x__y" },
			},
		]);
		expect(recorder.result()).toEqual({ reads: [], searchHits: [] });
		expect(recorder.unknownTools()).toEqual([]);
	});

	it("records an unknown tool by name only, with no paths", () => {
		const recorder = feed([
			INIT,
			{
				kind: "tool-use",
				id: "t1",
				name: "FutureSearch",
				input: { file_path: "/work/repo/src/a.ts" },
			},
			{ kind: "tool-result", toolUseId: "t1", content: "src/b.ts" },
		]);
		expect(recorder.result()).toEqual({ reads: [], searchHits: [] });
		expect(recorder.unknownTools()).toEqual(["FutureSearch"]);
	});

	it("deduplicates and sorts both lists", () => {
		const recorder = feed([
			INIT,
			{
				kind: "tool-use",
				id: "t1",
				name: "Read",
				input: { file_path: "/work/repo/z.ts" },
			},
			{
				kind: "tool-use",
				id: "t2",
				name: "Read",
				input: { file_path: "/work/repo/a.ts" },
			},
			{
				kind: "tool-use",
				id: "t3",
				name: "Read",
				input: { file_path: "/work/repo/z.ts" },
			},
			{ kind: "tool-use", id: "t4", name: "Grep", input: {} },
			{
				kind: "tool-result",
				toolUseId: "t4",
				content: "Found 2 files\nb.ts\nb.ts",
			},
		]);
		expect(recorder.result()).toEqual({
			reads: ["/work/repo/a.ts", "/work/repo/z.ts"],
			searchHits: ["/work/repo/b.ts"],
		});
	});

	it("joins results to calls by tool_use_id, not by arrival order", () => {
		const recorder = feed([
			INIT,
			{ kind: "tool-use", id: "grep-1", name: "Grep", input: {} },
			{
				kind: "tool-use",
				id: "read-1",
				name: "Read",
				input: { file_path: "/r.ts" },
			},
			// a result for the Read call must never be parsed as a path list
			{ kind: "tool-result", toolUseId: "read-1", content: "1\tconst a = 1;" },
			{
				kind: "tool-result",
				toolUseId: "grep-1",
				content: "Found 1 file\nsrc/c.ts",
			},
		]);
		expect(recorder.result()).toEqual({
			reads: ["/r.ts"],
			searchHits: ["/work/repo/src/c.ts"],
		});
	});

	it("leaves relative hits unresolved when no init event supplied a cwd", () => {
		const recorder = feed([
			{ kind: "tool-use", id: "t1", name: "Glob", input: {} },
			{ kind: "tool-result", toolUseId: "t1", content: "src/a.ts" },
		]);
		expect(recorder.result().searchHits).toEqual(["src/a.ts"]);
	});

	it("flattens a content-block array result", () => {
		const recorder = feed([
			INIT,
			{ kind: "tool-use", id: "t1", name: "Grep", input: {} },
			{
				kind: "tool-result",
				toolUseId: "t1",
				content: [{ type: "text", text: "Found 1 file\nsrc/a.ts" }],
			},
		]);
		expect(recorder.result().searchHits).toEqual(["/work/repo/src/a.ts"]);
	});
});
