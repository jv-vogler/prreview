import { spawn } from "node:child_process";

const DEFAULT_MAX_OUTPUT_BYTES = 10 * 1024 * 1024;

export interface ExecOptions {
	cwd?: string;
	env?: Record<string, string | undefined>;
	timeoutMs?: number;
	maxOutputBytes?: number;
	stdin?: string;
}

export class ExecError extends Error {
	readonly command: string;
	readonly args: readonly string[];
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

export function exec(
	command: string,
	args: readonly string[],
	options: ExecOptions = {},
): Promise<string> {
	return run(command, args, options).then((stdout) => stdout.toString("utf8"));
}

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
