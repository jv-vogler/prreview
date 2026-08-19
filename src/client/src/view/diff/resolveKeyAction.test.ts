import { describe, expect, it } from "vitest";
import type { KeyAction, KeyContext } from "./resolveKeyAction";
import { resolveKeyAction } from "./resolveKeyAction";

function keyContext(overrides: Partial<KeyContext>): KeyContext {
	return {
		key: "",
		ctrlKey: false,
		metaKey: false,
		altKey: false,
		targetIsEditable: false,
		dialogOpen: false,
		pendingChord: null,
		...overrides,
	};
}

function actionFor(key: string, pendingChord: string | null = null) {
	const resolution = resolveKeyAction(keyContext({ key, pendingChord }));
	return resolution.kind === "action" ? resolution.action : resolution.kind;
}

const SINGLE_KEYS: ReadonlyArray<[string, KeyAction]> = [
	["j", "next-file"],
	["k", "prev-file"],
	["n", "next-hunk"],
	["p", "prev-hunk"],
	["]", "next-annotation"],
	["[", "prev-annotation"],
	["v", "mark-hunk-reviewed"],
	["m", "mark-file-reviewed"],
	["c", "toggle-chat"],
	["s", "toggle-diff-style"],
	["?", "open-help"],
];

describe("resolveKeyAction", () => {
	it("dispatches the whole single-key table", () => {
		for (const [key, action] of SINGLE_KEYS) {
			expect(actionFor(key)).toBe(action);
		}
	});

	it("returns null for unmapped keys", () => {
		expect(actionFor("x")).toBe("none");
		expect(actionFor("Enter")).toBe("none");
	});

	it("reads `g` as the start of a chord rather than an action", () => {
		expect(resolveKeyAction(keyContext({ key: "g" }))).toEqual({
			kind: "chord",
			prefix: "g",
		});
	});

	it("completes the go-to chords", () => {
		expect(actionFor("d", "g")).toBe("go-diff");
	});

	it("swallows a key that completes no chord instead of firing it alone", () => {
		expect(actionFor("j", "g")).toBe("none");
		expect(actionFor("?", "g")).toBe("none");
	});

	it("suppresses inside editable targets, the chat textarea included", () => {
		for (const key of ["j", "c", "w", "]", "g"]) {
			expect(
				resolveKeyAction(keyContext({ key, targetIsEditable: true })),
			).toEqual({ kind: "none" });
		}
	});

	it("suppresses while a dialog is open", () => {
		expect(
			resolveKeyAction(keyContext({ key: "j", dialogOpen: true })),
		).toEqual({ kind: "none" });
		expect(
			resolveKeyAction(
				keyContext({ key: "o", pendingChord: "g", dialogOpen: true }),
			),
		).toEqual({ kind: "none" });
	});

	it("suppresses chords with ctrl, meta, or alt", () => {
		expect(resolveKeyAction(keyContext({ key: "j", ctrlKey: true }))).toEqual({
			kind: "none",
		});
		expect(resolveKeyAction(keyContext({ key: "j", metaKey: true }))).toEqual({
			kind: "none",
		});
		expect(resolveKeyAction(keyContext({ key: "j", altKey: true }))).toEqual({
			kind: "none",
		});
	});
});
