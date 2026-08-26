export type StreamJsonRecord =
	| StreamInitRecord
	| StreamAssistantTextRecord
	| StreamToolUseRecord
	| StreamToolResultRecord
	| StreamResultRecord;

export interface StreamInitRecord {
	kind: "init";
	sessionId: string;
	cwd: string;
	model: string;
}

export interface StreamAssistantTextRecord {
	kind: "assistant-text";
	text: string;
}

export interface StreamToolUseRecord {
	kind: "tool-use";
	id: string;
	name: string;
	input: Record<string, unknown>;
}

export interface StreamToolResultRecord {
	kind: "tool-result";
	toolUseId: string;
	content: unknown;
}

export interface StreamResultRecord {
	kind: "result";
	isError: boolean;
	subtype: string;
	terminalReason: string | null;
	sessionId: string;
	numTurns: number;
	costUsd: number;
	text: string | null;
	apiErrorStatus: number | null;
	structuredOutput: unknown;
}

export interface StreamJsonTally {
	skippedLines: number;
}

export async function* parseStreamJson(
	source: AsyncIterable<Buffer | string>,
	tally?: StreamJsonTally,
): AsyncGenerator<StreamJsonRecord, void, undefined> {
	let pending = "";
	for await (const chunk of source) {
		pending += chunk.toString();
		const lines = pending.split("\n");
		pending = lines.pop() ?? "";
		for (const line of lines) {
			yield* recordsFromLine(line, tally);
		}
	}
	yield* recordsFromLine(pending, tally);
}

function* recordsFromLine(
	line: string,
	tally: StreamJsonTally | undefined,
): Generator<StreamJsonRecord> {
	if (line.trim() === "") {
		return;
	}
	let event: unknown;
	try {
		event = JSON.parse(line);
	} catch {
		countSkip(tally);
		return;
	}
	if (!isObject(event)) {
		countSkip(tally);
		return;
	}

	const records = normalizeEvent(event);
	if (records === null) {
		countSkip(tally);
		return;
	}
	yield* records;
}

function normalizeEvent(
	event: Record<string, unknown>,
): StreamJsonRecord[] | null {
	switch (event.type) {
		case "system":
			return event.subtype === "init" ? [initRecord(event)] : null;
		case "assistant":
			return assistantRecords(event);
		case "user":
			return toolResultRecords(event);
		case "result":
			return [resultRecord(event)];
		default:
			return null;
	}
}

function initRecord(event: Record<string, unknown>): StreamInitRecord {
	return {
		kind: "init",
		sessionId: asString(event.session_id),
		cwd: asString(event.cwd),
		model: asString(event.model),
	};
}

function assistantRecords(
	event: Record<string, unknown>,
): StreamJsonRecord[] | null {
	const blocks = messageContent(event);
	if (blocks === null) {
		return null;
	}
	const records: StreamJsonRecord[] = [];
	for (const block of blocks) {
		if (!isObject(block)) {
			continue;
		}
		if (block.type === "text") {
			records.push({ kind: "assistant-text", text: asString(block.text) });
		} else if (block.type === "tool_use") {
			records.push({
				kind: "tool-use",
				id: asString(block.id),
				name: asString(block.name),
				input: isObject(block.input) ? block.input : {},
			});
		}
	}
	return records;
}

function toolResultRecords(
	event: Record<string, unknown>,
): StreamJsonRecord[] | null {
	const blocks = messageContent(event);
	if (blocks === null) {
		return null;
	}
	const records: StreamJsonRecord[] = [];
	for (const block of blocks) {
		if (isObject(block) && block.type === "tool_result") {
			records.push({
				kind: "tool-result",
				toolUseId: asString(block.tool_use_id),
				content: block.content,
			});
		}
	}
	return records;
}

function resultRecord(event: Record<string, unknown>): StreamResultRecord {
	return {
		kind: "result",
		isError: event.is_error === true,
		subtype: asString(event.subtype),
		terminalReason:
			typeof event.terminal_reason === "string" ? event.terminal_reason : null,
		sessionId: asString(event.session_id),
		numTurns: typeof event.num_turns === "number" ? event.num_turns : 0,
		costUsd:
			typeof event.total_cost_usd === "number" ? event.total_cost_usd : 0,
		text: typeof event.result === "string" ? event.result : null,
		apiErrorStatus:
			typeof event.api_error_status === "number"
				? event.api_error_status
				: null,
		structuredOutput: event.structured_output,
	};
}

function messageContent(event: Record<string, unknown>): unknown[] | null {
	const message = event.message;
	if (!isObject(message) || !Array.isArray(message.content)) {
		return null;
	}
	return message.content;
}

function countSkip(tally: StreamJsonTally | undefined): void {
	if (tally !== undefined) {
		tally.skippedLines += 1;
	}
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string {
	return typeof value === "string" ? value : "";
}
