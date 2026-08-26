import { readFileSync } from "node:fs";
import gitDiffParser from "gitdiff-parser";

const FIXTURES_DIRECTORY = new URL("../fixtures/diffs/", import.meta.url);

export function loadDiffFixture(name: string) {
	const diffText = readFileSync(new URL(name, FIXTURES_DIRECTORY), "utf8");
	return gitDiffParser.parse(diffText);
}
