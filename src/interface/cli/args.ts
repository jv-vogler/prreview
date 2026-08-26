import { Command, InvalidArgumentError, Option } from "commander";

export const DEFAULT_PORT = 4973;

export interface CliArgs {
	target?: string;
	base?: string;
	port: number;
	open: boolean;
	dev: boolean;
}

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
