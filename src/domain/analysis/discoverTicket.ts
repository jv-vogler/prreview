/**
 * What a change says it is for, when it says so cheaply.
 *
 * Ticket discovery is **opportunistic by design**: prreview looks in the three
 * places a ticket reference is nearly free to find — the branch name, the PR
 * title, the PR body — and renders nothing when it finds nothing. It never
 * fetches a tracker, never asks the agent to guess, and never treats a missing
 * ticket as a problem.
 *
 * The reason this matters beyond a link in the header: the Overview tab judges
 * whether the code matches the goal, and *what the goal is* changes the meaning
 * of that verdict entirely. With a ticket, "this matches" is a claim about an
 * external requirement. Without one, it can only be a claim about the change's
 * own internal coherence. The `basis` field carries that difference, and it is
 * stamped from whether discovery succeeded — never from what the agent says —
 * so an inferred verdict cannot be dressed up in ticket-grounded language.
 */
export interface TicketHint {
	/** the reference as written, e.g. "ENG-4471" or "#312" */
	key: string;
	/** where it was found, so the UI can be honest about how it knows */
	source: "branch" | "title" | "body";
	/** present only when the source gave a real link, never synthesized */
	url?: string;
}

export interface TicketSources {
	branch?: string;
	title?: string;
	body?: string;
	/**
	 * The PR's own number, when reviewing one. Squash-merge conventions put
	 * `(#20)` in titles, so without this a PR happily reports itself as its own
	 * ticket — a link that is both wrong and confusing.
	 */
	selfIssueNumber?: number;
}

/**
 * Tracker keys: two or more letters, a hyphen, digits. Matches Jira, Linear,
 * Shortcut, and every tracker that copied them.
 *
 * The leading boundary is deliberate: without it, `UTF-8`, `SHA-256`, and
 * `ES-2022` inside a sentence all read as tickets. It still cannot tell
 * `ENG-123` from a genuine false positive like `HTTP-2` in prose, which is why
 * a hit is a *hint* that gets shown as a link, not a fact anything depends on.
 */
const TRACKER_KEY = /\b([A-Z][A-Z0-9]{1,9}-\d+)\b/g;

/**
 * Prefixes that look exactly like tracker keys and never are. Without this list
 * every change that mentions an encoding, a hash, or a spec year grows a
 * confident link to a ticket that does not exist — `UTF-8`, `SHA-256`,
 * `RFC-7231`, `ES-2022`, `HTTP-2`, `AES-256` are all `[A-Z]+-\d+`.
 *
 * A denylist rather than a cleverer pattern because there is no structural
 * difference to exploit: `ENG-8` and `UTF-8` are the same shape, and only
 * knowing what the letters mean tells them apart.
 */
const TECHNICAL_PREFIXES = new Set([
	"UTF",
	"SHA",
	"MD",
	"AES",
	"RSA",
	"ES",
	"ISO",
	"RFC",
	"HTTP",
	"HTTPS",
	"IPV",
	"TLS",
	"SSL",
	"EC",
	"IEEE",
	"ANSI",
	"ASCII",
	"BASE",
	"CVE",
	"X",
	"ARM",
	"AMD",
	"PEP",
	"WCAG",
	"OAUTH",
	"SCSS",
	"COVID",
]);

/** a bare GitHub issue reference: #312, including inside parentheses */
const ISSUE_KEY = /(?:^|[^\w#])(#\d+)\b/;

/** an explicit tracker or issue URL, which is better evidence than a bare key */
const TICKET_URL =
	/https?:\/\/(?:[\w.-]+\.)?(?:atlassian\.net|linear\.app|app\.shortcut\.com|github\.com)\/[^\s)>\]]+/i;

/**
 * Branches are lowercased by convention (`feature/eng-4471-retry-webhooks`), so
 * the key pattern would miss them without a case-insensitive pass. Applied only
 * to the branch, where the convention holds — uppercasing prose would turn
 * every hyphenated word pair into a candidate.
 */
const BRANCH_TRACKER_KEY = /(?:^|[/_-])([a-zA-Z][a-zA-Z0-9]{1,9}-\d+)(?:$|[/_-])/;

export function discoverTicket(sources: TicketSources): TicketHint | null {
	const self =
		sources.selfIssueNumber === undefined
			? null
			: `#${sources.selfIssueNumber}`;

	// Order is evidence quality, not convenience. A branch name is the most
	// deliberate signal a developer leaves: they typed it on purpose, once, to
	// say what they were doing. A title is next. A body is last, because it is
	// prose and prose is where false positives live.
	const fromBranch = matchBranch(sources.branch);
	if (fromBranch !== null) {
		return { key: fromBranch, source: "branch" };
	}

	const fromTitle = matchText(sources.title, self);
	if (fromTitle !== null) {
		return { ...fromTitle, source: "title" };
	}

	const fromBody = matchText(sources.body, self);
	if (fromBody !== null) {
		return { ...fromBody, source: "body" };
	}

	return null;
}

/** the prefix of a tracker key: everything before the last hyphen */
function isTechnicalToken(key: string): boolean {
	const prefix = key.slice(0, key.lastIndexOf("-")).toUpperCase();
	return TECHNICAL_PREFIXES.has(prefix);
}

/** the first tracker key in `text` that is not a known technical token */
function firstTrackerKey(text: string): string | undefined {
	TRACKER_KEY.lastIndex = 0;
	for (const match of text.matchAll(TRACKER_KEY)) {
		const key = match[1];
		if (key !== undefined && !isTechnicalToken(key)) {
			return key;
		}
	}
	return undefined;
}

function matchBranch(branch: string | undefined): string | null {
	if (branch === undefined || branch === "") {
		return null;
	}
	const matched = BRANCH_TRACKER_KEY.exec(branch)?.[1];
	if (matched === undefined) {
		return null;
	}
	const key = matched.toUpperCase();
	return isTechnicalToken(key) ? null : key;
}

function matchText(
	text: string | undefined,
	selfIssueKey: string | null,
): { key: string; url?: string } | null {
	if (text === undefined || text === "") {
		return null;
	}

	// A URL is stronger evidence than a bare key, and it is the only way to
	// produce a link that is real rather than guessed from a key and a hostname
	// prreview would have to invent.
	const url = TICKET_URL.exec(text)?.[0];
	if (url !== undefined) {
		const keyInUrl = firstTrackerKey(url) ?? issueNumberInUrl(url);
		if (keyInUrl !== null && keyInUrl !== undefined && keyInUrl !== selfIssueKey) {
			return { key: keyInUrl, url };
		}
	}

	const trackerKey = firstTrackerKey(text);
	if (trackerKey !== undefined) {
		return { key: trackerKey };
	}

	const issueKey = ISSUE_KEY.exec(text)?.[1];
	if (issueKey !== undefined && issueKey !== selfIssueKey) {
		return { key: issueKey };
	}

	return null;
}

function issueNumberInUrl(url: string): string | null {
	const matched = /\/issues\/(\d+)/.exec(url);
	return matched?.[1] === undefined ? null : `#${matched[1]}`;
}
