import { describe, expect, it } from "vitest";
import {
	classifyBrainSource,
	isPrivateHost,
	looksLikeHtml,
} from "./brainSource";

describe("classifyBrainSource", () => {
	it("treats a bare path as a local file", () => {
		expect(classifyBrainSource("./review-rules.md").source).toEqual({
			kind: "file",
			path: "./review-rules.md",
		});
		expect(classifyBrainSource("/etc/rules.md").source).toEqual({
			kind: "file",
			path: "/etc/rules.md",
		});
	});

	/**
	 * GitHub goes through `gh`, so private repos work, the user's own rate limit
	 * applies, and prreview's process makes no arbitrary request at all.
	 */
	it("routes a GitHub blob URL through gh, rewriting it to its parts", () => {
		expect(
			classifyBrainSource(
				"https://github.com/acme/standards/blob/main/review/rules.md",
			).source,
		).toEqual({
			kind: "github",
			owner: "acme",
			repo: "standards",
			ref: "main",
			path: "review/rules.md",
		});
	});

	it("handles a raw GitHub URL the same way", () => {
		expect(
			classifyBrainSource("https://github.com/acme/standards/raw/v2/rules.md")
				.source,
		).toMatchObject({ kind: "github", ref: "v2", path: "rules.md" });
	});

	it("falls back to a plain fetch for any other https host", () => {
		expect(
			classifyBrainSource("https://standards.acme.com/rules.md").source,
		).toEqual({ kind: "https", url: "https://standards.acme.com/rules.md" });
	});

	it("refuses plain http rather than downgrading silently", () => {
		const { rejected } = classifyBrainSource("http://standards.acme.com/r.md");
		expect(rejected?.reason).toBe("insecure-scheme");
	});

	it("refuses a scheme it has no business fetching", () => {
		expect(
			classifyBrainSource("ftp://acme.com/rules.md").rejected?.reason,
		).toBe("unsupported-scheme");
	});

	/**
	 * The reason this check exists: 169.254.169.254 is the cloud metadata
	 * endpoint, and a tool that fetches user-supplied URLs is a convenient way
	 * to ask a CI runner for its credentials.
	 */
	it("refuses private, loopback, and metadata addresses", () => {
		for (const host of [
			"localhost",
			"127.0.0.1",
			"10.1.2.3",
			"192.168.1.1",
			"172.16.0.1",
			"169.254.169.254",
			"db.internal",
			"printer.local",
		]) {
			expect(
				classifyBrainSource(`https://${host}/rules.md`).rejected?.reason,
			).toBe("private-address");
		}
	});

	it("allows an ordinary public host", () => {
		expect(isPrivateHost("standards.acme.com")).toBe(false);
		expect(isPrivateHost("172.32.0.1")).toBe(false);
	});
});

describe("looksLikeHtml", () => {
	it("spots the page you get from pasting a blob URL", () => {
		expect(looksLikeHtml("<!DOCTYPE html><html><head>")).toBe(true);
		expect(looksLikeHtml("\n  <html lang='en'>")).toBe(true);
	});

	it("leaves markdown alone", () => {
		expect(looksLikeHtml("# Review rules\n\n- be specific")).toBe(false);
	});
});
