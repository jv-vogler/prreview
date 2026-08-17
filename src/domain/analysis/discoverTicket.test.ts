import { describe, expect, it } from "vitest";
import { discoverTicket } from "./discoverTicket";

describe("discoverTicket", () => {
	it("finds a tracker key in a branch name and normalizes its case", () => {
		expect(discoverTicket({ branch: "feature/eng-4471-retry-webhooks" })).toEqual(
			{ key: "ENG-4471", source: "branch" },
		);
	});

	it("finds a key at either end of a branch name", () => {
		expect(discoverTicket({ branch: "ENG-12" })?.key).toBe("ENG-12");
		expect(discoverTicket({ branch: "jv/ABC-9/thing" })?.key).toBe("ABC-9");
		expect(discoverTicket({ branch: "fix_PROJ-77_flaky" })?.key).toBe("PROJ-77");
	});

	it("prefers the branch, the most deliberate signal a developer leaves", () => {
		expect(
			discoverTicket({
				branch: "feature/ENG-1-from-branch",
				title: "ENG-2 from title",
				body: "ENG-3 from body",
			}),
		).toEqual({ key: "ENG-1", source: "branch" });
	});

	it("falls back to the title, then the body", () => {
		expect(
			discoverTicket({ title: "ENG-2 from title", body: "ENG-3 from body" }),
		).toEqual({ key: "ENG-2", source: "title" });
		expect(discoverTicket({ body: "closes ENG-3" })).toEqual({
			key: "ENG-3",
			source: "body",
		});
	});

	it("keeps a real URL and never synthesizes one from a bare key", () => {
		const withUrl = discoverTicket({
			body: "see https://acme.atlassian.net/browse/ENG-77 for context",
		});
		expect(withUrl).toEqual({
			key: "ENG-77",
			source: "body",
			url: "https://acme.atlassian.net/browse/ENG-77",
		});

		const withoutUrl = discoverTicket({ body: "see ENG-77 for context" });
		expect(withoutUrl?.url).toBeUndefined();
	});

	it("reads a GitHub issue URL as its number", () => {
		expect(
			discoverTicket({ body: "fixes https://github.com/o/r/issues/312" }),
		).toEqual({
			key: "#312",
			source: "body",
			url: "https://github.com/o/r/issues/312",
		});
	});

	it("finds a bare GitHub issue reference", () => {
		expect(discoverTicket({ title: "fix the retry loop (#312)" })?.key).toBe(
			"#312",
		);
	});

	/**
	 * The false positives that would otherwise put a fake ticket link in the
	 * header of every change that mentions an encoding or a spec year.
	 */
	it("does not read technical prose as a ticket", () => {
		expect(discoverTicket({ title: "decode UTF-8 correctly" })).toBeNull();
		expect(discoverTicket({ body: "switch the digest to SHA-256" })).toBeNull();
		expect(discoverTicket({ title: "target ES-2022" })).toBeNull();
		expect(discoverTicket({ body: "per RFC-7231 the method is idempotent" })).toBeNull();
		expect(discoverTicket({ branch: "chore/utf-8-decoding" })).toBeNull();
	});

	it("still finds a real key in text that also mentions a technical token", () => {
		expect(
			discoverTicket({ body: "ENG-77: decode UTF-8 correctly" })?.key,
		).toBe("ENG-77");
		expect(
			discoverTicket({ body: "decode UTF-8 correctly, see ENG-77" })?.key,
		).toBe("ENG-77");
	});

	/**
	 * Squash-merge conventions append the PR's own number to its title, so
	 * without this a PR cheerfully links to itself as its ticket.
	 */
	it("never reports the PR's own number as its ticket", () => {
		expect(
			discoverTicket({ title: "fix the retry loop (#20)", selfIssueNumber: 20 }),
		).toBeNull();
		expect(
			discoverTicket({ title: "fix the retry loop (#312)", selfIssueNumber: 20 })
				?.key,
		).toBe("#312");
	});

	it("returns null when there is nothing to find, rather than guessing", () => {
		expect(discoverTicket({})).toBeNull();
		expect(discoverTicket({ branch: "main", title: "", body: "" })).toBeNull();
		expect(
			discoverTicket({ branch: "fix-the-thing", title: "Fix the thing" }),
		).toBeNull();
	});
});
