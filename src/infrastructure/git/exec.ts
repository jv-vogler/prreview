import { spawn } from "node:child_process";

/**
 * Anything larger than this is not a payload prreview should hold in memory;
 * the blob endpoint enforces its own much smaller limit on top.
 */
const DEFAULT_MAX_OUTPUT_BYTES = 10 * 1024 * 1024;

export interface ExecOptions {
	cwd?: string;
	/** extra variables layered over process.env for this one spawn */
	env?: Record<string, string>;
	/** kill the child and fail once this elapses; default: no timeout */
	timeoutMs?: number;
	/** default 10MB; exceeding it kills the child and fails */
	maxOutputBytes?: number;
	/** written to the child's stdin and closed; omitted, stdin is /dev/null */
	stdin?: string;
}

/**
 * The raw failure of a spawned command: adapters throw raw, never AppError.
 * Use-cases convert this into app meaning; nothing below the application
 * layer interprets it. stderr rides along as `cause` and as an own field for
 * programmatic access.
 */
export class ExecError extends Error {
	readonly command: string;
	readonly args: readonly string[];
	/** null when the child never exited normally (killed, timed out) */
	readonly exitCode: number | null;
	readonly stderr: string;
	readonly timedOut: boolean;

	constructor(details: {
		command: string;
		args: readonly string[];
		exitCode: number | null;
		stderr: string;
		timedOut?: boolean;
		messageSuffix?: string;
	}) {
		const summary = `${details.command} ${details.args.join(" ")}`;
		super(
			`${summary} failed${details.messageSuffix ?? ` with exit code ${details.exitCode}`}`,
			{ cause: details.stderr },
		);
		this.name = "ExecError";
		this.command = details.command;
		this.args = details.args;
		this.exitCode = details.exitCode;
		this.stderr = details.stderr;
		this.timedOut = details.timedOut ?? false;
	}
}

/**
 * Thin `child_process.spawn` wrapper: argv array, `shell: false`, so no
 * interpolation ever reaches a shell. Resolves with stdout decoded as utf8;
 * rejects with ExecError on nonzero exit, timeout, output overflow, or spawn
 * failure (ENOENT propagates as-is from node).
 */
export function exec(
	command: string,
	args: readonly string[],
	options: ExecOptions = {},
): Promise<string> {
	return run(command, args, options).then((stdout) => stdout.toString("utf8"));
}

/** Same contract as exec, but stdout stays raw bytes — for blob reads. */
export function execBuffer(
	command: string,
	args: readonly string[],
	options: ExecOptions = {},
): Promise<Buffer> {
	return run(command, args, options);
}

function run(
	command: string,
	args: readonly string[],
	options: ExecOptions,
): Promise<Buffer> {
	const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;

	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd: options.cwd,
			env: options.env ? { ...process.env, ...options.env } : process.env,
			shell: false,
			stdio: ["pipe", "pipe", "pipe"],
		});

		// A child that exits before reading stdin (a fast-failing `gh`/`git`
		// invocation) turns this write into an EPIPE. The exit code is already
		// what gets reported below; an unhandled 'error' here would otherwise
		// crash the process instead.
		child.stdin.on("error", () => {});
		if (options.stdin === undefined) {
			child.stdin.end();
		} else {
			child.stdin.end(options.stdin, "utf8");
		}

		const stdoutChunks: Buffer[] = [];
		const stderrChunks: Buffer[] = [];
		let stdoutBytes = 0;
		let settled = false;
		let timedOut = false;
		let overflowed = false;

		// Killing the child is not enough to unblock the 'close' event: a
		// grandchild (sh's sleep, git's subprocess) can inherit the stdio pipes
		// and keep them open forever. Dropping our read ends guarantees 'close'.
		const killChild = () => {
			child.kill("SIGKILL");
			child.stdout.destroy();
			child.stderr.destroy();
		};

		const timer =
			options.timeoutMs === undefined
				? undefined
				: setTimeout(() => {
						timedOut = true;
						killChild();
					}, options.timeoutMs);

		const settle = (outcome: { ok: true } | { ok: false; error: Error }) => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timer);
			if (outcome.ok) {
				resolve(Buffer.concat(stdoutChunks));
			} else {
				reject(outcome.error);
			}
		};

		child.stdout.on("data", (chunk: Buffer) => {
			stdoutBytes += chunk.length;
			if (stdoutBytes > maxOutputBytes) {
				overflowed = true;
				killChild();
				return;
			}
			stdoutChunks.push(chunk);
		});
		child.stderr.on("data", (chunk: Buffer) => {
			stderrChunks.push(chunk);
		});

		// Spawn-level failure (ENOENT and friends): the rawest error there is.
		child.on("error", (error) => settle({ ok: false, error }));

		child.on("close", (exitCode) => {
			const stderr = Buffer.concat(stderrChunks).toString("utf8");
			if (timedOut) {
				settle({
					ok: false,
					error: new ExecError({
						command,
						args,
						exitCode,
						stderr,
						timedOut: true,
						messageSuffix: `: timed out after ${options.timeoutMs}ms`,
					}),
				});
				return;
			}
			if (overflowed) {
				settle({
					ok: false,
					error: new ExecError({
						command,
						args,
						exitCode,
						stderr,
						messageSuffix: `: output exceeded ${maxOutputBytes} bytes`,
					}),
				});
				return;
			}
			if (exitCode !== 0) {
				settle({
					ok: false,
					error: new ExecError({ command, args, exitCode, stderr }),
				});
				return;
			}
			settle({ ok: true });
		});
	});
}
