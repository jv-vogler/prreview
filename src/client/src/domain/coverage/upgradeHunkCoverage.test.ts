import { describe, expect, it } from "vitest";
import { upgradeHunkCoverage } from "./upgradeHunkCoverage";

describe("upgradeHunkCoverage", () => {
	it("upgrades unseen to viewed and viewed to reviewed", () => {
		expect(upgradeHunkCoverage("unseen", "viewed")).toBe("viewed");
		expect(upgradeHunkCoverage("viewed", "reviewed")).toBe("reviewed");
		expect(upgradeHunkCoverage("unseen", "reviewed")).toBe("reviewed");
	});

	it("never downgrades", () => {
		expect(upgradeHunkCoverage("reviewed", "viewed")).toBe("reviewed");
		expect(upgradeHunkCoverage("reviewed", "unseen")).toBe("reviewed");
		expect(upgradeHunkCoverage("viewed", "unseen")).toBe("viewed");
	});

	it("is idempotent on equal states", () => {
		expect(upgradeHunkCoverage("viewed", "viewed")).toBe("viewed");
	});
});
