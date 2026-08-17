// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Explanation } from "../../domain/annotation/Annotation";
import { ExplanationNote } from "./ExplanationNote";
import { UnanchoredTray } from "./UnanchoredTray";

afterEach(cleanup);

function explanation(overrides: Partial<Explanation> = {}): Explanation {
	return {
		id: "a1",
		species: "explanation",
		kind: "mechanism",
		anchor: {
			fileId: "f1",
			path: "src/greeting.ts",
			side: "new",
			startLine: 3,
			endLine: 3,
			placement: "in-diff",
		},
		anchorStatus: "anchored",
		body: "The ternary appends an exclamation mark when the flag is on.",
		title: null,
		touchedByDelta: false,
		createdAt: "2026-08-17T10:00:00.000Z",
		roundId: "r1",
		...overrides,
	};
}

describe("ExplanationNote", () => {
	it("states what the change does and offers nothing to act on", () => {
		render(<ExplanationNote note={explanation()} />);

		expect(screen.getByText(/ternary appends an exclamation/)).toBeDefined();
		// F3's visual contract: an explanation is never a review comment, so it
		// carries no accept/edit/dismiss affordance of any kind
		expect(screen.queryAllByRole("button")).toHaveLength(0);
		expect(screen.queryAllByRole("link")).toHaveLength(0);
		expect(screen.queryAllByRole("textbox")).toHaveLength(0);
	});

	it("labels the note with its kind", () => {
		render(<ExplanationNote note={explanation({ kind: "intent" })} />);

		expect(screen.getByText("Intent")).toBeDefined();
	});

	it("renders a note whose kind the client does not know, without a label", () => {
		render(<ExplanationNote note={explanation({ kind: null })} />);

		expect(screen.getByText(/ternary appends/)).toBeDefined();
		expect(screen.queryByText("Mechanism")).toBeNull();
	});

	it("says so when the anchor was matched only approximately", () => {
		render(<ExplanationNote note={explanation({ anchorStatus: "fuzzy" })} />);

		const marker = screen.getByText("moved");
		expect(marker.getAttribute("title")).toContain("matched approximately");
	});

	it("says nothing about moving when the anchor is exact", () => {
		render(<ExplanationNote note={explanation({ anchorStatus: "moved" })} />);

		expect(screen.queryByText("moved")).toBeNull();
	});

	it("carries its species and anchor state for the diff to key styling off", () => {
		render(<ExplanationNote note={explanation({ anchorStatus: "fuzzy" })} />);

		const note = screen.getByRole("complementary");
		expect(note.dataset.annotationSpecies).toBe("explanation");
		expect(note.dataset.anchorStatus).toBe("fuzzy");
	});
});

describe("UnanchoredTray", () => {
	it("keeps the notes whose code is gone instead of placing them", () => {
		render(
			<UnanchoredTray
				notes={[
					explanation({ id: "a1", anchorStatus: "orphaned" }),
					explanation({
						id: "a2",
						anchorStatus: "orphaned",
						body: "second note",
					}),
				]}
			/>,
		);

		expect(
			screen.getByText(/2 notes describe code that is no longer/),
		).toBeDefined();
		expect(screen.getByText("second note")).toBeDefined();
	});

	it("counts one note in words a reader would use", () => {
		render(
			<UnanchoredTray notes={[explanation({ anchorStatus: "orphaned" })]} />,
		);

		expect(screen.getByText(/^One note describes/)).toBeDefined();
	});

	it("renders nothing when the file has no unattached notes", () => {
		const { container } = render(<UnanchoredTray notes={[]} />);

		expect(container.textContent).toBe("");
	});
});
