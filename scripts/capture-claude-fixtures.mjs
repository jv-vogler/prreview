#!/usr/bin/env node
// capture-claude-fixtures.mjs — opt-in recorder for the real `claude` CLI.
//
// Records the five M2 engine fixtures into test/fixtures/claude/ (TASK-004)
// and answers the large-prompt delivery question empirically (TASK-005),
// printing the observations that docs/engine-notes.md records.
//
// Spends real tokens (all runs `--model haiku`), so it refuses to run unless
// PRREVIEW_REAL_CLAUDE=1 is set. Everything happens in a scratch git repo
// under the OS temp dir — never inside this repository.
//
// Usage: PRREVIEW_REAL_CLAUDE=1 node scripts/capture-claude-fixtures.mjs

import { execFile as execFileCallback, spawn } from "node:child_process";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

const FIXTURES_DIR = fileURLToPath(
	new URL("../test/fixtures/claude/", import.meta.url),
);
const README_PATH = join(FIXTURES_DIR, "README.md");

const MODEL = "haiku";
const READ_ONLY_TOOL_FLAGS = [
	"--allowedTools",
	"Read,Glob,Grep",
	"--disallowedTools",
	"Write,Edit,Bash",
	"--permission-mode",
	"dontAsk",
];
const STREAM_FLAGS = ["-p", "--output-format", "stream-json", "--verbose"];

const PROBE_TIMEOUT_MS = 180_000;
const SMALL_CAPTURE_TIMEOUT_MS = 180_000;
const COMPREHENSION_TIMEOUT_MS = 600_000;
const LARGE_PROMPT_BYTES = 200_000;

if (process.env.PRREVIEW_REAL_CLAUDE !== "1") {
	process.stderr.write(
		"capture-claude-fixtures: refusing to run — this spends real tokens.\n" +
			"Set PRREVIEW_REAL_CLAUDE=1 to opt in.\n",
	);
	process.exit(1);
}

const claudeVersion = (await execFile("claude", ["--version"])).stdout.trim();
const scratchRoot = mkdtempSync(join(tmpdir(), "prreview-capture-"));
const repoDir = await buildScratchRepo(scratchRoot);
const today = new Date().toISOString().slice(0, 10);

process.stdout.write(`capturing against ${claudeVersion} in ${repoDir}\n\n`);

try {
	await answerPromptDeliveryQuestion();
	await captureFixtures();
} finally {
	rmSync(scratchRoot, { recursive: true, force: true });
}

// --- TASK-005: how does a large prompt reach `claude -p`? -------------------

async function answerPromptDeliveryQuestion() {
	process.stdout.write("== TASK-005: prompt delivery probes ==\n");

	const tinyPrompt = "Reply with exactly the word: ok";
	const tiny = await runClaude({
		argv: [...STREAM_FLAGS, "--model", MODEL, "--max-turns", "2"],
		stdin: tinyPrompt,
		timeoutMs: PROBE_TIMEOUT_MS,
	});
	reportProbe(
		"(a) tiny prompt on stdin, no positional argument",
		tinyPrompt.length,
		tiny,
	);

	const filler = "lorem ipsum filler for the argv-vs-stdin probe. ".repeat(
		Math.ceil(LARGE_PROMPT_BYTES / 48),
	);
	const largePrompt = `${filler.slice(0, LARGE_PROMPT_BYTES)}\n\nQUESTION: ignore all the filler above and reply with exactly the word: pineapple`;
	const large = await runClaude({
		argv: [...STREAM_FLAGS, "--model", MODEL, "--max-turns", "2"],
		stdin: largePrompt,
		timeoutMs: PROBE_TIMEOUT_MS,
	});
	reportProbe(
		`(b) ~${Math.round(Buffer.byteLength(largePrompt) / 1000)}KB prompt on stdin`,
		Buffer.byteLength(largePrompt),
		large,
	);
}

function reportProbe(label, promptBytes, run) {
	const result = lastResultEvent(run.stdoutLines);
	process.stdout.write(
		`${label}\n` +
			`  prompt bytes: ${promptBytes}\n` +
			`  exit code: ${run.exitCode}${run.timedOut ? " (TIMED OUT)" : ""}\n` +
			`  result event: ${
				result === null
					? "none"
					: `is_error=${result.is_error} num_turns=${result.num_turns} ` +
						`cost_usd=${result.total_cost_usd} text=${JSON.stringify(
							typeof result.result === "string"
								? result.result.slice(0, 120)
								: result.result,
						)}`
			}\n\n`,
	);
}

// --- TASK-004: the five fixtures --------------------------------------------

async function captureFixtures() {
	process.stdout.write("== TASK-004: fixture captures ==\n");

	const comprehensionPrompt = buildComprehensionPrompt();
	const taskSchemas = await dumpTaskSchemas();
	await capture({
		name: "comprehension",
		note:
			"stage A shape: a real --json-schema run against the ComprehensionOut schema, " +
			"taken from src/application/analysis/ through the production toJsonSchema path " +
			"(CON-014 — never hand-embedded here again), with Read/Grep/Glob tool use, exit 0.",
		argv: [
			...STREAM_FLAGS,
			"--model",
			MODEL,
			...READ_ONLY_TOOL_FLAGS,
			"--max-turns",
			"16",
			"--json-schema",
			taskSchemas.comprehension,
		],
		stdin: comprehensionPrompt,
		timeoutMs: COMPREHENSION_TIMEOUT_MS,
	});

	await capture({
		name: "chat-stream",
		note:
			"a chat-lane turn with --include-partial-messages (the shape spike 3 flagged as " +
			"uncaptured): token-level stream_event deltas, no --json-schema, exit 0.",
		argv: [
			...STREAM_FLAGS,
			"--include-partial-messages",
			"--model",
			MODEL,
			...READ_ONLY_TOOL_FLAGS,
			"--max-turns",
			"4",
		],
		stdin:
			"In one or two sentences: what is the difference between git merge and git rebase? " +
			"Do not use any tools.",
		timeoutMs: SMALL_CAPTURE_TIMEOUT_MS,
	});

	const hooknoise = await capture({
		name: "hooknoise",
		note:
			"a tiny run under this machine's own hooks and config, capturing the " +
			"system:hook_started/hook_response/status/thinking_tokens and rate_limit_event " +
			"noise the parser must skip (CON-002), exit 0.",
		argv: [...STREAM_FLAGS, "--model", MODEL, "--max-turns", "2"],
		stdin: "Reply with exactly the word: ok",
		timeoutMs: SMALL_CAPTURE_TIMEOUT_MS,
	});

	await capture({
		name: "maxturns",
		note:
			"--max-turns 1 on a schema task that needs more turns: result " +
			"subtype:error_max_turns, is_error:true, structured_output:null, exit 1.",
		argv: [
			...STREAM_FLAGS,
			"--model",
			MODEL,
			...READ_ONLY_TOOL_FLAGS,
			"--max-turns",
			"1",
			"--json-schema",
			JSON.stringify(maxTurnsProbeJsonSchema()),
		],
		stdin:
			"You MUST Read the file src/main.ts before answering. Then produce the structured " +
			"output describing what it exports.",
		timeoutMs: SMALL_CAPTURE_TIMEOUT_MS,
	});

	writeCrashFixture(hooknoise.stdoutLines);
}

/** crash.jsonl: the hooknoise capture truncated before its result event —
 * the stream a child that died mid-run leaves behind; #exit 1 stands in for
 * the non-zero exit of a crashed process. */
function writeCrashFixture(sourceLines) {
	const truncated = [];
	for (const line of sourceLines) {
		if (eventType(line) === "result") {
			break;
		}
		truncated.push(line);
	}
	writeFixtureFile("crash", [...truncated, "#exit 1"]);
	appendFileSync(
		README_PATH,
		`\n### crash.jsonl\n\nCaptured ${today} against ${claudeVersion}. the hooknoise capture ` +
			"hand-trimmed to end before any result event, plus `#exit 1`: the stream a crashed " +
			"child leaves behind (adapter must map it to 'crashed'). Derived from " +
			"hooknoise.jsonl, not a separate CLI run.\n",
	);
	process.stdout.write("wrote crash.jsonl (derived)\n");
}

async function capture({ name, note, argv, stdin, timeoutMs }) {
	const run = await runClaude({ argv, stdin, timeoutMs });
	if (run.timedOut) {
		throw new Error(`${name}: timed out after ${timeoutMs}ms`);
	}
	if (run.stdoutLines.length === 0) {
		throw new Error(
			`${name}: no stream emitted; stderr: ${run.stderr.slice(0, 500)}`,
		);
	}
	const lines = [...run.stdoutLines];
	if (run.exitCode !== 0) {
		lines.push(`#exit ${run.exitCode}`);
	}
	writeFixtureFile(name, lines);
	appendReadmeEntry({
		name,
		note,
		argvShown: displayArgv(argv),
		stdinBytes: Buffer.byteLength(stdin),
	});
	process.stdout.write(
		`wrote ${name}.jsonl (${run.stdoutLines.length} events, exit ${run.exitCode})\n`,
	);
	return run;
}

function writeFixtureFile(name, lines) {
	writeFileSync(join(FIXTURES_DIR, `${name}.jsonl`), `${lines.join("\n")}\n`);
}

function appendReadmeEntry({ name, note, argvShown, stdinBytes }) {
	appendFileSync(
		README_PATH,
		`\n### ${name}.jsonl\n\nCaptured ${today} against ${claudeVersion}. ${note}\n` +
			`Prompt delivered on stdin (${stdinBytes} bytes, TASK-005's primary path).\n` +
			`\`claude ${argvShown}\`\n`,
	);
}

/** the inline --json-schema value is elided in the README; the schemas live in this script */
function displayArgv(argv) {
	return argv
		.map((member) =>
			member.startsWith("{")
				? "<inline JSON Schema, see scripts/capture-claude-fixtures.mjs>"
				: member,
		)
		.join(" ");
}

// --- plumbing ----------------------------------------------------------------

function runClaude({ argv, stdin, timeoutMs }) {
	return new Promise((resolve, reject) => {
		const child = spawn("claude", argv, {
			cwd: repoDir,
			shell: false,
			stdio: ["pipe", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		let timedOut = false;
		const killTimer = setTimeout(() => {
			timedOut = true;
			child.kill("SIGKILL");
		}, timeoutMs);
		child.stdout.on("data", (chunk) => {
			stdout += chunk;
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
		});
		child.on("error", (error) => {
			clearTimeout(killTimer);
			reject(error);
		});
		child.on("close", (code) => {
			clearTimeout(killTimer);
			resolve({
				exitCode: code,
				timedOut,
				stderr,
				stdoutLines: stdout.split("\n").filter((line) => line.trim() !== ""),
			});
		});
		child.stdin.end(stdin);
	});
}

function lastResultEvent(lines) {
	for (let i = lines.length - 1; i >= 0; i--) {
		try {
			const event = JSON.parse(lines[i]);
			if (event.type === "result") {
				return event;
			}
		} catch {
			// not JSON — skip
		}
	}
	return null;
}

function eventType(line) {
	try {
		return JSON.parse(line).type;
	} catch {
		return null;
	}
}

async function buildScratchRepo(root) {
	const dir = join(root, "miniweb");
	await mkdir(join(dir, "src"), { recursive: true });
	const git = (...args) =>
		execFile("git", args, {
			cwd: dir,
			env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
		});

	await writeFile(
		join(dir, "src", "main.ts"),
		'import { greet } from "./greeting";\n\nexport function run(): string {\n\treturn greet("world");\n}\n',
	);
	await writeFile(
		join(dir, "src", "greeting.ts"),
		"export function greet(name: string): string {\n\treturn `hello, ${name}`;\n}\n",
	);
	await writeFile(
		join(dir, "README.md"),
		"# miniweb\n\nA tiny fixture project.\n",
	);
	await git("init");
	await git("add", "-A");
	await git(
		"-c",
		"user.email=fixture@example.com",
		"-c",
		"user.name=fixture",
		"commit",
		"-m",
		"base",
	);

	// the "reviewed revision": greeting gains an exclamation option, main uses it
	await writeFile(
		join(dir, "src", "greeting.ts"),
		"export function greet(name: string, excited = false): string {\n\tconst base = `hello, ${name}`;\n\treturn excited ? `${base}!` : base;\n}\n",
	);
	await writeFile(
		join(dir, "src", "main.ts"),
		'import { greet } from "./greeting";\n\nexport function run(): string {\n\treturn greet("world", true);\n}\n',
	);
	await git("add", "-A");
	await git(
		"-c",
		"user.email=fixture@example.com",
		"-c",
		"user.name=fixture",
		"commit",
		"-m",
		"add excited greeting",
	);
	return dir;
}

function buildComprehensionPrompt() {
	// A hand-numbered NUD sample (the Phase 3 serializer does not exist yet);
	// line numbers match the scratch repo's real content at HEAD.
	return [
		"You are analyzing a code change for a reviewer. The working directory contains the",
		"code at the reviewed revision. Use the Read tool on at least one file, the Grep tool",
		"at least once, and the Glob tool at least once to ground yourself before answering.",
		"",
		"Changeset: local commit range base..HEAD in this repository.",
		"",
		"=== FILE F1  src/greeting.ts  (modified, +3 −2)",
		"@@ HUNK F1h1 @@ -1,3 +1,4 @@ greet",
		"     1 |      . | -export function greet(name: string): string {",
		"     2 |      . | -\treturn `hello, ${name}`;",
		"     . |      1 | +export function greet(name: string, excited = false): string {",
		"     . |      2 | +\tconst base = `hello, ${name}`;",
		"     . |      3 | +\treturn excited ? `${base}!` : base;",
		"     3 |      4 |  }",
		"",
		"=== FILE F2  src/main.ts  (modified, +1 −1)",
		"@@ HUNK F2h1 @@ -3,3 +3,3 @@ run",
		"     3 |      3 |  export function run(): string {",
		'     4 |      . | -\treturn greet("world");',
		'     . |      4 | +\treturn greet("world", true);',
		"     5 |      5 |  }",
		"",
		"Produce the comprehension object for this change: an intent map with clusters over",
		"the two files (use the hunk ids F1h1 and F2h1), a short guided walkthrough, one to",
		"three anchored explanations (anchor on the new side, using the printed new line",
		"numbers), and per-hunk risk scores.",
	].join("\n");
}

/**
 * CON-014: the task schemas come from `src/application/analysis/` through the
 * production `toJsonSchema`, never from a copy living in this file.
 *
 * A hand-embedded copy is what made the draft-2020-12 outage invisible — the
 * capture proved the CLI accepted a schema prreview never actually sent, so a
 * green fixture and a broken product coexisted happily. This file is `.mjs`
 * and cannot import TypeScript, hence the tsx hop.
 */
async function dumpTaskSchemas() {
	const dumper = fileURLToPath(
		new URL("./dump-task-schemas.ts", import.meta.url),
	);
	const tsx = fileURLToPath(
		new URL("../node_modules/.bin/tsx", import.meta.url),
	);
	const { stdout } = await execFile(tsx, [dumper], { maxBuffer: 10_000_000 });
	return JSON.parse(stdout);
}

function maxTurnsProbeJsonSchema() {
	return {
		type: "object",
		properties: {
			exports: { type: "array", items: { type: "string" } },
			summary: { type: "string" },
		},
		required: ["exports", "summary"],
		additionalProperties: false,
	};
}
