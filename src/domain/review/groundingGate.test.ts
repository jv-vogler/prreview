import { describe, expect, it } from "vitest";
import { checkGrounding, resolveUngrounded } from "./groundingGate";

const WORKSPACE = "/tmp/prreview-worktree-a1b2/repo";

describe("checkGrounding", () => {
	/**
	 * The failure that would make this whole check pointless: citations are
	 * repo-relative, the log is workspace-absolute, and a naive comparison
	 * matches nothing — which passes everything, silently, forever.
	 */
	it("resolves a repo-relative citation against a workspace-absolute log", () => {
		expect(
			checkGrounding({
				citations: [{ path: "src/retry.ts", startLine: 12 }],
				log: { reads: [{ path: `${WORKSPACE}/src/retry.ts` }], searchHits: [] },
				workspaceDir: WORKSPACE,
			}),
		).toEqual({ grounded: true });
	});

	it("handles a trailing slash on the workspace and a ./ on the citation", () => {
		expect(
			checkGrounding({
				citations: [{ path: "./src/retry.ts" }],
				log: { reads: [{ path: `${WORKSPACE}/src/retry.ts` }], searchHits: [] },
				workspaceDir: `${WORKSPACE}/`,
			}).grounded,
		).toBe(true);
	});

	it("fails a citation to a file that was never opened", () => {
		expect(
			checkGrounding({
				citations: [{ path: "src/never.ts" }],
				log: { reads: [{ path: `${WORKSPACE}/src/retry.ts` }], searchHits: [] },
				workspaceDir: WORKSPACE,
			}),
		).toEqual({
			grounded: false,
			reason: "never-opened",
			path: "src/never.ts",
		});
	});

	/**
	 * A Grep hit says a string occurs somewhere. It does not show the agent the
	 * code around it, so it cannot ground a claim about behaviour.
	 */
	it("does not accept a search hit as having read the file", () => {
		expect(
			checkGrounding({
				citations: [{ path: "src/retry.ts" }],
				log: { reads: [], searchHits: [`${WORKSPACE}/src/retry.ts`] },
				workspaceDir: WORKSPACE,
			}),
		).toMatchObject({ grounded: false, reason: "never-opened" });
	});

	it("accepts a line inside a recorded read range", () => {
		expect(
			checkGrounding({
				citations: [{ path: "src/retry.ts", startLine: 12, endLine: 20 }],
				log: {
					reads: [{ path: `${WORKSPACE}/src/retry.ts`, offset: 1, limit: 50 }],
					searchHits: [],
				},
				workspaceDir: WORKSPACE,
			}).grounded,
		).toBe(true);
	});

	it("rejects a line outside every recorded read range", () => {
		expect(
			checkGrounding({
				citations: [{ path: "src/retry.ts", startLine: 900 }],
				log: {
					reads: [{ path: `${WORKSPACE}/src/retry.ts`, offset: 1, limit: 50 }],
					searchHits: [],
				},
				workspaceDir: WORKSPACE,
			}),
		).toMatchObject({ grounded: false, reason: "outside-read-range" });
	});

	it("treats a read with no range as the whole file", () => {
		expect(
			checkGrounding({
				citations: [{ path: "src/retry.ts", startLine: 900 }],
				log: { reads: [{ path: `${WORKSPACE}/src/retry.ts` }], searchHits: [] },
				workspaceDir: WORKSPACE,
			}).grounded,
		).toBe(true);
	});

	it("accepts a line covered by any one of several reads", () => {
		expect(
			checkGrounding({
				citations: [{ path: "src/retry.ts", startLine: 120 }],
				log: {
					reads: [
						{ path: `${WORKSPACE}/src/retry.ts`, offset: 1, limit: 50 },
						{ path: `${WORKSPACE}/src/retry.ts`, offset: 100, limit: 50 },
					],
					searchHits: [],
				},
				workspaceDir: WORKSPACE,
			}).grounded,
		).toBe(true);
	});

	it("requires every citation, not just one", () => {
		expect(
			checkGrounding({
				citations: [{ path: "src/retry.ts" }, { path: "src/other.ts" }],
				log: { reads: [{ path: `${WORKSPACE}/src/retry.ts` }], searchHits: [] },
				workspaceDir: WORKSPACE,
			}),
		).toMatchObject({ grounded: false, path: "src/other.ts" });
	});

	it("grounds a finding that cites nothing", () => {
		expect(
			checkGrounding({
				citations: [],
				log: { reads: [], searchHits: [] },
				workspaceDir: WORKSPACE,
			}).grounded,
		).toBe(true);
	});
});

describe("resolveUngrounded", () => {
	/**
	 * Asymmetric on purpose: one wrong confident comment costs more trust than
	 * a missed nit.
	 */
	it("drops an ungrounded blocker and marks everything below it", () => {
		expect(resolveUngrounded("blocker")).toBe("drop");
		expect(resolveUngrounded("should-fix")).toBe("mark");
		expect(resolveUngrounded("consider")).toBe("mark");
		expect(resolveUngrounded("nitpick")).toBe("mark");
	});
});
