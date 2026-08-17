#!/usr/bin/env node
// probe.mjs — opt-in prober for the three depth/fan-out questions the
// findings engine depends on. Answers, in one run:
//
//   Q1 --max-budget-usd exhaustion semantics: what does the CLI emit and exit
//      with when a run hits the ceiling? The depth dialog turns a number into
//      this flag, so "what does exhaustion look like" decides whether the run
//      surfaces a typed failure or a silent truncation.
//   Q2 --effort behavior: is it accepted alongside our flag set, and does it
//      visibly change turns/cost/duration? Depth uses --effort, never --model.
//   Q3 5-way concurrent --fork-session: the lens fan-out runs up to 5 children
//      resuming one comprehension session at once. The existing evidence
//      covers 2 (spikes/resume-forks). This checks 5, and that the parent
//      session file does not grow.
//
// Spends real tokens (all runs --model haiku, tiny prompts, low turn caps), so
// it refuses without PRREVIEW_REAL_CLAUDE=1. Everything happens in a scratch
// git repo under the OS temp dir — never inside this repository.
//
// Usage: PRREVIEW_REAL_CLAUDE=1 node spikes/depth-and-fanout/probe.mjs
// Writes: spikes/depth-and-fanout/capture.json

import { execFile as execFileCallback, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

const CAPTURE_PATH = fileURLToPath(new URL("./capture.json", import.meta.url));
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
const PROBE_TIMEOUT_MS = 240_000;
const FANOUT_WAYS = 5;

if (process.env.PRREVIEW_REAL_CLAUDE !== "1") {
	process.stderr.write(
		"depth-and-fanout: refusing to run — this spends real tokens.\n" +
			"Set PRREVIEW_REAL_CLAUDE=1 to opt in.\n",
	);
	process.exit(1);
}

const claudeVersion = (await execFile("claude", ["--version"])).stdout.trim();
const scratchRoot = mkdtempSync(join(tmpdir(), "prreview-depth-"));
const repoDir = await buildScratchRepo(scratchRoot);

process.stdout.write(`probing ${claudeVersion} in ${repoDir}\n\n`);

const capture = { claudeVersion, model: MODEL, probedAt: new Date().toISOString() };
try {
	capture.budget = await probeBudgetExhaustion();
	capture.effort = await probeEffort();
	capture.fanout = await probeConcurrentForks();
} finally {
	writeFileSync(CAPTURE_PATH, `${JSON.stringify(capture, null, "\t")}\n`);
	rmSync(scratchRoot, { recursive: true, force: true });
	process.stdout.write(`\nwrote ${CAPTURE_PATH}\n`);
}

// --- Q1: what does --max-budget-usd exhaustion look like? --------------------

async function probeBudgetExhaustion() {
	process.stdout.write("== Q1: --max-budget-usd exhaustion ==\n");
	const results = {};

	// A ceiling so low the first turn cannot fit under it, against a task that
	// genuinely needs several turns. If the CLI enforces pre-flight, we see it
	// refuse; if it enforces mid-run, we see where it stops.
	for (const budget of ["0.0001", "0.01"]) {
		const run = await runClaude({
			argv: [
				...STREAM_FLAGS,
				"--model",
				MODEL,
				...READ_ONLY_TOOL_FLAGS,
				"--max-turns",
				"12",
				"--max-budget-usd",
				budget,
			],
			stdin:
				"Read every .ts file under src/, then summarize in one sentence what this " +
				"project does. Use the Read tool at least three times before answering.",
		});
		const result = lastResultEvent(run.stdoutLines);
		results[budget] = {
			exitCode: run.exitCode,
			timedOut: run.timedOut,
			eventTypes: uniqueEventTypes(run.stdoutLines),
			stderrHead: run.stderr.slice(0, 400),
			result: summarizeResult(result),
		};
		process.stdout.write(
			`  budget ${budget}: exit ${run.exitCode}, ` +
				`subtype ${result?.subtype ?? "none"}, ` +
				`cost ${result?.total_cost_usd ?? "n/a"}, turns ${result?.num_turns ?? "n/a"}\n`,
		);
	}
	return results;
}

// --- Q2: does --effort do anything, and is it accepted? ----------------------

async function probeEffort() {
	process.stdout.write("== Q2: --effort ==\n");
	const results = {};
	const prompt =
		"In one sentence, what is the difference between a mutex and a semaphore? " +
		"Do not use any tools.";

	for (const effort of ["low", "medium", "high"]) {
		const startedAt = Date.now();
		const run = await runClaude({
			argv: [
				...STREAM_FLAGS,
				"--model",
				MODEL,
				...READ_ONLY_TOOL_FLAGS,
				"--max-turns",
				"4",
				"--effort",
				effort,
			],
			stdin: prompt,
		});
		const result = lastResultEvent(run.stdoutLines);
		results[effort] = {
			accepted: run.exitCode === 0,
			exitCode: run.exitCode,
			wallMs: Date.now() - startedAt,
			stderrHead: run.stderr.slice(0, 300),
			result: summarizeResult(result),
		};
		process.stdout.write(
			`  effort ${effort}: exit ${run.exitCode}, ` +
				`${Date.now() - startedAt}ms, cost ${result?.total_cost_usd ?? "n/a"}, ` +
				`turns ${result?.num_turns ?? "n/a"}\n`,
		);
	}
	return results;
}

// --- Q3: five concurrent --fork-session resumes ------------------------------

async function probeConcurrentForks() {
	process.stdout.write(`== Q3: ${FANOUT_WAYS}-way concurrent --fork-session ==\n`);

	const parent = await runClaude({
		argv: [...STREAM_FLAGS, "--model", MODEL, "--max-turns", "3"],
		stdin:
			"Note for later: the project's release codename is 'kumquat'. " +
			"Reply with just: noted",
	});
	const parentResult = lastResultEvent(parent.stdoutLines);
	const parentSessionId = parentResult?.session_id;
	if (typeof parentSessionId !== "string") {
		return { error: "no parent session id", parentExit: parent.exitCode };
	}
	const sessionFile = findSessionFile(parentSessionId);
	const linesBefore = countLines(sessionFile);
	process.stdout.write(
		`  parent ${parentSessionId} (${linesBefore ?? "?"} session lines)\n`,
	);

	// all five launched simultaneously, each a different lens-shaped question
	const lenses = ["correctness", "security", "edge-cases", "design", "impact"];
	const forks = await Promise.all(
		lenses.map((lens) =>
			runClaude({
				argv: [
					...STREAM_FLAGS,
					"--model",
					MODEL,
					...READ_ONLY_TOOL_FLAGS,
					"--max-turns",
					"3",
					"--resume",
					parentSessionId,
					"--fork-session",
				],
				stdin:
					`You are the ${lens} lens. Reply with exactly the release codename ` +
					"you were told earlier, then the word " + lens + ".",
			}),
		),
	);

	const perFork = forks.map((run, index) => {
		const result = lastResultEvent(run.stdoutLines);
		const text = typeof result?.result === "string" ? result.result : "";
		return {
			lens: lenses[index],
			exitCode: run.exitCode,
			newSessionId: result?.session_id ?? null,
			forkedAway: result?.session_id !== parentSessionId,
			sawParentContext: /kumquat/i.test(text),
			stderrHead: run.stderr.slice(0, 200),
			result: summarizeResult(result),
		};
	});

	const linesAfter = countLines(sessionFile);
	const distinctIds = new Set(
		perFork.map((fork) => fork.newSessionId).filter((id) => id !== null),
	);
	const summary = {
		parentSessionId,
		sessionFile,
		parentSessionLinesBefore: linesBefore,
		parentSessionLinesAfter: linesAfter,
		parentSessionGrew: linesBefore !== null && linesAfter !== null
			? linesAfter - linesBefore
			: null,
		parentSessionStillValidJsonl: isValidJsonl(sessionFile),
		allExitedZero: perFork.every((fork) => fork.exitCode === 0),
		allForkedAway: perFork.every((fork) => fork.forkedAway),
		allDistinctSessionIds: distinctIds.size === perFork.length,
		allSawParentContext: perFork.every((fork) => fork.sawParentContext),
		perFork,
	};
	process.stdout.write(
		`  ${perFork.filter((f) => f.exitCode === 0).length}/${FANOUT_WAYS} exited 0, ` +
			`${perFork.filter((f) => f.sawParentContext).length}/${FANOUT_WAYS} saw parent context, ` +
			`parent file grew by ${summary.parentSessionGrew ?? "?"} lines\n`,
	);
	return summary;
}

// --- plumbing ----------------------------------------------------------------

/** session files live under ~/.claude/projects/<cwd-slug>/<session-id>.jsonl */
function findSessionFile(sessionId) {
	const slug = repoDir.replace(/[/.]/g, "-");
	const candidate = join(homedir(), ".claude", "projects", slug, `${sessionId}.jsonl`);
	return existsSync(candidate) ? candidate : null;
}

function countLines(path) {
	if (path === null) return null;
	try {
		return readFileSync(path, "utf8").split("\n").filter((l) => l.trim() !== "").length;
	} catch {
		return null;
	}
}

function isValidJsonl(path) {
	if (path === null) return null;
	try {
		for (const line of readFileSync(path, "utf8").split("\n")) {
			if (line.trim() === "") continue;
			JSON.parse(line);
		}
		return true;
	} catch {
		return false;
	}
}

function summarizeResult(result) {
	if (result === null) return null;
	return {
		subtype: result.subtype ?? null,
		isError: result.is_error ?? null,
		terminalReason: result.terminal_reason ?? null,
		numTurns: result.num_turns ?? null,
		costUsd: result.total_cost_usd ?? null,
		durationMs: result.duration_ms ?? null,
		hasStructuredOutput:
			result.structured_output !== null && result.structured_output !== undefined,
		textHead:
			typeof result.result === "string" ? result.result.slice(0, 200) : null,
	};
}

function uniqueEventTypes(lines) {
	const types = new Set();
	for (const line of lines) {
		try {
			const event = JSON.parse(line);
			types.add(
				event.subtype === undefined ? event.type : `${event.type}:${event.subtype}`,
			);
		} catch {
			// non-JSON line — ignore
		}
	}
	return [...types];
}

function lastResultEvent(lines) {
	for (let i = lines.length - 1; i >= 0; i--) {
		try {
			const event = JSON.parse(lines[i]);
			if (event.type === "result") return event;
		} catch {
			// not JSON — skip
		}
	}
	return null;
}

function runClaude({ argv, stdin }) {
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
		}, PROBE_TIMEOUT_MS);
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
	await writeFile(join(dir, "README.md"), "# miniweb\n\nA tiny fixture project.\n");
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
	return dir;
}
