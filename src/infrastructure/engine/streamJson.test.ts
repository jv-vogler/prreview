import { createReadStream } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	parseStreamJson,
	type StreamJsonRecord,
	type StreamJsonTally,
} from "./streamJson";

const FIXTURES_DIR = fileURLToPath(
	new URL("../../../test/fixtures/claude/", import.meta.url),
);

async function collect(
	source: AsyncIterable<Buffer | string>,
	tally?: StreamJsonTally,
): Promise<StreamJsonRecord[]> {
	const records: StreamJsonRecord[] = [];
	for await (const record of parseStreamJson(source, tally)) {
		records.push(record);
	}
	return records;
}

async function* chunksOf(...parts: string[]): AsyncIterable<string> {
	for (const part of parts) {
		yield part;
	}
}

function fixtureStream(name: string): AsyncIterable<Buffer | string> {
	// Fixtures may carry a trailing `#exit N` replay directive the fake never
	// writes to stdout; here it doubles as an unparseable-line tolerance case.
	return (async function* () {
		const stream = createReadStream(`${FIXTURES_DIR}${name}`);
		for await (const chunk of stream) {
			yield chunk as Buffer;
		}
	})();
}

describe("parseStreamJson", () => {
	it("normalizes init, tool_use, tool_result, assistant text, and result from a real capture", async () => {
		const tally = { skippedLines: 0 };
		const records = await collect(fixtureStream("tooluse.jsonl"), tally);

		const init = records.find((record) => record.kind === "init");
		expect(init).toMatchObject({
			kind: "init",
			sessionId: "aaa0f9b5-189d-4c32-8f12-7f518e0ca54e",
			model: "claude-haiku-4-5-20251001",
		});

		const toolUse = records.find((record) => record.kind === "tool-use");
		expect(toolUse).toMatchObject({ kind: "tool-use", name: "Read" });

		const toolResult = records.find((record) => record.kind === "tool-result");
		expect(toolResult).toMatchObject({
			kind: "tool-result",
			toolUseId: (toolUse as { id: string }).id,
		});

		const result = records.at(-1);
		expect(result).toMatchObject({
			kind: "result",
			isError: false,
			subtype: "success",
			terminalReason: "completed",
			text: "47",
		});

		// hook_started/hook_response/thinking_tokens/rate_limit_event all skipped
		expect(tally.skippedLines).toBeGreaterThan(0);
	});

	it("keys the result on is_error, surfacing subtype and terminal_reason (CON-003)", async () => {
		const records = await collect(fixtureStream("badmodel.jsonl"));
		expect(records.at(-1)).toMatchObject({
			kind: "result",
			isError: true,
			// the trap: a failed run still reports subtype "success"
			subtype: "success",
			terminalReason: "api_error",
		});
	});

	it("leaves structuredOutput nullish on a failed schema run (CON-006)", async () => {
		const records = await collect(fixtureStream("maxturns.jsonl"));
		const result = records.at(-1) as { structuredOutput: unknown };
		// captures omit the key entirely rather than sending null; both mean
		// "the CLI exhausted its own retries and produced nothing usable"
		expect(result.structuredOutput ?? null).toBeNull();
	});

	it("carries structured output through on a successful schema run", async () => {
		const records = await collect(fixtureStream("comprehension.jsonl"));
		const result = records.at(-1) as {
			isError: boolean;
			structuredOutput: Record<string, unknown>;
		};
		expect(result.isError).toBe(false);
		expect(Object.keys(result.structuredOutput).sort()).toEqual([
			"explanations",
			"intentMap",
			"risk",
			"walkthrough",
		]);
	});

	it("parses hook noise to a clean stream without failing (CON-002)", async () => {
		const tally = { skippedLines: 0 };
		const records = await collect(fixtureStream("hooknoise.jsonl"), tally);
		expect(records.at(-1)).toMatchObject({ kind: "result", isError: false });
		expect(tally.skippedLines).toBeGreaterThanOrEqual(4);
	});

	it("yields text deltas from partial-message stream_events, not thinking deltas", async () => {
		const records = await collect(fixtureStream("chat-stream.jsonl"));
		const deltas = records.filter((record) => record.kind === "text-delta");
		expect(deltas.length).toBe(2);
		expect(
			deltas.map((delta) => (delta as { text: string }).text).join(""),
		).toContain("**Git merge**");
	});

	it("ends without a result record when the stream is truncated (a crashed child)", async () => {
		const records = await collect(fixtureStream("crash.jsonl"));
		expect(records.some((record) => record.kind === "result")).toBe(false);
		expect(records.some((record) => record.kind === "init")).toBe(true);
	});

	it("reassembles partial lines across chunk boundaries", async () => {
		const line = JSON.stringify({
			type: "system",
			subtype: "init",
			session_id: "s1",
			cwd: "/work",
			model: "m1",
		});
		const half = Math.floor(line.length / 2);
		const records = await collect(
			chunksOf(line.slice(0, half), `${line.slice(half)}\n`),
		);
		expect(records).toEqual([
			{ kind: "init", sessionId: "s1", cwd: "/work", model: "m1" },
		]);
	});

	it("parses a final line that arrives without a trailing newline", async () => {
		const line = JSON.stringify({ type: "result", is_error: false });
		const records = await collect(chunksOf(line));
		expect(records.at(-1)).toMatchObject({ kind: "result", isError: false });
	});

	it("counts and skips unparseable lines and unknown types, never throwing", async () => {
		const tally = { skippedLines: 0 };
		const records = await collect(
			chunksOf(
				[
					"this is not json",
					JSON.stringify({ type: "rate_limit_event" }),
					JSON.stringify({ type: "system", subtype: "thinking_tokens" }),
					JSON.stringify({ type: "some_future_event" }),
					"[1,2,3]",
					JSON.stringify({ type: "result", is_error: false }),
					"",
				].join("\n"),
			),
			tally,
		);
		expect(records).toHaveLength(1);
		expect(tally.skippedLines).toBe(5);
	});
});
