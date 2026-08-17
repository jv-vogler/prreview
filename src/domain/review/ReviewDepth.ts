/**
 * How hard to look.
 *
 * The axis is **investigation budget, not context-versus-none**. Awareness of
 * the project — what it is, what it lints with, how it is laid out — is about
 * 3KB of prompt and is never cut, because a review that does not know the repo
 * runs a linter is a review that reports lint. What a preset buys is depth of
 * inquiry: how many lenses look, how far each may follow a call, and whether
 * the smallest tier of remark is allowed to exist at all.
 *
 * "Review in a vacuum" survives as the `fresh-eyes` lens, not as a cheap tier.
 */

export type ReviewLens =
	| "correctness"
	| "security"
	| "edge-cases"
	| "design"
	| "fresh-eyes"
	| "impact";

export type ReviewPreset = "light" | "standard" | "thorough" | "custom";

export interface ReviewDepth {
	preset: ReviewPreset;
	lenses: ReviewLens[];
	/**
	 * When false, `nitpick` is **absent from the schema enum** rather than
	 * discouraged in a prompt. "Do not report nitpicks" is a request; removing
	 * the tier makes the violation unrepresentable.
	 */
	allowNitpick: boolean;
	maxFindings: number;
	maxRelatedFindings: number;
	/** below this, a finding is dropped — 80 in every preset, including custom */
	confidenceFloor: number;
	parallelChildren: number;
	/** low/high; null means the user's configured default */
	effort: "low" | "high" | null;
	/**
	 * Per-child spend ceiling, or null for none.
	 *
	 * Measured (CON-015): this is a **stop-threshold, not a cap**. The CLI checks
	 * it between turns, so a run halts only once it has already spent past the
	 * number, overshooting by up to one turn. Any UI wording must say "stops
	 * once it has spent about $X", and any total for N children must be
	 * `N × (ceiling + one turn)`.
	 */
	maxBudgetUsd: number | null;
}

/** security and correctness are never optional, in any preset */
export const LOCKED_LENSES: readonly ReviewLens[] = ["correctness", "security"];

/** the floor is the same everywhere: a low-confidence comment is noise */
const CONFIDENCE_FLOOR = 80;

const PRESETS: Record<Exclude<ReviewPreset, "custom">, ReviewDepth> = {
	light: {
		preset: "light",
		lenses: ["correctness", "security"],
		allowNitpick: false,
		maxFindings: 8,
		maxRelatedFindings: 3,
		confidenceFloor: CONFIDENCE_FLOOR,
		parallelChildren: 1,
		effort: "low",
		maxBudgetUsd: null,
	},
	standard: {
		preset: "standard",
		lenses: ["correctness", "security", "edge-cases", "design", "fresh-eyes"],
		allowNitpick: true,
		maxFindings: 15,
		maxRelatedFindings: 5,
		confidenceFloor: CONFIDENCE_FLOOR,
		parallelChildren: 3,
		effort: null,
		maxBudgetUsd: null,
	},
	thorough: {
		preset: "thorough",
		lenses: [
			"correctness",
			"security",
			"edge-cases",
			"design",
			"fresh-eyes",
			"impact",
		],
		allowNitpick: true,
		maxFindings: 20,
		maxRelatedFindings: 8,
		confidenceFloor: CONFIDENCE_FLOOR,
		parallelChildren: 5,
		effort: "high",
		maxBudgetUsd: null,
	},
};

export function depthForPreset(
	preset: Exclude<ReviewPreset, "custom">,
): ReviewDepth {
	return { ...PRESETS[preset], lenses: [...PRESETS[preset].lenses] };
}

/**
 * A custom depth, with the locks applied **here** rather than trusted to the
 * caller.
 *
 * A disabled checkbox in a dialog is a suggestion to whoever holds the request
 * body. The lock has to hold at the point the depth is constructed, or "review
 * without the security lens" is one curl away.
 */
export function customDepth(requested: {
	lenses: ReviewLens[];
	allowNitpick?: boolean;
	maxFindings?: number;
	effort?: "low" | "high" | null;
	maxBudgetUsd?: number | null;
}): ReviewDepth {
	const lenses = [
		...LOCKED_LENSES,
		...requested.lenses.filter((lens) => !LOCKED_LENSES.includes(lens)),
	];
	return {
		preset: "custom",
		lenses,
		allowNitpick: requested.allowNitpick ?? true,
		maxFindings: clamp(requested.maxFindings ?? 15, 1, 30),
		maxRelatedFindings: 8,
		// not configurable: a floor the caller could lower is not a floor
		confidenceFloor: CONFIDENCE_FLOOR,
		parallelChildren: Math.min(5, Math.max(1, lenses.length)),
		effort: requested.effort ?? null,
		maxBudgetUsd: requested.maxBudgetUsd ?? null,
	};
}

/**
 * Tiers **down** only, and only as a pre-fill.
 *
 * A docs-only or tiny change does not need five lenses, and offering to skip
 * them is a courtesy. Quietly substituting a cheaper review for the one the
 * user picked is not — so this suggests, and never overrides.
 */
export function suggestedPreset(input: {
	fileCount: number;
	changedLines: number;
	allDocsOrConfig: boolean;
}): Exclude<ReviewPreset, "custom"> {
	if (input.allDocsOrConfig || input.changedLines <= 20) {
		return "light";
	}
	return "standard";
}

function clamp(value: number, low: number, high: number): number {
	return Math.min(high, Math.max(low, value));
}
