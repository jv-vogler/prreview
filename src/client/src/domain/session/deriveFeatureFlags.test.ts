import { describe, expect, it } from "vitest";
import { deriveFeatureFlags } from "./deriveFeatureFlags";

describe("deriveFeatureFlags", () => {
	it("returns every AI flag false in M1 even with a full toolchain", () => {
		const flags = deriveFeatureFlags({
			agent: { kind: "claude", version: "2.0.0" },
			github: { kind: "gh" },
		});
		expect(flags).toEqual({
			analysis: false,
			chat: false,
			walkthrough: false,
		});
	});

	it("returns every AI flag false with no toolchain at all", () => {
		const flags = deriveFeatureFlags({
			agent: { kind: "none" },
			github: { kind: "none" },
		});
		expect(Object.values(flags).every((flag) => flag === false)).toBe(true);
	});
});
