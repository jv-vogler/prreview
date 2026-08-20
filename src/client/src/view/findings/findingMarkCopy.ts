import type { FindingMark } from "../../domain/annotation/Annotation";

/**
 * The hedges, in words.
 *
 * Marks are stored structured and rendered here for the same reason run
 * failures and chat failures are: a sentence written into `.prreview/` can
 * never be reworded, because it is already in everybody's session files. A
 * closed union also means a new hedge cannot ship without someone writing the
 * text a reader will see.
 *
 * Each one says what the reader should *do*, not just what happened. "Cites a
 * file the agent did not open" is a fact about the run; "treat this as a lead"
 * is the instruction that fact implies, and it is the half that changes whether
 * the comment gets pasted onto someone's pull request.
 */
export function findingMarkCopy(mark: FindingMark): string {
	switch (mark.kind) {
		case "ungrounded-citation":
			return `Cites ${mark.path}, which the agent did not read this round — treat as a lead`;
		case "inferred-path":
			return "The path was inferred rather than traced end to end";
	}
}
