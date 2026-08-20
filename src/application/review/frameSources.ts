import type { ChangesetRef } from "../../domain/changeset/ChangesetRef";
import type { FileDiff } from "../../domain/changeset/FileDiff";
import type { Git } from "../ports/Git";
import type { ProjectFrameInput } from "./projectFrame";

/**
 * The project frame's raw material, read out of the repository.
 *
 * This exists because the frame was for a while the cheapest quality lever in
 * the pipeline and also the one nobody pulled: `runReview` built the frame from
 * an optional input, the route never passed it, so `detectTooling("")` returned
 * nothing and the "do not report what these tools already catch" section shipped
 * in **no** preset. Reading the sources here — inside the run, through the Git
 * port — is what makes that unforgettable: there is no argument left for a
 * caller to omit.
 *
 * Everything is read **at the reviewed revision**, not from whatever happens to
 * be checked out. A review of last week's PR should be told about last week's
 * conventions.
 */

export type FrameSources = Omit<ProjectFrameInput, "files">;

/** in priority order; the first one that exists and has text wins */
const README_CANDIDATES = ["README.md", "README.rst", "README.txt", "README"];
const CONVENTIONS_CANDIDATES = ["CLAUDE.md", "AGENTS.md"];
const MANIFEST_CANDIDATES = ["package.json", "pyproject.toml", "Cargo.toml"];

/** how many directories of the sample are worth listing (projectFrame caps too) */
const TREE_SAMPLE = 40;

export interface ReadFrameSourcesDeps {
	git: Git;
}

export interface ReadFrameSourcesInput {
	ref: ChangesetRef;
	files: readonly FileDiff[];
}

export async function readFrameSources(
	deps: ReadFrameSourcesDeps,
	input: ReadFrameSourcesInput,
): Promise<FrameSources> {
	const [readme, conventions, manifest] = await Promise.all([
		firstReadable(deps, input.ref, README_CANDIDATES),
		firstReadable(deps, input.ref, CONVENTIONS_CANDIDATES),
		firstReadable(deps, input.ref, MANIFEST_CANDIDATES),
	]);

	return {
		...optional("readme", readme),
		...optional("conventions", conventions),
		...optional("manifest", manifest),
		tree: layoutOf(input.files),
	};
}

/**
 * A missing README is not an error.
 *
 * Every source is caught individually and on purpose: `Git.readBlob` rejects
 * raw on a path that does not exist (CON-003), and one repo without a CLAUDE.md
 * must not cost the run its whole frame — which is exactly what a single
 * try/catch around all three would do.
 */
async function firstReadable(
	deps: ReadFrameSourcesDeps,
	ref: ChangesetRef,
	candidates: readonly string[],
): Promise<string | undefined> {
	for (const path of candidates) {
		const text = await readAtRevision(deps, ref, path);
		if (text !== undefined && text.trim() !== "") {
			return text;
		}
	}
	return undefined;
}

/**
 * The file as of the reviewed revision.
 *
 * `headSha` is null for the working-tree changeset — there is no commit to read
 * from, and the working copy *is* the revision under review — so that case
 * falls back to `readWorkingFile`, which is already contained to the repo root
 * (SEC-002). No new port, and no filesystem access from a use-case.
 */
async function readAtRevision(
	deps: ReadFrameSourcesDeps,
	ref: ChangesetRef,
	path: string,
): Promise<string | undefined> {
	try {
		const buffer =
			ref.headSha === null
				? await deps.git.readWorkingFile(path)
				: await deps.git.readBlob(ref.headSha, path);
		return buffer.toString("utf8");
	} catch {
		return undefined;
	}
}

/**
 * Where this change lives, derived from its own paths rather than from a tree
 * listing.
 *
 * `git ls-tree` would describe the whole repository and needs a new port
 * method; the section's only job is telling the agent where things sit, and the
 * directories the change touches answer that for the code actually in front of
 * it. Scale is already covered by the frame's own "This change touches" line,
 * so a full listing would buy nothing and cost a port.
 */
function layoutOf(files: readonly FileDiff[]): string[] {
	const directories = new Set<string>();
	for (const file of files) {
		const segments = file.path.split("/");
		if (segments.length === 1) {
			directories.add("(repo root)");
			continue;
		}
		directories.add(`${segments.slice(0, 2).join("/")}/`);
	}
	return [...directories].sort().slice(0, TREE_SAMPLE);
}

/** spreads a field only when it has a value, so `exactOptionalPropertyTypes` holds */
function optional<Key extends string, Value>(
	key: Key,
	value: Value | undefined,
): Record<Key, Value> | Record<string, never> {
	return value === undefined ? {} : ({ [key]: value } as Record<Key, Value>);
}
