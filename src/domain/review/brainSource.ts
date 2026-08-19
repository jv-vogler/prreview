/**
 * Where a custom review brain may come from, and what may never be fetched.
 *
 * Worth stating the framing plainly: this is not prreview's first egress. It
 * already calls GitHub through `gh`, and every agent child talks to Anthropic.
 * What is new here is **prreview's own process fetching a URL the user
 * supplied**, which is the shape that turns a code-review tool into an SSRF
 * probe if it is not fenced.
 */

export type BrainSource =
	| { kind: "file"; path: string }
	| { kind: "github"; owner: string; repo: string; ref: string; path: string }
	| { kind: "https"; url: string };

export type BrainRejection =
	| "insecure-scheme"
	| "private-address"
	| "unsupported-scheme"
	| "html-body";

export interface BrainClassification {
	source?: BrainSource;
	rejected?: { reason: BrainRejection; message: string };
}

/**
 * Hosts and ranges nothing may resolve to, on any hop.
 *
 * Loopback and link-local are the interesting ones: `169.254.169.254` is the
 * cloud metadata endpoint, and a review tool that will fetch an arbitrary URL
 * on request is a very convenient way to ask a CI runner for its credentials.
 */
const PRIVATE_PATTERNS = [
	/^localhost$/i,
	/^127\./,
	/^0\.0\.0\.0$/,
	/^10\./,
	/^192\.168\./,
	/^172\.(1[6-9]|2\d|3[01])\./,
	/^169\.254\./,
	/^::1$/,
	/^\[::1\]$/,
	/^fc00:/i,
	/^fd[0-9a-f]{2}:/i,
	/^fe80:/i,
	/\.internal$/i,
	/\.local$/i,
];

export function isPrivateHost(hostname: string): boolean {
	const bare = hostname.replace(/^\[|\]$/g, "");
	return PRIVATE_PATTERNS.some((pattern) => pattern.test(bare));
}

/**
 * Classifies what the user asked for.
 *
 * GitHub URLs are routed through `gh` rather than a raw fetch, which buys three
 * things for free: private repositories work, the user's own rate limit
 * applies, and in the common case prreview's process makes no arbitrary request
 * at all. Blob URLs are rewritten to their raw form, because a blob URL fetched
 * directly returns a web page and "your review rules are a wall of HTML" is a
 * confusing way to find that out.
 */
export function classifyBrainSource(raw: string): BrainClassification {
	const value = raw.trim();

	if (!/^[a-z][a-z0-9+.-]*:/i.test(value)) {
		return { source: { kind: "file", path: value } };
	}

	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return { source: { kind: "file", path: value } };
	}

	if (url.protocol === "file:") {
		return { source: { kind: "file", path: decodeURIComponent(url.pathname) } };
	}

	if (url.protocol === "http:") {
		return {
			rejected: {
				reason: "insecure-scheme",
				message: `Refusing to load review rules over plain http (${url.host}). Use https, a GitHub URL, or a local path.`,
			},
		};
	}

	if (url.protocol !== "https:") {
		return {
			rejected: {
				reason: "unsupported-scheme",
				message: `Cannot load review rules from a ${url.protocol} URL. Use https, a GitHub URL, or a local path.`,
			},
		};
	}

	if (isPrivateHost(url.hostname)) {
		return {
			rejected: {
				reason: "private-address",
				message: `Refusing to fetch review rules from ${url.hostname}: private and loopback addresses are never fetched.`,
			},
		};
	}

	const github = parseGithubUrl(url);
	return { source: github ?? { kind: "https", url: url.toString() } };
}

/** github.com/<owner>/<repo>/(blob|raw)/<ref>/<path...> → a `gh api` request */
function parseGithubUrl(url: URL): BrainSource | null {
	if (!/^(www\.)?github\.com$/i.test(url.hostname)) {
		return null;
	}
	const segments = url.pathname.split("/").filter((segment) => segment !== "");
	const [owner, repo, kind, ref, ...rest] = segments;
	if (
		owner === undefined ||
		repo === undefined ||
		(kind !== "blob" && kind !== "raw") ||
		ref === undefined ||
		rest.length === 0
	) {
		return null;
	}
	return { kind: "github", owner, repo, ref, path: rest.join("/") };
}

/**
 * A fetched body that is obviously a web page rather than review rules.
 *
 * Worth its own check because the most likely mistake is pasting a GitHub blob
 * URL from the address bar, and the useful answer is "that's the page, here is
 * the raw link" rather than an agent quietly ingesting navigation markup.
 */
export function looksLikeHtml(body: string): boolean {
	const head = body.slice(0, 400).toLowerCase();
	return head.includes("<!doctype html") || head.includes("<html");
}
