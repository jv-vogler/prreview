import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const CLAUDE_FAKE = fileURLToPath(new URL("./claude", import.meta.url));

function run(
	args: string[],
	options: { input?: string } = {},
): { code: number; stderr: string; stdout: string } {
	const result = spawnSync(CLAUDE_FAKE, args, {
		input: options.input ?? "",
		encoding: "utf8",
	});
	return {
		code: result.status ?? 1,
		stdout: result.stdout,
		stderr: result.stderr,
	};
}

describe("test/bin/claude", () => {
	it("refuses -p --output-format stream-json missing --verbose (CON-001)", () => {
		const result = run(["-p", "--output-format", "stream-json"]);
		expect(result.code).toBe(1);
		expect(result.stderr).toContain("requires --verbose");
	});

	it("accepts the baseline with --verbose present", () => {
		process.env.FAKE_CLAUDE_FIXTURE = fileURLToPath(
			new URL("../fixtures/claude/success.jsonl", import.meta.url),
		);
		const result = run([
			"-p",
			"--output-format",
			"stream-json",
			"--verbose",
			"--json-schema",
			'{"type":"object"}',
		]);
		delete process.env.FAKE_CLAUDE_FIXTURE;
		expect(result.code).toBe(0);
		expect(result.stdout).toContain("sess-success");
	});

	it("refuses a draft-2020-12 --json-schema (CON-002)", () => {
		const schema = JSON.stringify({
			$schema: "https://json-schema.org/draft/2020-12/schema",
			type: "object",
		});
		const result = run([
			"-p",
			"--output-format",
			"stream-json",
			"--verbose",
			"--json-schema",
			schema,
		]);
		expect(result.code).toBe(1);
		expect(result.stderr).toContain("not a valid JSON Schema");
	});

	it("answers --version", () => {
		const result = run(["--version"]);
		expect(result.code).toBe(0);
		expect(result.stdout).toContain("Claude Code");
	});
});
