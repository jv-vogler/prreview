import { describe, expect, it } from "vitest";
import { deriveFeatureFlags } from "./deriveFeatureFlags";

describe("deriveFeatureFlags", () => {
	it("is available when the toolchain found a claude agent", () => {
		const flags = deriveFeatureFlags({
			agent: { kind: "claude", version: "2.1.239" },
			github: { kind: "none" },
		});
		expect(flags.aiAvailable).toBe(true);
	});

	it("is absent, not disabled, with no agent on PATH", () => {
		const flags = deriveFeatureFlags({
			agent: { kind: "none" },
			github: { kind: "gh" },
		});
		expect(flags.aiAvailable).toBe(false);
	});

	it("is available whenever a GitHub backend was found, of any kind", () => {
		const flags = deriveFeatureFlags({
			agent: { kind: "none" },
			github: { kind: "gh" },
		});
		expect(flags.githubAvailable).toBe(true);
	});

	it("is absent, not disabled, with no GitHub backend at all", () => {
		const flags = deriveFeatureFlags({
			agent: { kind: "claude", version: "2.1.239" },
			github: { kind: "none" },
		});
		expect(flags.githubAvailable).toBe(false);
	});
});
