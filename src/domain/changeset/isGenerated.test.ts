import { describe, expect, it } from "vitest";
import { isGenerated } from "./isGenerated";

describe("isGenerated", () => {
	it.each([
		"package-lock.json",
		"apps/web/yarn.lock",
		"pnpm-lock.yaml",
		"backend/Cargo.lock",
		"Gemfile.lock",
		"go.sum",
	])("flags the lockfile %s", (path) => {
		expect(isGenerated(path)).toBe(true);
	});

	it.each(["assets/app.min.js", "styles/site.min.css"])(
		"flags the minified bundle %s",
		(path) => {
			expect(isGenerated(path)).toBe(true);
		},
	);

	it.each(["dist/index.js", "packages/core/dist/bundle.js", "vendor/lib.rb"])(
		"flags build output and vendored code in %s",
		(path) => {
			expect(isGenerated(path)).toBe(true);
		},
	);

	it("flags source maps", () => {
		expect(isGenerated("build/app.js.map")).toBe(true);
	});

	it.each([
		"src/app.ts",
		"README.md",
		"go.mod",
		"distances.py",
		"src/vendors.ts",
		"docs/dist-overview.md",
		"minutes.txt",
	])("leaves human-authored %s alone", (path) => {
		expect(isGenerated(path)).toBe(false);
	});

	it("only matches dist/vendor as directory names, not as file names", () => {
		expect(isGenerated("dist")).toBe(false);
		expect(isGenerated("src/dist/generated.js")).toBe(true);
	});
});
