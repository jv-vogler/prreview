/**
 * A place in the rendered diff: which file, and which of its hunks. Indices
 * rather than ids because they address the *rendered* order — the same order
 * the reading cursor walks — so a step target and the cursor are the same kind
 * of thing and one can be handed to the other.
 *
 * The view's `DiffCursor` (in `DiffNavigationProvider`) is this shape under the
 * name the provider gave it in M1; it stays where it is, and the two are
 * structurally interchangeable.
 */
export interface DiffPosition {
	fileIndex: number;
	hunkIndex: number;
}
