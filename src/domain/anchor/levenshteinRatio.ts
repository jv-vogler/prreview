/**
 * Similarity of two strings as 1 − levenshtein / max-length, in [0, 1].
 * Iterative two-row dynamic programming, no dependency; re-anchoring step 5
 * requires ≥ 0.9 on an anchor's boundary lines (ARCHITECTURE §6).
 */
export function levenshteinRatio(a: string, b: string): number {
	if (a === b) {
		return 1;
	}
	const maxLength = Math.max(a.length, b.length);
	if (maxLength === 0) {
		return 1;
	}
	return 1 - levenshteinDistance(a, b) / maxLength;
}

function levenshteinDistance(a: string, b: string): number {
	if (a.length === 0) {
		return b.length;
	}
	if (b.length === 0) {
		return a.length;
	}
	let previousRow = new Array<number>(b.length + 1);
	let currentRow = new Array<number>(b.length + 1);
	for (let j = 0; j <= b.length; j++) {
		previousRow[j] = j;
	}
	for (let i = 1; i <= a.length; i++) {
		currentRow[0] = i;
		for (let j = 1; j <= b.length; j++) {
			const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;
			currentRow[j] = Math.min(
				previousRow[j] + 1,
				currentRow[j - 1] + 1,
				previousRow[j - 1] + substitutionCost,
			);
		}
		[previousRow, currentRow] = [currentRow, previousRow];
	}
	return previousRow[b.length];
}
