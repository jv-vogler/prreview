import { describe, expect, it } from "vitest";
import { parseAgentVersion } from "./agentVersion";

describe("parseAgentVersion", () => {
	it("extracts the version token from the CLI's banner", () => {
		expect(parseAgentVersion("2.1.239 (Claude Code)\n")).toBe("2.1.239");
	});

	it("falls back to the trimmed whole line when there is no token", () => {
		expect(parseAgentVersion("  something unexpected  \n")).toBe(
			"something unexpected",
		);
	});
});
