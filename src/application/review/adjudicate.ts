import type { Citation, FindingMark } from "../../domain/annotation/Annotation";
import type { FileDiff } from "../../domain/changeset/FileDiff";
import { checkForm } from "../../domain/review/formGate";
import {
	checkGrounding,
	type ReadRange,
	type RoundReadLog,
	resolveUngrounded,
} from "../../domain/review/groundingGate";
import type { ReviewDepth } from "../../domain/review/ReviewDepth";
import type { ReviewFinding, ReviewOut } from "./reviewSchemas";

/**
 * Turning several lenses' opinions into one review.
 *
 * Six independent readings of the same diff produce overlap, disagreement, and
 * a quantity of text nobody asked for. This is where that becomes a list a
 * person can act on: duplicates merged, ungrounded claims dropped or marked,
 * malformed ones discarded, the rest ranked and cut to the budget.
 *
 * Everything here is deterministic. Adjudication decides what the reviewer
 * sees, and a second agent call deciding it would be one more thing that can
 * hallucinate at the last possible moment.
 */

export interface LensResult {
	lens: string;
	out: ReviewOut;
	/** what that child actually opened */
	readLog: RoundReadLog;
}

export interface AdjudicatedFinding extends ReviewFinding {
	/** which lenses raised it — more than one is corroboration, and ranks higher */
	lenses: string[];
	groundingVerified: boolean;
	/** why it survived in a weakened form, for the UI to show honestly */
	marks: FindingMark[];
	/**
	 * What the finding cites **besides** where it sits.
	 *
	 * The anchor is excluded on purpose: it is already on the annotation, and
	 * `applyAnnotationOps` re-grounds a reword against `[anchor, ...citations]`,
	 * so including it here would check the same location twice.
	 */
	citations: Citation[];
}

/**
 * Why a candidate did not make the cut.
 *
 * A closed union carrying its own numbers, not a sentence. The comments tab
 * needs per-reason counts, and grouping by parsing prose would break the first
 * time someone reworded a message — the same argument `runFailureReasonDto`
 * already makes for run failures.
 */
export type DiscardReason =
	| { kind: "below-confidence-floor"; confidence: number; floor: number }
	| { kind: "form"; rules: string[] }
	| {
			kind: "ungrounded-blocker";
			path: string;
			why: "never-opened" | "outside-read-range";
	  };

export interface DiscardedCandidate {
	title: string;
	species: "finding" | "related-finding";
	severity: string;
	/** which lenses raised it: a corroborated discard reads differently */
	lenses: string[];
	reason: DiscardReason;
}

export interface Adjudication {
	findings: AdjudicatedFinding[];
	relatedFindings: AdjudicatedFinding[];
	/** what was thrown away and why — surfaced, never silently dropped */
	discarded: DiscardedCandidate[];
	/**
	 * The union log grounding was actually checked against.
	 *
	 * Returned rather than rebuilt by the caller, so what gets persisted as the
	 * round's evidence is the same set the gate ran on. Rebuilding it elsewhere
	 * is how the two quietly stop matching.
	 */
	readLog: RoundReadLog;
}

const SEVERITY_RANK: Record<string, number> = {
	blocker: 0,
	"should-fix": 1,
	consider: 2,
	nitpick: 3,
};

export interface AdjudicateInput {
	results: readonly LensResult[];
	depth: ReviewDepth;
	files: readonly FileDiff[];
	workspaceDir: string;
}

export function adjudicate(input: AdjudicateInput): Adjudication {
	// Lenses fork the comprehension session, so each child's log holds only what
	// *it* opened. Grounding is checked against the union: a claim resting on a
	// file the round read is grounded, whichever child happened to open it.
	//
	// Deduplicated because five children opening the same file is one fact about
	// the round, and this log is also what gets written to disk for a person to
	// read — five copies of every entry is noise that grows with the lens count.
	const unionLog: RoundReadLog = {
		reads: dedupeReads(input.results.flatMap((result) => result.readLog.reads)),
		searchHits: [
			...new Set(input.results.flatMap((result) => result.readLog.searchHits)),
		],
	};

	const discarded: Adjudication["discarded"] = [];
	const linesByAnchor = anchorLineIndex(input.files);

	const findings = pipeline({
		raw: input.results.flatMap((result) =>
			result.out.findings.map((finding) => ({ finding, lens: result.lens })),
		),
		species: "finding",
		unionLog,
		input,
		linesByAnchor,
		discarded,
		cap: input.depth.maxFindings,
	});

	const relatedFindings = pipeline({
		raw: input.results.flatMap((result) =>
			result.out.relatedFindings.map((finding) => ({
				finding,
				lens: result.lens,
			})),
		),
		species: "related-finding",
		unionLog,
		input,
		linesByAnchor,
		discarded,
		cap: input.depth.maxRelatedFindings,
	});

	return { findings, relatedFindings, discarded, readLog: unionLog };
}

function pipeline(args: {
	raw: { finding: ReviewFinding; lens: string }[];
	/** which list this is, so a discard record can say where it came from */
	species: "finding" | "related-finding";
	unionLog: RoundReadLog;
	input: AdjudicateInput;
	linesByAnchor: Map<string, string[]>;
	discarded: DiscardedCandidate[];
	cap: number;
}): AdjudicatedFinding[] {
	const merged = mergeDuplicates(args.raw);
	const kept: AdjudicatedFinding[] = [];

	for (const candidate of merged) {
		// 1. the confidence floor, before anything expensive
		if (candidate.confidence < args.input.depth.confidenceFloor) {
			args.discarded.push(
				discard(candidate, args.species, {
					kind: "below-confidence-floor",
					confidence: candidate.confidence,
					floor: args.input.depth.confidenceFloor,
				}),
			);
			continue;
		}

		// 2. form — including a body a chat turn may later rewrite, which is why
		//    this lives in a function rather than only in this pipeline
		const anchoredLines = args.linesByAnchor.get(anchorKey(candidate)) ?? [];
		const violations = checkForm({ body: candidate.body, anchoredLines });
		if (violations.length > 0) {
			args.discarded.push(
				discard(candidate, args.species, {
					kind: "form",
					rules: violations.map((violation) => violation.rule),
				}),
			);
			continue;
		}

		// 3. grounding, asymmetric by severity
		// the evidence block, as a citation the annotation keeps; the anchor is
		// checked alongside it but never stored as a citation of itself
		const citations: Citation[] =
			candidate.evidence === undefined
				? []
				: [
						{
							path: candidate.evidence.path,
							startLine: candidate.evidence.startLine,
							endLine: candidate.evidence.endLine,
							note: candidate.evidence.note,
						},
					];
		const grounding = checkGrounding({
			citations: [
				{
					path: candidate.anchor.path,
					startLine: candidate.anchor.startLine,
					endLine: candidate.anchor.endLine,
				},
				...citations,
			],
			log: args.unionLog,
			workspaceDir: args.input.workspaceDir,
		});

		const marks: FindingMark[] = [];
		if (!grounding.grounded) {
			if (resolveUngrounded(candidate.severity) === "drop") {
				args.discarded.push(
					discard(candidate, args.species, {
						kind: "ungrounded-blocker",
						path: grounding.path,
						why: grounding.reason,
					}),
				);
				continue;
			}
			marks.push({ kind: "ungrounded-citation", path: grounding.path });
		}

		if (candidate.proof.mode === "inferred") {
			marks.push({ kind: "inferred-path" });
		}

		kept.push({
			...candidate,
			groundingVerified: grounding.grounded,
			marks,
			citations,
		});
	}

	return rank(kept).slice(0, args.cap);
}

/**
 * Merges findings that are plainly the same claim.
 *
 * Deliberately conservative: same file, overlapping lines, same category. Two
 * lenses reporting the same bug is the corroboration signal that ranks it up,
 * and merging aggressively would destroy exactly that. Semantic near-duplicates
 * that survive this are a smaller problem than real findings silently absorbed
 * into each other.
 */
function mergeDuplicates(
	raw: { finding: ReviewFinding; lens: string }[],
): (ReviewFinding & { lenses: string[] })[] {
	const merged: (ReviewFinding & { lenses: string[] })[] = [];

	for (const { finding, lens } of raw) {
		const existing = merged.find(
			(candidate) =>
				candidate.anchor.path === finding.anchor.path &&
				candidate.category === finding.category &&
				overlaps(candidate.anchor, finding.anchor),
		);
		if (existing === undefined) {
			merged.push({ ...finding, lenses: [lens] });
			continue;
		}
		existing.lenses.push(lens);
		// keep the more severe framing and the higher confidence: when two
		// readings disagree about how bad something is, the reviewer should see
		// the worse case and decide
		if (SEVERITY_RANK[finding.severity] < SEVERITY_RANK[existing.severity]) {
			existing.severity = finding.severity;
			existing.title = finding.title;
			existing.body = finding.body;
		}
		existing.confidence = Math.max(existing.confidence, finding.confidence);
		if (existing.proof.mode === "inferred" && finding.proof.mode === "traced") {
			existing.proof = finding.proof;
		}
	}
	return merged;
}

function overlaps(
	a: ReviewFinding["anchor"],
	b: ReviewFinding["anchor"],
): boolean {
	return a.startLine <= b.endLine && b.startLine <= a.endLine;
}

/**
 * Severity first, then corroboration, then confidence.
 *
 * Corroboration outranks confidence on purpose: a model's self-reported
 * confidence is a number it produced about itself, while two independent lenses
 * landing on the same lines is evidence from outside either one.
 */
function rank(findings: AdjudicatedFinding[]): AdjudicatedFinding[] {
	return [...findings].sort((a, b) => {
		const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
		if (bySeverity !== 0) {
			return bySeverity;
		}
		const byCorroboration = b.lenses.length - a.lenses.length;
		if (byCorroboration !== 0) {
			return byCorroboration;
		}
		return b.confidence - a.confidence;
	});
}

/** one entry per file-and-range: the same file at two ranges stays two entries */
function dedupeReads(reads: readonly ReadRange[]): ReadRange[] {
	const byKey = new Map<string, ReadRange>();
	for (const read of reads) {
		byKey.set(
			`${read.path}\u0000${read.offset ?? ""}\u0000${read.limit ?? ""}`,
			read,
		);
	}
	return [...byKey.values()];
}

/** one discard record, so the three call sites cannot disagree about its shape */
function discard(
	candidate: ReviewFinding & { lenses: string[] },
	species: "finding" | "related-finding",
	reason: DiscardReason,
): DiscardedCandidate {
	return {
		title: candidate.title,
		species,
		severity: candidate.severity,
		lenses: [...candidate.lenses],
		reason,
	};
}

function anchorKey(finding: ReviewFinding): string {
	return `${finding.anchor.path}:${finding.anchor.startLine}:${finding.anchor.endLine}`;
}

/** the actual lines a finding anchors to, for the restatement check */
function anchorLineIndex(files: readonly FileDiff[]): Map<string, string[]> {
	const index = new Map<string, string[]>();
	for (const file of files) {
		for (const hunk of file.hunks) {
			for (const line of hunk.lines) {
				const lineNumber = line.newLine ?? line.oldLine;
				if (lineNumber === undefined) {
					continue;
				}
				const key = `${file.path}:${lineNumber}:${lineNumber}`;
				index.set(key, [line.content]);
			}
		}
	}
	return index;
}
