// @vitest-environment jsdom
import type { FileDiffDto } from "@dto/ChangesetDto";
import type { SessionDto } from "@dto/SessionDto";
import type { WalkthroughDto } from "@dto/WalkthroughDto";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { useLocation } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import {
	DiffNavigationProvider,
	useDiffNavigation,
} from "../diff/DiffNavigationProvider";
import type { KeyAction } from "../diff/resolveKeyAction";
import { useKeymap } from "../diff/useKeymap";
import { SESSION_QUERY_KEY } from "../session/useGuaranteedSession";
import {
	renderWithProviders,
	sessionDto,
} from "../testing/renderWithProviders";
import { WalkthroughOverlay } from "./WalkthroughOverlay";
import { useWalkthroughMode, WalkthroughProvider } from "./WalkthroughProvider";

afterEach(cleanup);

function file(path: string, hunkIds: readonly string[]): FileDiffDto {
	return {
		id: `id-${path}`,
		path,
		status: "modified",
		additions: 1,
		deletions: 0,
		isBinary: false,
		isGenerated: false,
		oldBlob: null,
		newBlob: null,
		hunks: hunkIds.map((id) => ({
			id,
			header: "@@",
			oldStart: 1,
			oldLines: 1,
			newStart: 1,
			newLines: 1,
			lines: [],
		})),
	};
}

const FILES = [
	file("src/greeting.ts", ["h1", "h2"]),
	file("docs/notes.md", ["h3"]),
];

const GREETING_STEP = {
	index: 0,
	title: "Start with the greeting",
	narration: "one string changes, and every caller keeps working",
	focus: [{ path: "src/greeting.ts", hunkIds: ["h2"] }],
};

const NOTES_STEP = {
	index: 1,
	title: "Then the notes",
	narration: "the list records what the change leaves undone",
	focus: [{ path: "docs/notes.md", hunkIds: ["h3"] }],
};

const WALKTHROUGH: WalkthroughDto = { steps: [GREETING_STEP, NOTES_STEP] };

/**
 * Deliberately not what a client-side computation would produce: both steps
 * together walk every hunk in the fixture, so a browser deriving the percentage
 * would say 100. The ring must say 62, because that is what the server said.
 */
const PROGRESS_RESPONSE = {
	progress: { position: 1, completed: false },
	coverage: { total: 62, byFile: { "id-src/greeting.ts": 100 } },
};

function session(overrides: Partial<SessionDto["analysis"]> = {}): SessionDto {
	return sessionDto("claude", {
		analysis: {
			intentMapAvailable: true,
			walkthroughAvailable: true,
			annotationCount: 2,
			...overrides,
		},
	});
}

/** exactly the wiring `DiffPage` gives the `w` key, and nothing else */
function KeyBridge() {
	const mode = useWalkthroughMode();
	const onAction = (action: KeyAction) => {
		if (action === "toggle-walkthrough") {
			mode.toggle();
		}
	};
	useKeymap({ dialogOpen: false, onAction });
	return null;
}

interface ProbeProps {
	onScroll(label: string): void;
}

function Probe({ onScroll }: ProbeProps) {
	const navigation = useDiffNavigation();
	const { search } = useLocation();

	useEffect(
		() =>
			navigation.registerScrollExecutor((cursor) =>
				onScroll(`${cursor.fileIndex}:${cursor.hunkIndex}`),
			),
		[navigation.registerScrollExecutor, onScroll],
	);

	return (
		<div>
			<p data-testid="cursor">
				{navigation.cursor.fileIndex}:{navigation.cursor.hunkIndex}
			</p>
			<p data-testid="search">{search}</p>
		</div>
	);
}

interface HarnessOptions {
	initialPath?: string;
	analysis?: Partial<SessionDto["analysis"]>;
	walkthrough?: WalkthroughDto;
}

function renderWalkthrough(options: HarnessOptions = {}) {
	const scrolls: string[] = [];
	const rendered = renderWithProviders(
		<DiffNavigationProvider files={FILES}>
			<WalkthroughProvider>
				<KeyBridge />
				<Probe onScroll={(label) => scrolls.push(label)} />
				<WalkthroughOverlay />
			</WalkthroughProvider>
		</DiffNavigationProvider>,
		{
			initialPath: options.initialPath ?? "/diff",
			responses: {
				"/api/session": session(options.analysis),
				"/api/walkthrough": options.walkthrough ?? WALKTHROUGH,
			},
			putResponse: PROGRESS_RESPONSE,
		},
	);
	return { ...rendered, scrolls };
}

function pressKey(key: string) {
	fireEvent.keyDown(document.body, { key });
}

function clickButton(name: string) {
	fireEvent.click(screen.getByRole("button", { name }));
}

const rail = () => screen.queryByRole("region", { name: "Guided walkthrough" });

describe("the walkthrough as a mode over the diff", () => {
	it("stays absent until an analysis has produced a reading order", async () => {
		renderWalkthrough({ analysis: { walkthroughAvailable: false } });
		await screen.findByTestId("cursor");

		pressKey("w");

		expect(rail()).toBeNull();
	});

	it("enters on w, narrates the step, and scrolls to its focus hunk", async () => {
		const { scrolls } = renderWalkthrough();
		await screen.findByTestId("cursor");

		pressKey("w");

		await screen.findByText(GREETING_STEP.title);
		expect(screen.getByText(GREETING_STEP.narration)).toBeTruthy();
		expect(screen.getByText(/Step 1 of 2/)).toBeTruthy();
		// this step focuses the greeting's *second* hunk, so that is where it lands
		expect(screen.getByTestId("cursor").textContent).toBe("0:1");
		expect(scrolls).toContain("0:1");
	});

	it("records the step entry and shows the coverage the answer carried", async () => {
		const { put, queryClient } = renderWalkthrough();
		await screen.findByTestId("cursor");

		pressKey("w");

		await waitFor(() => {
			expect(put).toHaveBeenCalledWith("/api/walkthrough/progress", {
				position: 0,
				completed: false,
			});
		});
		await waitFor(() => {
			expect(
				queryClient.getQueryData<SessionDto>(SESSION_QUERY_KEY)?.coverage,
			).toEqual(PROGRESS_RESPONSE.coverage);
		});
	});

	it("steps forward and back, moving the cursor and the URL with it", async () => {
		renderWalkthrough();
		await screen.findByTestId("cursor");
		pressKey("w");
		await screen.findByText(GREETING_STEP.narration);

		clickButton("Next");

		await screen.findByText(NOTES_STEP.narration);
		expect(screen.getByTestId("cursor").textContent).toBe("1:0");
		await waitFor(() => {
			expect(screen.getByTestId("search").textContent).toContain(
				"walkthrough=1",
			);
		});

		clickButton("Previous");

		await screen.findByText(GREETING_STEP.narration);
		await waitFor(() => {
			expect(screen.getByTestId("search").textContent).toContain(
				"walkthrough=0",
			);
		});
	});

	it("offers no way back before the first step", async () => {
		renderWalkthrough();
		await screen.findByTestId("cursor");
		pressKey("w");
		await screen.findByText(GREETING_STEP.narration);

		expect(
			screen.getByRole("button", { name: "Previous" }).hasAttribute("disabled"),
		).toBe(true);
	});

	it("keeps the reader's place when they leave to browse, and takes them back", async () => {
		renderWalkthrough();
		await screen.findByTestId("cursor");
		pressKey("w");
		await screen.findByText(GREETING_STEP.narration);
		clickButton("Next");
		await screen.findByText(NOTES_STEP.narration);

		clickButton("Browse freely");

		await screen.findByText(/Walkthrough paused at step 2 of 2/);
		expect(screen.queryByText(NOTES_STEP.narration)).toBeNull();
		// out of the URL too, so a refresh lands in free browsing
		await waitFor(() => {
			expect(screen.getByTestId("search").textContent).not.toContain(
				"walkthrough=",
			);
		});

		clickButton("Back to step 2 of 2");

		await screen.findByText(NOTES_STEP.narration);
	});

	it("toggles out and back in on w", async () => {
		renderWalkthrough();
		await screen.findByTestId("cursor");
		pressKey("w");
		await screen.findByText(GREETING_STEP.narration);
		clickButton("Next");
		await screen.findByText(NOTES_STEP.narration);

		pressKey("w");
		await screen.findByText(/Walkthrough paused at step 2 of 2/);

		pressKey("w");
		await screen.findByText(NOTES_STEP.narration);
	});

	it("finishes at the end, and can be read again or put away", async () => {
		renderWalkthrough({ initialPath: "/diff?walkthrough=1" });
		await screen.findByText(NOTES_STEP.narration);

		clickButton("Finish");

		await screen.findByText(/That is all 2 steps/);
		clickButton("Read it again");
		await screen.findByText(GREETING_STEP.narration);

		clickButton("Browse freely");
		clickButton("Put the walkthrough away");
		await waitFor(() => {
			expect(rail()).toBeNull();
		});
	});

	it("tells the server the walkthrough was finished", async () => {
		const { put } = renderWalkthrough({ initialPath: "/diff?walkthrough=1" });
		await screen.findByText(NOTES_STEP.narration);

		clickButton("Finish");

		await waitFor(() => {
			expect(put).toHaveBeenCalledWith("/api/walkthrough/progress", {
				position: 1,
				completed: true,
			});
		});
	});

	it("restores the step from the URL, so a refresh keeps the place", async () => {
		const { scrolls } = renderWalkthrough({
			initialPath: "/diff?walkthrough=1",
		});

		await screen.findByText(NOTES_STEP.narration);
		expect(screen.getByTestId("cursor").textContent).toBe("1:0");
		expect(scrolls).toContain("1:0");
	});

	it("resumes where the last session stopped when entering fresh", async () => {
		renderWalkthrough({
			analysis: { walkthroughProgress: { position: 1, completed: false } },
		});
		await screen.findByTestId("cursor");

		pressKey("w");

		await screen.findByText(NOTES_STEP.narration);
	});

	it("finishes a restored step the reading order no longer holds", async () => {
		renderWalkthrough({
			initialPath: "/diff?walkthrough=7",
			walkthrough: { steps: [GREETING_STEP] },
		});

		await screen.findByText(/That is all 1 steps/);
	});
});
