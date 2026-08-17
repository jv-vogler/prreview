import { describe, expect, it } from "vitest";
import { buildChatArgv, buildTaskArgv, buildVersionArgv } from "./argv";

const TASK_OPTIONS = {
	jsonSchema: '{"type":"object"}',
	maxTurns: 30,
	systemContract: "contract text",
};

function valueAfter(argv: string[], flag: string): string | undefined {
	const index = argv.indexOf(flag);
	return index === -1 ? undefined : argv[index + 1];
}

describe("buildTaskArgv", () => {
	it("emits the §7 baseline in fixed order", () => {
		expect(buildTaskArgv(TASK_OPTIONS)).toEqual([
			"-p",
			"--output-format",
			"stream-json",
			"--verbose",
			"--allowedTools",
			"Read,Glob,Grep",
			"--disallowedTools",
			"Write,Edit,Bash",
			"--permission-mode",
			"dontAsk",
			"--max-turns",
			"30",
			"--append-system-prompt",
			"contract text",
			"--json-schema",
			'{"type":"object"}',
		]);
	});

	it("includes --verbose, without which the real CLI exits 1 (CON-001)", () => {
		expect(buildTaskArgv(TASK_OPTIONS)).toContain("--verbose");
	});

	it("never passes --model: the user's configured default is deliberate", () => {
		expect(buildTaskArgv(TASK_OPTIONS)).not.toContain("--model");
	});

	it("passes the schema inline, never as a file or @file (CON-005)", () => {
		const argv = buildTaskArgv(TASK_OPTIONS);
		expect(valueAfter(argv, "--json-schema")).toBe('{"type":"object"}');
	});

	it("adds --fork-session with a forking resume (CON-004)", () => {
		const argv = buildTaskArgv({
			...TASK_OPTIONS,
			resume: { sessionId: "sess-1", fork: true },
		});
		expect(argv.slice(-3)).toEqual(["--resume", "sess-1", "--fork-session"]);
	});

	it("omits --fork-session on a plain resume", () => {
		const argv = buildTaskArgv({
			...TASK_OPTIONS,
			resume: { sessionId: "sess-1", fork: false },
		});
		expect(argv.slice(-2)).toEqual(["--resume", "sess-1"]);
		expect(argv).not.toContain("--fork-session");
	});

	it("omits resume flags entirely for a fresh session", () => {
		const argv = buildTaskArgv(TASK_OPTIONS);
		expect(argv).not.toContain("--resume");
		expect(argv).not.toContain("--fork-session");
	});

	it("keeps the prompt out of argv (SEC-002)", () => {
		const argv = buildTaskArgv(TASK_OPTIONS);
		expect(
			argv.some((member) => member.includes("numbered unified diff")),
		).toBe(false);
	});
});

describe("buildChatArgv", () => {
	it("streams tokens and carries no output schema (§7)", () => {
		const argv = buildChatArgv({ maxTurns: 12 });
		expect(argv).toContain("--include-partial-messages");
		expect(argv).not.toContain("--json-schema");
		expect(argv).toContain("--verbose");
	});

	it("keeps the read-only tool contract (SEC-001)", () => {
		const argv = buildChatArgv({ maxTurns: 12 });
		expect(valueAfter(argv, "--allowedTools")).toBe("Read,Glob,Grep");
		expect(valueAfter(argv, "--disallowedTools")).toBe("Write,Edit,Bash");
		expect(valueAfter(argv, "--permission-mode")).toBe("dontAsk");
	});

	it("forks the analysis session on the thread's first turn (CON-004)", () => {
		const argv = buildChatArgv({
			maxTurns: 12,
			resume: { sessionId: "analysis-session", fork: true },
		});
		expect(argv.slice(-3)).toEqual([
			"--resume",
			"analysis-session",
			"--fork-session",
		]);
	});

	it("plain-resumes its own thread on later turns", () => {
		const argv = buildChatArgv({
			maxTurns: 12,
			resume: { sessionId: "thread-session", fork: false },
		});
		expect(argv).not.toContain("--fork-session");
		expect(valueAfter(argv, "--resume")).toBe("thread-session");
	});
});

describe("buildVersionArgv", () => {
	it("is just --version (the probe's only contact with the agent)", () => {
		expect(buildVersionArgv()).toEqual(["--version"]);
	});
});
