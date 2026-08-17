import type { FileDiffDto } from "@dto/ChangesetDto";

/** a place in the diff the reader can actually be taken to */
export interface EntryPoint {
	fileId: string;
	path: string;
	/** null when the suggestion named a file but not a hunk inside it */
	hunkId: string | null;
}

interface Candidate extends EntryPoint {
	/** where the reference appeared in the suggestion text */
	at: number;
	/** a hunk reference beats a bare path when both start at the same place */
	precise: boolean;
}

/**
 * Turn the agent's suggested entry point into somewhere to go.
 *
 * The field is free prose by contract — sometimes a bare path
 * (`src/server.ts`), sometimes a sentence ("start with F1h1, then read the call
 * site") — so the rule reads the sentence rather than the schema: **the first
 * file the text mentions wins, and inside that file the most precise reference
 * wins.** Order comes from the sentence because that is where the agent put the
 * reading order; precision decides only between two names for the same file, so
 * "src/main.ts (F2h1)" lands on the hunk rather than the top of the file.
 *
 * Returns null when the text names nothing this round contains; the caller then
 * offers the diff's own beginning rather than guessing.
 */
export function resolveEntryPoint(
	suggestion: string,
	files: readonly FileDiffDto[],
): EntryPoint | null {
	const candidates = files.flatMap((file) => candidatesIn(suggestion, file));
	const firstMentioned = candidates.reduce<Candidate | null>(
		(earliest, candidate) =>
			earliest === null || candidate.at < earliest.at ? candidate : earliest,
		null,
	);
	if (firstMentioned === null) {
		return null;
	}
	const best = candidates
		.filter((candidate) => candidate.fileId === firstMentioned.fileId)
		.reduce(pickMorePrecise);
	return { fileId: best.fileId, path: best.path, hunkId: best.hunkId };
}

function pickMorePrecise(left: Candidate, right: Candidate): Candidate {
	if (left.precise !== right.precise) {
		return right.precise ? right : left;
	}
	return right.at < left.at ? right : left;
}

function candidatesIn(suggestion: string, file: FileDiffDto): Candidate[] {
	const candidates: Candidate[] = [];
	const pathAt = suggestion.indexOf(file.path);
	if (pathAt !== -1) {
		candidates.push({
			fileId: file.id,
			path: file.path,
			hunkId: null,
			at: pathAt,
			precise: false,
		});
	}
	for (const hunk of file.hunks) {
		const hunkAt = indexOfToken(suggestion, hunk.id);
		if (hunkAt !== -1) {
			candidates.push({
				fileId: file.id,
				path: file.path,
				hunkId: hunk.id,
				at: hunkAt,
				precise: true,
			});
		}
	}
	return candidates;
}

/**
 * Hunk ids are short and alphanumeric (`F1h1`), so a plain substring search
 * would match `F1h1` inside `F1h12`. Bounded on both sides by anything that is
 * not a word character.
 */
function indexOfToken(text: string, token: string): number {
	let from = 0;
	while (from <= text.length) {
		const at = text.indexOf(token, from);
		if (at === -1) {
			return -1;
		}
		if (
			!isWordCharacter(text[at - 1]) &&
			!isWordCharacter(text[at + token.length])
		) {
			return at;
		}
		from = at + 1;
	}
	return -1;
}

function isWordCharacter(character: string | undefined): boolean {
	return character !== undefined && /[0-9A-Za-z_]/.test(character);
}
