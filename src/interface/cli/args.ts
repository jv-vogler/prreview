import { Command, InvalidArgumentError, Option } from "commander";

export const DEFAULT_PORT = 4973;

/**
 * The whole CLI surface (REQ-002) — nothing else.
 *
 * `--brain` is the one addition since the surface was frozen, and it earns its
 * place: it is the only way to make a review measure against *your* team's
 * standards rather than a generic sense of what is worth raising, and there is
 * no config file to put it in.
 */
export interface CliArgs {
	target?: string;
	base?: string;
	port: number;
	open: boolean;
	dev: boolean;
	/** a path or URL to review guidelines */
	brain?: string;
	/** `layer` adds to prreview's taste; `replace` swaps taste only */
	brainMode: "layer" | "replace";
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
		.option(
			"--brain <file|url>",
			"review guidelines to apply: a local path, a GitHub URL (fetched through gh), or an https URL",
		)
		.addOption(
			new Option(
				"--brain-mode <mode>",
				"whether your guidelines add to prreview's judgement or replace it",
			)
				.choices(["layer", "replace"])
				.default("layer"),
		)
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
		brain?: string;
		brainMode: "layer" | "replace";
	}>();
	return {
		...(target === undefined ? {} : { target }),
		...(base === undefined ? {} : { base }),
		port: options.port,
		open: options.open,
		dev: options.dev === true,
		...(options.brain === undefined ? {} : { brain: options.brain }),
		brainMode: options.brainMode,
	};
}

function parsePort(value: string): number {
	const port = Number(value);
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		throw new InvalidArgumentError("must be a port number (1-65535)");
	}
	return port;
}
