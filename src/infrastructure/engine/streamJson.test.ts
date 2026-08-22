import { describe, expect, it } from "vitest";
import {
	parseStreamJson,
	type StreamJsonRecord,
	type StreamJsonTally,
} from "./streamJson";

async function collect(
	lines: string[],
	tally?: StreamJsonTally,
): Promise<StreamJsonRecord[]> {
	const records: StreamJsonRecord[] = [];
	for await (const record of parseStreamJson(linesOf(lines), tally)) {
		records.push(record);
	}
	return records;
}

async function* linesOf(lines: string[]): AsyncIterable<string> {
	for (const line of lines) {
		yield `${line}\n`;
	}
}

const INIT_LINE = JSON.stringify({
	type: "system",
	subtype: "init",
	session_id: "sess-1",
	cwd: "/repo",
	model: "claude-sonnet-5",
});

function resultLine(overrides: Record<string, unknown> = {}): string {
	return JSON.stringify({
		type: "result",
		is_error: false,
		subtype: "success",
		session_id: "sess-1",
		num_turns: 3,
		total_cost_usd: 0.05,
		result: "done",
		...overrides,
	});
}

describe("parseStreamJson", () => {
	it("normalizes init, tool-use, assistant text and a result", async () => {
		const records = await collect([
			INIT_LINE,
			JSON.stringify({
				type: "assistant",
				message: {
					content: [
						{ type: "text", text: "looking around" },
						{
							type: "tool_use",
							id: "t1",
							name: "Read",
							input: { file_path: "a.ts" },
						},
					],
				},
			}),
			resultLine(),
		]);

		expect(records).toEqual([
			{
				kind: "init",
				sessionId: "sess-1",
				cwd: "/repo",
				model: "claude-sonnet-5",
			},
			{ kind: "assistant-text", text: "looking around" },
			{
				kind: "tool-use",
				id: "t1",
				name: "Read",
				input: { file_path: "a.ts" },
			},
			{
				kind: "result",
				isError: false,
				subtype: "success",
				terminalReason: null,
				sessionId: "sess-1",
				numTurns: 3,
				costUsd: 0.05,
				text: "done",
				apiErrorStatus: null,
				structuredOutput: undefined,
			},
		]);
	});

	it("survives an unknown system subtype (a user hook)", async () => {
		const tally: StreamJsonTally = { skippedLines: 0 };
		const records = await collect(
			[
				JSON.stringify({ type: "system", subtype: "hook_started" }),
				resultLine(),
			],
			tally,
		);
		expect(records.map((record) => record.kind)).toEqual(["result"]);
		expect(tally.skippedLines).toBe(1);
	});

	it("survives an unknown top-level event type", async () => {
		const tally: StreamJsonTally = { skippedLines: 0 };
		await collect(
			[JSON.stringify({ type: "rate_limit_event" }), resultLine()],
			tally,
		);
		expect(tally.skippedLines).toBe(1);
	});

	it("survives an unparseable line", async () => {
		const tally: StreamJsonTally = { skippedLines: 0 };
		const records = await collect(["not json at all", resultLine()], tally);
		expect(records).toHaveLength(1);
		expect(tally.skippedLines).toBe(1);
	});

	it("ends with nothing when the stream never sends a result", async () => {
		const records = await collect([INIT_LINE]);
		expect(records.every((record) => record.kind !== "result")).toBe(true);
	});

	it("carries structured output and terminal reason on a failure", async () => {
		const [record] = await collect([
			resultLine({
				is_error: true,
				subtype: "error_during_execution",
				terminal_reason: "api_error",
				api_error_status: 429,
				result: "rate limited",
				structured_output: null,
			}),
		]);
		if (record?.kind !== "result") {
			throw new Error("expected a result record");
		}
		expect(record.isError).toBe(true);
		expect(record.terminalReason).toBe("api_error");
		expect(record.apiErrorStatus).toBe(429);
		expect(record.structuredOutput).toBeNull();
	});

	it("reassembles a line split across chunk boundaries", async () => {
		const whole = resultLine();
		const split = Math.floor(whole.length / 2);
		async function* chunks(): AsyncIterable<string> {
			yield whole.slice(0, split);
			yield `${whole.slice(split)}\n`;
		}
		const records: StreamJsonRecord[] = [];
		for await (const record of parseStreamJson(chunks())) {
			records.push(record);
		}
		expect(records).toHaveLength(1);
		expect(records[0]?.kind).toBe("result");
	});

	it("parses a final unterminated line", async () => {
		async function* chunks(): AsyncIterable<string> {
			yield resultLine();
		}
		const records: StreamJsonRecord[] = [];
		for await (const record of parseStreamJson(chunks())) {
			records.push(record);
		}
		expect(records).toHaveLength(1);
	});
});
