// @vitest-environment jsdom
import type { FileDiffDto } from "@dto/ChangesetDto";
import type { IntentMapDto } from "@dto/IntentMapDto";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { IntentMapView } from "./IntentMapView";

afterEach(cleanup);

function file(id: string, path: string, changedLines: number): FileDiffDto {
	return {
		id,
		path,
		status: "modified",
		additions: changedLines,
		deletions: 0,
		isBinary: false,
		isGenerated: false,
		oldBlob: null,
		newBlob: null,
		hunks: [
			{
				id: `${id}h1`,
				header: "@@",
				oldStart: 1,
				oldLines: 1,
				newStart: 1,
				newLines: changedLines,
				lines: Array.from({ length: changedLines }, () => ({
					type: "add" as const,
					content: "x",
				})),
			},
		],
	};
}

const FILES = [
	file("f1", "src/greeting.ts", 30),
	file("f2", "src/renamed.ts", 10),
];

const INTENT_MAP: IntentMapDto = {
	summary: "Adds an excited greeting mode and updates the call site.",
	suggestedEntryPoint: "Start with src/greeting.ts to see the API change.",
	clusters: [
		{
			name: "Excited greeting",
			kind: "core",
			description: "The behaviour that actually changed.",
			members: [{ path: "src/greeting.ts", hunkIds: ["f1h1"] }],
		},
		{
			name: "Rename fallout",
			kind: "refactor",
			description: "Call sites following the rename.",
			members: [
				{ path: "src/renamed.ts", hunkIds: [] },
				{ path: "src/vanished.ts", hunkIds: [] },
			],
		},
	],
};

function renderMap(intentMap: IntentMapDto = INTENT_MAP) {
	return render(
		<MemoryRouter initialEntries={["/orient"]}>
			<IntentMapView intentMap={intentMap} files={FILES} />
		</MemoryRouter>,
	);
}

describe("IntentMapView", () => {
	it("leads with the summary and names every cluster", () => {
		renderMap();

		expect(screen.getByText(/Adds an excited greeting mode/)).toBeDefined();
		expect(
			screen.getByRole("heading", { name: "Excited greeting" }),
		).toBeDefined();
		expect(
			screen.getByRole("heading", { name: "Rename fallout" }),
		).toBeDefined();
	});

	it("sizes each cluster against the whole change", () => {
		renderMap();

		expect(screen.getByText("75%")).toBeDefined();
		expect(screen.getByText("25%")).toBeDefined();
	});

	it("links a member file into the diff at that file and hunk", () => {
		renderMap();

		const member = screen.getByRole("link", { name: "src/greeting.ts" });
		expect(member.getAttribute("href")).toBe("/diff?file=f1&hunk=f1h1");
	});

	it("does not link a path this round does not contain", () => {
		renderMap();

		expect(screen.queryByRole("link", { name: "src/vanished.ts" })).toBeNull();
		expect(screen.getByText("src/vanished.ts")).toBeDefined();
	});

	it("offers the resolved entry point as the primary action", () => {
		renderMap();

		const action = screen.getByRole("link", { name: /Start with/ });
		expect(action.getAttribute("href")).toBe("/diff?file=f1");
	});

	it("falls back to the diff when the entry point names nothing known", () => {
		renderMap({ ...INTENT_MAP, suggestedEntryPoint: "wherever you like" });

		const action = screen.getByRole("link", { name: "Open the diff" });
		expect(action.getAttribute("href")).toBe("/diff");
	});

	it("omits the shares when nothing measurable is covered", () => {
		renderMap({
			...INTENT_MAP,
			clusters: [
				{
					name: "Unknown files",
					kind: "chore",
					description: "d",
					members: [{ path: "src/vanished.ts", hunkIds: [] }],
				},
			],
		});

		expect(screen.queryByText("0%")).toBeNull();
	});
});
