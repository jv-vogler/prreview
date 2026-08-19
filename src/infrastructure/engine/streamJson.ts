/**
 * Line-delimited JSON parser over the claude CLI's `--output-format
 * stream-json` stdout, tolerant by construction (CON-002): the stream carries
 * environment noise from the user's own hooks and config (`system` events
 * with subtypes `hook_started`, `hook_response`, `status`, `thinking_tokens`,
 * plus `rate_limit_event`), so the parser whitelists what it understands and
 * counts-and-skips everything else — an unknown event, subtype, or an
 * unparseable line never throws. A stream that ends without a `result`
 * record is how a crashed child looks to the caller (TASK-022).
 */

/** Every record the parser knows how to normalize out of the stream. */
export type StreamJsonRecord =
	| StreamInitRecord
	| StreamAssistantTextRecord
	| StreamToolUseRecord
	| StreamToolResultRecord
	| StreamTextDeltaRecord
	| StreamResultRecord;

/** `system` / `subtype: "init"` — the run's identity and the engine cwd (CON-007). */
export interface StreamInitRecord {
	kind: "init";
	sessionId: string;
	cwd: string;
	model: string;
}

/** a complete assistant `text` content block */
export interface StreamAssistantTextRecord {
	kind: "assistant-text";
	text: string;
}

/** an assistant `tool_use` content block */
export interface StreamToolUseRecord {
	kind: "tool-use";
	id: string;
	name: string;
	input: Record<string, unknown>;
}

/** a user `tool_result` content block, joined to its call by toolUseId */
export interface StreamToolResultRecord {
	kind: "tool-result";
	toolUseId: string;
	content: unknown;
}

/** a `stream_event` text delta — emitted only under --include-partial-messages */
export interface StreamTextDeltaRecord {
	kind: "text-delta";
	text: string;
}

/** the terminal `result` event, normalized; success keys on isError (CON-003) */
export interface StreamResultRecord {
	kind: "result";
	isError: boolean;
	subtype: string;
	terminalReason: string | null;
	sessionId: string;
	numTurns: number;
	costUsd: number;
	text: string | null;
	/**
	 * The HTTP status behind a `terminal_reason: "api_error"`, when there was
	 * one. Captured because it is the difference between "you cannot reach that
	 * model" (404), "you are rate limited" (429), and "your prompt is too long"
	 * (400) — and without it every one of those reads the same to a user.
	 */
	apiErrorStatus: number | null;
	/** absent on non-schema runs; null when the CLI exhausted its retries (CON-006) */
	structuredOutput: unknown;
}

/** mutated in place so the caller can assert tolerance without owning the loop */
export interface StreamJsonTally {
	skippedLines: number;
}

/**
 * Parses a chunked byte stream into normalized records. Partial lines across
 * chunk boundaries are buffered; a final unterminated line is still parsed.
 */
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

/** null = event not understood (count it); [] = understood, nothing to yield */
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
		case "stream_event":
			return textDeltaRecords(event);
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
		// thinking blocks are understood noise: consumed, never yielded
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

/**
 * Only `content_block_delta` / `text_delta` becomes a record — thinking and
 * signature deltas, message_start/stop and the rest of the partial-message
 * envelope are understood-but-silent, not unknown noise.
 */
function textDeltaRecords(
	event: Record<string, unknown>,
): StreamJsonRecord[] | null {
	const inner = event.event;
	if (!isObject(inner)) {
		return null;
	}
	if (inner.type !== "content_block_delta") {
		return [];
	}
	const delta = inner.delta;
	if (!isObject(delta)) {
		return [];
	}
	if (delta.type !== "text_delta") {
		return [];
	}
	return [{ kind: "text-delta", text: asString(delta.text) }];
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
