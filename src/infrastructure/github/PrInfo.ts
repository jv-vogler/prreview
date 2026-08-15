/**
 * PR metadata as the gh backend reports it (ARCHITECTURE §4: "title, body,
 * base, head, url"). Field names mirror `gh pr view --json` verbatim so the
 * adapter is a straight parse. Phase 5's GithubService port declares its own
 * structural copy of this shape (application code cannot import from
 * infrastructure); assignability is checked where the container wires them.
 */
export interface PrInfo {
	title: string;
	body: string;
	baseRefName: string;
	headRefName: string;
	headRefOid: string;
	url: string;
	state: string;
}
