import { readFileSync } from "node:fs";
import gitDiffParser from "gitdiff-parser";

const FIXTURES_DIRECTORY = new URL("../fixtures/diffs/", import.meta.url);

/**
 * Reads a checked-in raw `git diff` fixture and runs it through the real
 * gitdiff-parser, exactly as production callers will. Passing the result to
 * parseDiff also proves, at compile time, that gitdiff-parser's output is
 * assignable to the domain's structural input types.
 */
export function loadDiffFixture(name: string) {
	const diffText = readFileSync(new URL(name, FIXTURES_DIRECTORY), "utf8");
	return gitDiffParser.parse(diffText);
}
