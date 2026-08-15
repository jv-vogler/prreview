import { Command, InvalidArgumentError, Option } from "commander";

export const DEFAULT_PORT = 4973;

/** The whole CLI surface, exactly PRODUCT.md §13 (REQ-002) — nothing else. */
export interface CliArgs {
	target?: string;
	base?: string;
	port: number;
	open: boolean;
	dev: boolean;
}

/**
 * Parses argv. Throws CommanderError (exitOverride) instead of exiting so
 * the CLI's single boot catch owns every exit code: usage errors are 2,
 * help/version displays are 0.
 */
export function parseCliArgs(argv: readonly string[]): CliArgs {
	const program = new Command()
		.name("prreview")
		.description(
			"Review a PR, branch, commit range, or your working tree in a local GitHub-style diff viewer.",
		)
		.argument(
			"[target]",
			"a PR number or URL, a branch, a <from>..<to> range, or `working` (omit to auto-detect)",
		)
		.argument("[base]", "explicit base branch (for stacked branches)")
		.option(
			"--port <number>",
			"preferred port; walks upward when taken",
			parsePort,
			DEFAULT_PORT,
		)
		.option("--no-open", "do not open the browser")
		// internal dev-loop flag (ARCHITECTURE §16): skips static serving and
		// browser-open, pins the port; deliberately not part of the surface
		.addOption(new Option("--dev").hideHelp())
		.exitOverride();

	program.parse([...argv]);

	const [target, base] = program.args;
	const options = program.opts<{
		port: number;
		open: boolean;
		dev?: boolean;
	}>();
	return {
		...(target === undefined ? {} : { target }),
		...(base === undefined ? {} : { base }),
		port: options.port,
		open: options.open,
		dev: options.dev === true,
	};
}

function parsePort(value: string): number {
	const port = Number(value);
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		throw new InvalidArgumentError("must be a port number (1-65535)");
	}
	return port;
}
