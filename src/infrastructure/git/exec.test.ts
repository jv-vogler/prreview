import { describe, expect, it } from "vitest";
import { AppError } from "../../domain/errors/AppError";
import { ExecError, exec, execBuffer } from "./exec";

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
	try {
		await promise;
	} catch (error) {
		return error;
	}
	throw new Error("expected the promise to reject");
}

describe("exec", () => {
	it("resolves with stdout decoded as utf8", async () => {
		await expect(exec("sh", ["-c", "printf 'hello'"])).resolves.toBe("hello");
	});

	it("respects cwd", async () => {
		const output = await exec("sh", ["-c", "pwd"], { cwd: "/" });
		expect(output.trim()).toBe("/");
	});

	it("throws ExecError on nonzero exit, with stderr as cause and field", async () => {
		const error = await rejectionOf(
			exec("sh", ["-c", "echo went wrong >&2; exit 3"]),
		);
		expect(error).toBeInstanceOf(ExecError);
		const execError = error as ExecError;
		expect(execError.exitCode).toBe(3);
		expect(execError.stderr).toContain("went wrong");
		expect(execError.cause).toContain("went wrong");
	});

	it("is raw, not an AppError (use-cases convert, adapters do not)", async () => {
		const error = await rejectionOf(exec("sh", ["-c", "exit 1"]));
		expect(error).not.toBeInstanceOf(AppError);
	});

	it("propagates spawn failures (missing binary) as-is", async () => {
		const error = await rejectionOf(exec("prreview-no-such-binary", []));
		expect((error as NodeJS.ErrnoException).code).toBe("ENOENT");
		expect(error).not.toBeInstanceOf(ExecError);
	});

	it("kills the child and throws once the output cap is exceeded", async () => {
		const error = await rejectionOf(
			exec("sh", ["-c", "head -c 300000 /dev/zero"], {
				maxOutputBytes: 100_000,
			}),
		);
		expect(error).toBeInstanceOf(ExecError);
		expect((error as ExecError).message).toContain("exceeded");
	});

	it("kills the child and throws on timeout", async () => {
		const error = await rejectionOf(
			exec("sh", ["-c", "sleep 10"], { timeoutMs: 100 }),
		);
		expect(error).toBeInstanceOf(ExecError);
		expect((error as ExecError).timedOut).toBe(true);
	});

	it("never passes through a shell: metacharacters are literal argv", async () => {
		const output = await exec("printf", ["%s", "$(echo pwned); `boom`"]);
		expect(output).toBe("$(echo pwned); `boom`");
	});

	it("writes stdin and closes it, so a reader downstream sees EOF", async () => {
		const output = await exec("cat", [], { stdin: "piped in\n" });
		expect(output).toBe("piped in\n");
	});

	it("leaves stdin at /dev/null when none is given", async () => {
		const output = await exec("cat", []);
		expect(output).toBe("");
	});
});

describe("execBuffer", () => {
	it("returns stdout as raw bytes", async () => {
		const output = await execBuffer("sh", ["-c", "printf '\\000\\001\\377'"]);
		expect([...output]).toEqual([0, 1, 0xff]);
	});

	it("clears an inherited variable when its value is undefined", async () => {
		process.env.PRREVIEW_EXEC_PROBE = "leaked";
		try {
			const output = await exec(
				process.execPath,
				["-e", "process.stdout.write(String(process.env.PRREVIEW_EXEC_PROBE))"],
				{ env: { PRREVIEW_EXEC_PROBE: undefined } },
			);
			expect(output.trim()).toBe("undefined");
		} finally {
			delete process.env.PRREVIEW_EXEC_PROBE;
		}
	});
});
