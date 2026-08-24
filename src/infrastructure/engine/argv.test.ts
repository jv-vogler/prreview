import { describe, expect, it } from "vitest";
import { buildTaskArgv, buildVersionArgv } from "./argv";

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
	it("emits the fixed baseline in order", () => {
		expect(buildTaskArgv(TASK_OPTIONS)).toEqual([
			"-p",
			"--output-format",
			"stream-json",
			"--verbose",
			"--permission-mode",
			"bypassPermissions",
			"--allowedTools",
			"Bash,Read,Write,Edit,WebFetch,WebSearch,TaskCreate,TaskUpdate,TaskList,TaskGet",
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

	it("keeps Bash, Write and Edit available so findings stay verifiable (SEC-003)", () => {
		const argv = buildTaskArgv(TASK_OPTIONS);
		const allowed = (valueAfter(argv, "--allowedTools") ?? "").split(",");
		for (const tool of ["Bash", "Read", "Write", "Edit"]) {
			expect(allowed).toContain(tool);
		}
		expect(argv).not.toContain("--disallowedTools");
	});

	it("reaches the task-list tools, absent from -p mode without the flag", () => {
		const allowed = (
			valueAfter(buildTaskArgv(TASK_OPTIONS), "--allowedTools") ?? ""
		).split(",");
		for (const tool of ["TaskCreate", "TaskUpdate", "TaskList", "TaskGet"]) {
			expect(allowed).toContain(tool);
		}
	});

	it("passes the schema inline, never as a file or @file (CON-003)", () => {
		const argv = buildTaskArgv(TASK_OPTIONS);
		expect(valueAfter(argv, "--json-schema")).toBe('{"type":"object"}');
	});

	it("keeps the prompt out of argv (SEC-002, CON-004)", () => {
		const argv = buildTaskArgv(TASK_OPTIONS);
		expect(
			argv.some((member) => member.includes("numbered unified diff")),
		).toBe(false);
	});
});

describe("buildVersionArgv", () => {
	it("is just --version (the probe's only contact with the agent)", () => {
		expect(buildVersionArgv()).toEqual(["--version"]);
	});
});
