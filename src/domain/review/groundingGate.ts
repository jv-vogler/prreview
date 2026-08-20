/**
 * Did the agent actually read what it cites?
 *
 * The read log has been recorded since the engine adapter shipped and never
 * checked. This is the check. It matters because the grounding mandate is the
 * only thing standing between "a claim about this codebase" and "a plausible
 * sentence about code in general", and an unchecked mandate is a wish.
 *
 * Four details decide whether it works at all, and all four are easy to get
 * wrong in a way that makes the check silently always-true:
 *
 * 1. **Citations are repo-relative; the log holds absolute paths.** For a PR
 *    the workspace is a detached worktree under a temp dir, so comparing the
 *    two directly matches nothing, and a check that matches nothing passes
 *    everything. Both sides are normalized against `workspaceDir`.
 * 2. **A Grep hit is not a read.** Grep tells you a string occurs somewhere; it
 *    does not show you the code around it. Search hits are tracked separately
 *    and count as weaker evidence, never as having read the file.
 * 3. **Line-level grounding needs the range.** A file opened at lines 1–50
 *    grounds a claim about line 12 and not one about line 900.
 * 4. **The union of the round's logs.** Lenses resume the comprehension
 *    session, so each child's log holds only what *it* opened; checking one
 *    child's citations against one child's log would fail claims that are
 *    perfectly well grounded in what the round as a whole read.
 */

export interface ReadRange {
	path: string;
	/** absent means the whole file was read */
	offset?: number;
	limit?: number;
}

export interface RoundReadLog {
	/** files actually opened, with the ranges when known */
	reads: ReadRange[];
	/** files a search matched — weaker evidence, never a substitute for reading */
	searchHits: string[];
}

export interface Citation {
	path: string;
	startLine?: number;
	endLine?: number;
}

export type GroundingVerdict =
	| { grounded: true }
	| {
			grounded: false;
			reason: "never-opened" | "outside-read-range";
			path: string;
	  };

/**
 * Whether every citation on a finding was actually read this round.
 *
 * Returns the first failure rather than all of them: one ungrounded citation is
 * already enough to change how the finding is treated, and naming it precisely
 * is more useful than listing every one.
 */
export function checkGrounding(input: {
	citations: readonly Citation[];
	log: RoundReadLog;
	/** the absolute directory the agent ran in — a worktree for a PR */
	workspaceDir: string;
}): GroundingVerdict {
	const readsByPath = new Map<string, ReadRange[]>();
	for (const read of input.log.reads) {
		const key = normalize(read.path, input.workspaceDir);
		const existing = readsByPath.get(key) ?? [];
		existing.push(read);
		readsByPath.set(key, existing);
	}

	for (const citation of input.citations) {
		const key = normalize(citation.path, input.workspaceDir);
		const reads = readsByPath.get(key);
		if (reads === undefined || reads.length === 0) {
			return { grounded: false, reason: "never-opened", path: citation.path };
		}
		if (!withinSomeRead(citation, reads)) {
			return {
				grounded: false,
				reason: "outside-read-range",
				path: citation.path,
			};
		}
	}
	return { grounded: true };
}

/**
 * What to do about a failure, which is deliberately **asymmetric by severity**.
 *
 * A confidently-worded blocker that turns out to be about code the agent never
 * opened is the single most expensive output this tool can produce: it costs
 * the reader's trust in everything else on the page. A nitpick in the same
 * state costs a shrug. So an ungrounded blocker is dropped outright, and
 * everything below it is kept and marked.
 */
export function resolveUngrounded(severity: string): "drop" | "mark" {
	return severity === "blocker" ? "drop" : "mark";
}

/**
 * The whole log made repo-relative, for storing.
 *
 * A read log is only comparable to a citation once both sides have lost the
 * workspace prefix, and for a PR that prefix is a cache directory named after a
 * head sha — released at shutdown and meaningless to whoever reads the file
 * next. Normalizing once, at the point the log is written down, is what lets a
 * later reword be re-grounded without anyone having to remember which
 * disappeared directory the paths were relative to.
 */
export function toRepoRelativeLog(
	log: RoundReadLog,
	workspaceDir: string,
): RoundReadLog {
	return {
		reads: log.reads.map((read) => ({
			...read,
			path: normalize(read.path, workspaceDir),
		})),
		searchHits: log.searchHits.map((hit) => normalize(hit, workspaceDir)),
	};
}

/** repo-relative, comparable, and free of the workspace prefix */
function normalize(path: string, workspaceDir: string): string {
	let normalized = path.replace(/\\/g, "/");
	const prefix = workspaceDir.replace(/\\/g, "/").replace(/\/+$/, "");
	if (prefix !== "" && normalized.startsWith(`${prefix}/`)) {
		normalized = normalized.slice(prefix.length + 1);
	}
	return normalized.replace(/^\.\//, "").replace(/^\/+/, "");
}

function withinSomeRead(
	citation: Citation,
	reads: readonly ReadRange[],
): boolean {
	if (citation.startLine === undefined) {
		return true;
	}
	const start = citation.startLine;
	const end = citation.endLine ?? citation.startLine;

	return reads.some((read) => {
		// no range recorded means the whole file was read
		if (read.offset === undefined) {
			return true;
		}
		const readStart = read.offset;
		const readEnd =
			read.limit === undefined
				? Number.POSITIVE_INFINITY
				: read.offset + read.limit - 1;
		return start >= readStart && end <= readEnd;
	});
}
