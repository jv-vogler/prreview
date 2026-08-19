import type { FileDiff } from "../../domain/changeset/FileDiff";
import { checkForm } from "../../domain/review/formGate";
import {
	checkGrounding,
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
	marks: string[];
}

export interface Adjudication {
	findings: AdjudicatedFinding[];
	relatedFindings: AdjudicatedFinding[];
	/** what was thrown away and why — surfaced, never silently dropped */
	discarded: { title: string; reason: string }[];
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
	const unionLog: RoundReadLog = {
		reads: input.results.flatMap((result) => result.readLog.reads),
		searchHits: input.results.flatMap((result) => result.readLog.searchHits),
	};

	const discarded: Adjudication["discarded"] = [];
	const linesByAnchor = anchorLineIndex(input.files);

	const findings = pipeline({
		raw: input.results.flatMap((result) =>
			result.out.findings.map((finding) => ({ finding, lens: result.lens })),
		),
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
		unionLog,
		input,
		linesByAnchor,
		discarded,
		cap: input.depth.maxRelatedFindings,
	});

	return { findings, relatedFindings, discarded };
}

function pipeline(args: {
	raw: { finding: ReviewFinding; lens: string }[];
	unionLog: RoundReadLog;
	input: AdjudicateInput;
	linesByAnchor: Map<string, string[]>;
	discarded: Adjudication["discarded"];
	cap: number;
}): AdjudicatedFinding[] {
	const merged = mergeDuplicates(args.raw);
	const kept: AdjudicatedFinding[] = [];

	for (const candidate of merged) {
		// 1. the confidence floor, before anything expensive
		if (candidate.confidence < args.input.depth.confidenceFloor) {
			args.discarded.push({
				title: candidate.title,
				reason: `confidence ${candidate.confidence} is below the floor of ${args.input.depth.confidenceFloor}`,
			});
			continue;
		}

		// 2. form — including a body a chat turn may later rewrite, which is why
		//    this lives in a function rather than only in this pipeline
		const anchoredLines = args.linesByAnchor.get(anchorKey(candidate)) ?? [];
		const violations = checkForm({ body: candidate.body, anchoredLines });
		if (violations.length > 0) {
			args.discarded.push({
				title: candidate.title,
				reason: `form: ${violations.map((violation) => violation.rule).join(", ")}`,
			});
			continue;
		}

		// 3. grounding, asymmetric by severity
		const citations = [
			{
				path: candidate.anchor.path,
				startLine: candidate.anchor.startLine,
				endLine: candidate.anchor.endLine,
			},
			...(candidate.evidence === undefined
				? []
				: [
						{
							path: candidate.evidence.path,
							startLine: candidate.evidence.startLine,
							endLine: candidate.evidence.endLine,
						},
					]),
		];
		const grounding = checkGrounding({
			citations,
			log: args.unionLog,
			workspaceDir: args.input.workspaceDir,
		});

		const marks: string[] = [];
		if (!grounding.grounded) {
			if (resolveUngrounded(candidate.severity) === "drop") {
				args.discarded.push({
					title: candidate.title,
					reason: `ungrounded blocker: ${grounding.reason} (${grounding.path})`,
				});
				continue;
			}
			marks.push(
				`cites ${grounding.path}, which the agent did not read this round`,
			);
		}

		if (candidate.proof.mode === "inferred") {
			marks.push("the path was inferred rather than traced end to end");
		}

		kept.push({
			...candidate,
			groundingVerified: grounding.grounded,
			marks,
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
