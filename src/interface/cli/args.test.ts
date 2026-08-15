import { CommanderError } from "commander";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_PORT, parseCliArgs } from "./args";

const ARGV_PREFIX = ["node", "prreview"];

function parse(rest: string[]) {
	return parseCliArgs([...ARGV_PREFIX, ...rest]);
}

describe("parseCliArgs", () => {
	it("defaults to auto-detect, port 4973, open, not dev", () => {
		expect(parse([])).toEqual({
			port: DEFAULT_PORT,
			open: true,
			dev: false,
		});
	});

	it("takes target and base positionals", () => {
		expect(parse(["feat-x", "main"])).toMatchObject({
			target: "feat-x",
			base: "main",
		});
	});

	it("parses --port and --no-open", () => {
		expect(parse(["482", "--port", "5000", "--no-open"])).toMatchObject({
			target: "482",
			port: 5000,
			open: false,
		});
	});

	it("accepts the hidden --dev flag", () => {
		expect(parse(["--dev"]).dev).toBe(true);
	});

	it("hides --dev from the help text", () => {
		const stdout = vi
			.spyOn(process.stdout, "write")
			.mockImplementation(() => true);
		try {
			expect(() => parse(["--help"])).toThrowError(CommanderError);
			const helpText = stdout.mock.calls.map((call) => call[0]).join("");
			expect(helpText).toContain("--no-open");
			expect(helpText).not.toContain("--dev");
		} finally {
			stdout.mockRestore();
		}
	});

	it("throws a zero-exit CommanderError for --help", () => {
		const stdout = vi
			.spyOn(process.stdout, "write")
			.mockImplementation(() => true);
		try {
			parse(["--help"]);
			expect.unreachable("--help must throw");
		} catch (error) {
			expect(error).toBeInstanceOf(CommanderError);
			expect((error as CommanderError).exitCode).toBe(0);
		} finally {
			stdout.mockRestore();
		}
	});

	it("throws a nonzero CommanderError on an unknown option", () => {
		const stderr = vi
			.spyOn(process.stderr, "write")
			.mockImplementation(() => true);
		try {
			parse(["--host", "0.0.0.0"]);
			expect.unreachable("unknown options must throw");
		} catch (error) {
			expect(error).toBeInstanceOf(CommanderError);
			expect((error as CommanderError).exitCode).not.toBe(0);
		} finally {
			stderr.mockRestore();
		}
	});

	it("rejects a non-numeric --port", () => {
		const stderr = vi
			.spyOn(process.stderr, "write")
			.mockImplementation(() => true);
		try {
			expect(() => parse(["--port", "not-a-port"])).toThrowError(
				CommanderError,
			);
			expect(() => parse(["--port", "70000"])).toThrowError(CommanderError);
		} finally {
			stderr.mockRestore();
		}
	});
});
