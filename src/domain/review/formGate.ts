/**
 * The quality rules that cannot be a schema constraint, enforced as code.
 *
 * A schema can cap a string at 900 characters. It cannot know that 900
 * characters of fenced code is fine while 900 characters of prose is a wall
 * nobody reads, that a comment restating the diff teaches nothing, or that
 * "it's worth noting that" is filler. Those are the checks here, and they run
 * on every body — including one a chat turn rewrote, which is the case a
 * prompt-only rule would silently miss.
 */

/**
 * The pasteable budget, measured on **rendered prose with fences stripped**.
 *
 * The number is about what a person will read in a review thread, and a code
 * block is scanned rather than read. Counting fences against the budget would
 * push the model toward describing code instead of showing it, which is
 * backwards.
 */
const PROSE_BUDGET = 500;

/**
 * Two sentences of claim before any evidence. This *is* the cut pass: the
 * discipline that makes a comment land is saying the consequence first and
 * stopping, and there is no way to encourage that in a prompt as reliably as
 * failing the ones that ramble.
 */
const MAX_LEAD_SENTENCES = 2;

/**
 * Phrases that mark prose as written by a model rather than a reviewer. Not
 * about taste: a comment that reads as generated gets dismissed unread, which
 * wastes the whole pass that produced it.
 */
const PROSE_TELLS = [
	"it's worth noting",
	"it is worth noting",
	"it's important to note",
	"it is important to note",
	"as an ai",
	"i hope this helps",
	"great question",
	"let's dive in",
	"in today's fast-paced",
	"delve into",
	"it should be noted",
	"please note that",
	"in conclusion",
	"overall, this",
	"this is a great",
	"nice work",
];

export interface FormViolation {
	rule:
		| "prose-too-long"
		| "lead-too-long"
		| "prose-tell"
		| "restates-code"
		| "empty";
	detail: string;
}

export interface FormCheckInput {
	body: string;
	/** the lines the finding anchors to, for the restatement check */
	anchoredLines?: readonly string[];
}

/**
 * Every way this body fails the form rules. Empty means it passes.
 *
 * Returns all violations rather than the first, because a body that fails three
 * ways is a different signal from one that fails once, and the caller decides
 * what to do with each.
 */
export function checkForm(input: FormCheckInput): FormViolation[] {
	const violations: FormViolation[] = [];
	const body = input.body.trim();

	if (body === "") {
		return [{ rule: "empty", detail: "the body is empty" }];
	}

	const prose = stripFences(body);
	if (prose.length > PROSE_BUDGET) {
		violations.push({
			rule: "prose-too-long",
			detail: `${prose.length} characters of prose, over the ${PROSE_BUDGET} budget`,
		});
	}

	const lead = leadSentences(prose);
	if (lead.length > MAX_LEAD_SENTENCES) {
		violations.push({
			rule: "lead-too-long",
			detail: `${lead.length} sentences before any evidence, over ${MAX_LEAD_SENTENCES}`,
		});
	}

	const lowered = prose.toLowerCase();
	for (const tell of PROSE_TELLS) {
		if (lowered.includes(tell)) {
			violations.push({ rule: "prose-tell", detail: `contains "${tell}"` });
		}
	}

	if (restatesCode(prose, input.anchoredLines ?? [])) {
		violations.push({
			rule: "restates-code",
			detail:
				"the prose repeats the anchored lines rather than saying what follows from them",
		});
	}

	return violations;
}

/** fenced blocks and inline code do not count against the prose budget */
export function stripFences(body: string): string {
	return body
		.replace(/```[\s\S]*?```/g, " ")
		.replace(/`[^`\n]*`/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * The sentences before the first piece of evidence — a fence, a citation, or a
 * colon introducing one. Everything after that is the showing, not the telling.
 */
function leadSentences(prose: string): string[] {
	const upToEvidence =
		prose.split(/(?:^|\s)(?:see |e\.g\.|for example)/i)[0] ?? prose;
	return upToEvidence
		.split(/(?<=[.!?])\s+/)
		.map((sentence) => sentence.trim())
		.filter((sentence) => sentence !== "");
}

/**
 * Words that carry no meaning for this comparison. Without them the ratio is
 * dominated by English rather than by whether the comment adds anything: a
 * sentence is mostly "the", "this", and "is" no matter what it says.
 */
const STOPWORDS = new Set([
	"the",
	"this",
	"that",
	"these",
	"those",
	"and",
	"but",
	"for",
	"are",
	"was",
	"were",
	"been",
	"being",
	"has",
	"have",
	"had",
	"not",
	"with",
	"from",
	"into",
	"its",
	"they",
	"them",
	"here",
	"there",
	"when",
	"then",
	"than",
	"which",
	"what",
	"you",
	"your",
	"can",
	"will",
	"would",
	"should",
	"could",
	"just",
	"only",
	"also",
	"now",
	"all",
	"any",
	"one",
	"two",
	"per",
]);

/**
 * Whether the prose is mostly the anchored code read back.
 *
 * A comment that says "the retries const is set to the maxRetries config value"
 * beside `const retries = config.maxRetries;` has told the reader nothing they
 * could not see. What distinguishes it from a useful comment naming the same
 * identifiers is the ratio of *meaningful* words that came from the code: a
 * real comment says what follows — "silently becomes zero", "never retried" —
 * and those words are not in the diff.
 *
 * Crude on purpose, because the failure it catches is crude.
 */
function restatesCode(
	prose: string,
	anchoredLines: readonly string[],
): boolean {
	if (anchoredLines.length === 0) {
		return false;
	}
	const codeTokens = new Set(tokenize(anchoredLines.join(" ")));
	if (codeTokens.size === 0) {
		return false;
	}
	const proseTokens = tokenize(prose);
	const MIN_TOKENS = 4;
	if (proseTokens.length < MIN_TOKENS) {
		return false;
	}
	const shared = proseTokens.filter((token) => codeTokens.has(token)).length;
	const OVERLAP_LIMIT = 0.6;
	return shared / proseTokens.length > OVERLAP_LIMIT;
}

function tokenize(text: string): string[] {
	return text
		.split(/[^A-Za-z0-9_]+/)
		.filter((token) => token.length > 2)
		.map((token) => token.toLowerCase())
		.filter((token) => !STOPWORDS.has(token));
}
