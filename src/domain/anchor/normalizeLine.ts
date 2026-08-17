const TRAILING_CARRIAGE_RETURN = /\r$/;
const WHITESPACE_RUN = /\s+/g;

/**
 * The normalization every anchor comparison uses (ARCHITECTURE §6): strip a
 * trailing CR, collapse every whitespace run to one space, trim both ends.
 * Leading whitespace is removed entirely — not just collapsed — so an
 * indentation-only edit (including 0 → N, the "wrapped in a block" case)
 * never defeats a comparison.
 */
export function normalizeLine(line: string): string {
	return line
		.replace(TRAILING_CARRIAGE_RETURN, "")
		.replace(WHITESPACE_RUN, " ")
		.trim();
}
