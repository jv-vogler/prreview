import { describe, expect, it } from "vitest";
import { parseAlertBlock } from "./parseAlertBlock";

describe("parseAlertBlock", () => {
	it("pulls the alert type, its quoted text, and the rest of the body apart", () => {
		const body = [
			"> [!WARNING]",
			"> **Silent overwrite** — the second write clobbers the first.",
			"",
			"Consider merging instead of assigning twice.",
		].join("\n");

		expect(parseAlertBlock(body)).toEqual({
			type: "WARNING",
			text: "**Silent overwrite** — the second write clobbers the first.",
			rest: "Consider merging instead of assigning twice.",
		});
	});

	it("handles an alert block that is the entire body", () => {
		const body = ["> [!NOTE]", "> Just this."].join("\n");
		expect(parseAlertBlock(body)).toEqual({
			type: "NOTE",
			text: "Just this.",
			rest: "",
		});
	});

	it("returns null when the body does not open with an alert block", () => {
		expect(parseAlertBlock("Just a plain paragraph.")).toBeNull();
	});

	it("returns null for an unrecognized alert type", () => {
		expect(parseAlertBlock("> [!DANGER]\n> nope")).toBeNull();
	});
});
