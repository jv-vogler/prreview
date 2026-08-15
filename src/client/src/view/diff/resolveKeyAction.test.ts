import { describe, expect, it } from "vitest";
import type { KeyContext } from "./resolveKeyAction";
import { resolveKeyAction } from "./resolveKeyAction";

function keyContext(overrides: Partial<KeyContext>): KeyContext {
	return {
		key: "",
		ctrlKey: false,
		metaKey: false,
		altKey: false,
		targetIsEditable: false,
		dialogOpen: false,
		...overrides,
	};
}

describe("resolveKeyAction", () => {
	it("dispatches the full M1 keymap", () => {
		expect(resolveKeyAction(keyContext({ key: "j" }))).toBe("next-file");
		expect(resolveKeyAction(keyContext({ key: "k" }))).toBe("prev-file");
		expect(resolveKeyAction(keyContext({ key: "n" }))).toBe("next-hunk");
		expect(resolveKeyAction(keyContext({ key: "p" }))).toBe("prev-hunk");
		expect(resolveKeyAction(keyContext({ key: "v" }))).toBe(
			"mark-hunk-reviewed",
		);
		expect(resolveKeyAction(keyContext({ key: "m" }))).toBe(
			"mark-file-reviewed",
		);
		expect(resolveKeyAction(keyContext({ key: "s" }))).toBe(
			"toggle-diff-style",
		);
		expect(resolveKeyAction(keyContext({ key: "?" }))).toBe("open-help");
	});

	it("returns null for unmapped keys", () => {
		expect(resolveKeyAction(keyContext({ key: "x" }))).toBeNull();
		expect(resolveKeyAction(keyContext({ key: "Enter" }))).toBeNull();
	});

	it("suppresses inside editable targets", () => {
		expect(
			resolveKeyAction(keyContext({ key: "j", targetIsEditable: true })),
		).toBeNull();
	});

	it("suppresses while a dialog is open", () => {
		expect(
			resolveKeyAction(keyContext({ key: "j", dialogOpen: true })),
		).toBeNull();
	});

	it("suppresses chords with ctrl, meta, or alt", () => {
		expect(
			resolveKeyAction(keyContext({ key: "j", ctrlKey: true })),
		).toBeNull();
		expect(
			resolveKeyAction(keyContext({ key: "j", metaKey: true })),
		).toBeNull();
		expect(resolveKeyAction(keyContext({ key: "j", altKey: true }))).toBeNull();
	});
});
