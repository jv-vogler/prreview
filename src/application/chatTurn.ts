import type { ChangesetRef } from "../domain/changeset/ChangesetRef";
import type { FileDiff } from "../domain/changeset/FileDiff";
import type { Hunk } from "../domain/changeset/Hunk";
import type {
	ChatMessage,
	ChatMessageContext,
	ChatThread,
} from "../domain/chat/ChatThread";
import { newChatTurnId } from "../domain/chat/newChatTurnId";
import type { EngineErrorReason } from "../domain/errors/EngineError";
import { EngineError } from "../domain/errors/EngineError";
import type { SessionManifest } from "../domain/session/SessionManifest";
import { CHAT_MAX_TURNS, CHAT_TIMEOUT_MS } from "./analysis/limits";
import { serializeNud } from "./analysis/nud";
import { consumeEngineRun } from "./consumeEngineRun";
import type { Engine, SessionResume } from "./ports/Engine";
import type { PublishEvent } from "./ports/EventPublisher";
import type {
	EnqueueResult,
	RunContext,
	RunManager,
	RunOutcome,
} from "./ports/RunManager";
import type { SessionStore } from "./ports/SessionStore";
import type { AnalysisWorkspaces } from "./runAnalysis";

/** the chat lane's only task type (§7) */
export const CHAT_TASK_TYPE = "chat";

/**
 * One thread per session in M2. The diff is one conversation, and a thread list
 * is UI that F8 does not ask for; the manifest still records threads as a list
 * so a second one costs no migration.
 */
export const CHAT_THREAD_ID = "t1";

export interface ChatTurnDeps {
	engine: Engine | null;
	runManager: RunManager;
	workspaces: AnalysisWorkspaces;
	store: SessionStore;
	publish: PublishEvent;
}

export interface ChatTurnRequest {
	manifest: SessionManifest;
	roundId: string;
	ref: ChangesetRef;
	files: readonly FileDiff[];
	/** what the user typed — never an argv member (SEC-004) */
	text: string;
	/** what the user is looking at, supplied by the client (§8) */
	context: ChatMessageContext;
}

export interface StartedChatTurn {
	turnId: string;
	run: EnqueueResult;
}

export type ChatTurn = (request: ChatTurnRequest) => Promise<StartedChatTurn>;

/**
 * A chat turn (ARCHITECTURE §7, F8). In plain terms: the user asks a question
 * about the code on screen, and the agent answers with the change and the repo
 * in front of it.
 *
 * Session strategy, fork-correct per CON-004: the thread's first turn resumes
 * the analysis session **forked**, inheriting stage A's grounding for free;
 * with no analysis yet it starts fresh and carries the diff in the prompt, so
 * chat is grounded even before anything has been analyzed. Every later turn
 * plain-resumes the thread's own session, which is safe because the chat lane
 * runs one turn at a time.
 *
 * §7's fenced ` ```prreview-ops ` protocol is deliberately absent: a turn is
 * prose in M2, and annotation operations arrive with curation in M3.
 */
export function makeChatTurn(deps: ChatTurnDeps): ChatTurn {
	return async (request) => {
		const engine = requireEngine(deps.engine);
		const changesetId = request.manifest.changesetId;
		const thread = await loadThread(deps, changesetId);
		const workspace = await deps.workspaces.ensure({
			source: request.ref.source,
			headSha: request.ref.headSha,
		});

		const turnId = newChatTurnId();
		const userMessage: ChatMessage = {
			role: "user",
			text: request.text,
			...(hasContext(request.context) ? { context: request.context } : {}),
			at: nowIso(),
		};
		// recorded before the answer exists: a turn that fails still leaves the
		// question in the history the user can see
		await deps.store.saveChatThread(changesetId, thread.id, {
			...thread,
			messages: [...thread.messages, userMessage],
		});

		const resume = resumeFor(thread, request.manifest);
		const prompt = buildPrompt(request, resume);
		const run = deps.runManager.enqueue({
			lane: "chat",
			taskType: CHAT_TASK_TYPE,
			timeoutMs: CHAT_TIMEOUT_MS,
			job: (context) =>
				runTurn({
					deps,
					request,
					context,
					turnId,
					prompt,
					workspaceDir: workspace.dir,
					...(resume === undefined ? {} : { resume }),
					engine,
				}),
		});
		return { turnId, run };
	};
}

function requireEngine(engine: Engine | null): Engine {
	if (engine === null) {
		throw new EngineError(
			"agent-missing",
			"No agent CLI was found, so prreview cannot answer questions about this change. Install and authenticate the claude CLI, then restart prreview.",
		);
	}
	return engine;
}

async function loadThread(
	deps: ChatTurnDeps,
	changesetId: string,
): Promise<ChatThread> {
	const stored = await deps.store.loadChatThread(changesetId, CHAT_THREAD_ID);
	return stored ?? { id: CHAT_THREAD_ID, messages: [] };
}

/**
 * First turn forks the analysis session (CON-004: any concurrent resume must
 * fork, or both threads interleave into the parent session file); later turns
 * plain-resume the thread's own session; with neither, a fresh session.
 */
function resumeFor(
	thread: ChatThread,
	manifest: SessionManifest,
): SessionResume | undefined {
	if (thread.engineSessionId !== undefined) {
		return { sessionId: thread.engineSessionId, fork: false };
	}
	const analysisSessionId = manifest.engine.analysisSessionId;
	if (analysisSessionId !== undefined) {
		return { sessionId: analysisSessionId, fork: true };
	}
	return undefined;
}

/**
 * The prompt is the context frame plus the question. A fresh session also
 * carries the numbered unified diff — a forked or resumed session already has
 * it in context, and sending it again would pay for the same tokens twice.
 */
function buildPrompt(
	request: ChatTurnRequest,
	resume: SessionResume | undefined,
): string {
	const parts: string[] = [];
	if (resume === undefined) {
		parts.push(
			"You are answering questions about a code change under review.",
			serializeNud({
				ref: request.ref,
				roundId: request.roundId,
				files: request.files,
			}),
		);
	}
	const frame = contextFrame(request);
	if (frame !== null) {
		parts.push(frame);
	}
	parts.push(request.text);
	return parts.join("\n\n");
}

/** §7's `[viewing <path>, hunk <id>, lines a–b]`, absent parts omitted. */
function contextFrame(request: ChatTurnRequest): string | null {
	const { file, hunkId } = request.context;
	const parts: string[] = [];
	if (file !== undefined) {
		parts.push(`viewing ${file}`);
	}
	if (hunkId !== undefined) {
		parts.push(`hunk ${hunkId}`);
		const hunk = findHunk(request.files, hunkId);
		if (hunk !== undefined) {
			parts.push(
				`lines ${hunk.newStart}–${hunk.newStart + Math.max(hunk.newLines - 1, 0)}`,
			);
		}
	}
	return parts.length === 0 ? null : `[${parts.join(", ")}]`;
}

function findHunk(
	files: readonly FileDiff[],
	hunkId: string,
): Hunk | undefined {
	for (const file of files) {
		const hunk = file.hunks.find((candidate) => candidate.id === hunkId);
		if (hunk !== undefined) {
			return hunk;
		}
	}
	return undefined;
}

interface TurnRun {
	deps: ChatTurnDeps;
	request: ChatTurnRequest;
	context: RunContext;
	engine: Engine;
	turnId: string;
	prompt: string;
	workspaceDir: string;
	resume?: SessionResume;
}

async function runTurn(run: TurnRun): Promise<RunOutcome> {
	const { deps, turnId } = run;
	deps.publish({ type: "chat.turn.started", turnId });

	const consumed = await consumeEngineRun(
		run.engine.chatTurn({
			prompt: run.prompt,
			workspaceDir: run.workspaceDir,
			maxTurns: CHAT_MAX_TURNS,
			timeoutMs: CHAT_TIMEOUT_MS,
			...(run.resume === undefined ? {} : { resume: run.resume }),
		}),
		{
			signal: run.context.signal,
			onText: (text) => deps.publish({ type: "chat.turn.delta", turnId, text }),
		},
	);

	if (consumed.aborted) {
		return failTurn(run, "crashed", "The answer was stopped.");
	}
	const result = consumed.result;
	if (result === null) {
		return failTurn(
			run,
			"crashed",
			"The agent stopped before it finished answering.",
		);
	}
	if (!result.ok) {
		const detail = result.terminalReason ?? "";
		return failTurn(
			run,
			result.reason,
			detail === ""
				? `The answer failed (${result.reason}).`
				: `The answer failed (${result.reason}): ${detail}`,
		);
	}

	// the result event's text is authoritative; the streamed deltas are the
	// same words arriving early (§8)
	const message: ChatMessage = {
		role: "assistant",
		text: result.text ?? consumed.text,
		at: nowIso(),
	};
	await appendAssistantMessage(run, message, result.sessionId);
	deps.publish({ type: "chat.turn.completed", turnId, message });
	return { ok: true };
}

async function failTurn(
	run: TurnRun,
	reason: EngineErrorReason,
	message: string,
): Promise<RunOutcome> {
	run.deps.publish({
		type: "chat.turn.failed",
		turnId: run.turnId,
		reason,
		message,
	});
	return { ok: false, reason, message };
}

/**
 * Stores the answer and, on the thread's first turn, the session every later
 * turn resumes — in both the thread file and the manifest's thread list (§11).
 */
async function appendAssistantMessage(
	run: TurnRun,
	message: ChatMessage,
	engineSessionId: string,
): Promise<void> {
	const { deps, request } = run;
	const changesetId = request.manifest.changesetId;
	const thread = await loadThread(deps, changesetId);
	await deps.store.saveChatThread(changesetId, thread.id, {
		...thread,
		engineSessionId: thread.engineSessionId ?? engineSessionId,
		messages: [...thread.messages, message],
	});

	const stored =
		(await deps.store.loadSessionManifest(changesetId)) ?? request.manifest;
	const alreadyRecorded = stored.engine.chatThreads.some(
		(candidate) => candidate.id === thread.id,
	);
	if (alreadyRecorded) {
		return;
	}
	await deps.store.saveSessionManifest({
		...stored,
		engine: {
			...stored.engine,
			chatThreads: [
				...stored.engine.chatThreads,
				{ id: thread.id, engineSessionId },
			],
		},
	});
}

function hasContext(context: ChatMessageContext): boolean {
	return (
		context.file !== undefined ||
		context.hunkId !== undefined ||
		context.annotationId !== undefined
	);
}

function nowIso(): string {
	return new Date().toISOString();
}
