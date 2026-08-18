import type { ToolchainDto } from "@dto/SessionDto";
import { describe, expect, it } from "vitest";
import { deriveFeatureFlags } from "./deriveFeatureFlags";

const ROWS: ReadonlyArray<{
	name: string;
	toolchain: ToolchainDto;
	expected: { analysis: boolean; chat: boolean };
}> = [
	{
		name: "claude present, gh present",
		toolchain: {
			agent: { kind: "claude", version: "2.1.233" },
			github: { kind: "gh" },
		},
		expected: { analysis: true, chat: true },
	},
	{
		name: "claude present, no github at all",
		toolchain: {
			agent: { kind: "claude", version: "2.1.233" },
			github: { kind: "none" },
		},
		expected: { analysis: true, chat: true },
	},
	{
		name: "no agent, gh present",
		toolchain: { agent: { kind: "none" }, github: { kind: "gh" } },
		expected: { analysis: false, chat: false },
	},
	{
		name: "no toolchain at all",
		toolchain: { agent: { kind: "none" }, github: { kind: "none" } },
		expected: { analysis: false, chat: false },
	},
];

describe("deriveFeatureFlags", () => {
	for (const row of ROWS) {
		it(`derives the flags for ${row.name}`, () => {
			expect(deriveFeatureFlags(row.toolchain)).toEqual(row.expected);
		});
	}

	it("keys every flag on the agent alone, never on github", () => {
		const withGh = deriveFeatureFlags({
			agent: { kind: "claude", version: "2.1.233" },
			github: { kind: "gh" },
		});
		const withGitRemote = deriveFeatureFlags({
			agent: { kind: "claude", version: "2.1.233" },
			github: { kind: "git-remote" },
		});
		expect(withGitRemote).toEqual(withGh);
	});
});
