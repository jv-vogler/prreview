import type { ReviewPassDto } from "@dto/ReviewDto";
import type { RunDto } from "@dto/RunDto";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RunStatusBar } from "./RunStatusBar";
import type { ReviewRunState } from "./useReviewRun";

function passWithResidue(residue: string[]): ReviewPassDto {
	return {
		overview: "x",
		verdict: "x",
		ticket: null,
		comments: [],
		explanations: [],
		residue,
		published: null,
	};
}

function stateWith(
	run: RunDto | null,
	pass: ReviewPassDto | null = null,
): ReviewRunState {
	return {
		run,
		pass,
		freshness: null,
		applyPass: vi.fn(),
		starting: false,
		startError: null,
		start: vi.fn(),
		cancel: vi.fn(),
	};
}

describe("RunStatusBar", () => {
	it("renders nothing when there is no run", () => {
		render(<RunStatusBar review={stateWith(null)} />);
		expect(screen.queryByRole("status")).toBeNull();
		expect(screen.queryByRole("alert")).toBeNull();
	});

	it("shows the running state with a Stop control", () => {
		const run: RunDto = {
			id: "run-1",
			kind: "review",
			status: "running",
			queuedAt: "2026-08-21T10:00:00.000Z",
			startedAt: "2026-08-21T10:00:00.000Z",
			idleTimeoutMs: 300_000,
			progress: {
				activity: "Reading src/index.ts",
				toolCalls: 2,
				itinerary: null,
				lastActivityAt: "2026-08-21T10:00:01.000Z",
			},
		};
		render(<RunStatusBar review={stateWith(run)} />);
		expect(screen.getByRole("status")).toBeTruthy();
		expect(screen.getByText(/Reading src\/index\.ts/)).toBeTruthy();
		expect(screen.getByRole("button", { name: /stop/i })).toBeTruthy();
	});

	it("shows a queued run waiting message", () => {
		const run: RunDto = {
			id: "run-1",
			kind: "review",
			status: "queued",
			queuedAt: "2026-08-21T10:00:00.000Z",
			idleTimeoutMs: 300_000,
		};
		render(<RunStatusBar review={stateWith(run)} />);
		expect(screen.getByText(/queued/i)).toBeTruthy();
	});

	it("shows a failed run with its copy and a retry control", () => {
		const run: RunDto = {
			id: "run-1",
			kind: "review",
			status: "failed",
			queuedAt: "t1",
			idleTimeoutMs: 300_000,
			error: { reason: "api-error", message: "HTTP 429: rate limited" },
		};
		render(<RunStatusBar review={stateWith(run)} />);
		expect(screen.getByRole("alert")).toBeTruthy();
		expect(screen.getByText("HTTP 429: rate limited")).toBeTruthy();
		expect(screen.getByRole("button", { name: /try again/i })).toBeTruthy();
	});

	it("shows residue left behind by a successful run (SEC-003/TASK-030)", () => {
		const run: RunDto = {
			id: "run-1",
			kind: "review",
			status: "succeeded",
			queuedAt: "t1",
			idleTimeoutMs: 300_000,
		};
		render(
			<RunStatusBar
				review={stateWith(run, passWithResidue(["scratch-test.ts"]))}
			/>,
		);
		expect(screen.getByRole("alert")).toBeTruthy();
		expect(screen.getByText("scratch-test.ts")).toBeTruthy();
	});

	it("renders nothing for a clean successful run", () => {
		const run: RunDto = {
			id: "run-1",
			kind: "review",
			status: "succeeded",
			queuedAt: "t1",
			idleTimeoutMs: 300_000,
		};
		render(<RunStatusBar review={stateWith(run, passWithResidue([]))} />);
		expect(screen.queryByRole("alert")).toBeNull();
	});

	it("renders one rail step per itinerary entry, tagged with its state", () => {
		const run: RunDto = {
			id: "run-1",
			kind: "review",
			status: "running",
			queuedAt: "t1",
			startedAt: "t1",
			idleTimeoutMs: 300_000,
			progress: {
				activity: "Reading src/index.ts",
				toolCalls: 4,
				itinerary: [
					{ label: "Find the ticket", state: "done" },
					{ label: "Read the big picture", state: "active" },
					{ label: "Find problems", state: "pending" },
				],
				lastActivityAt: "t1",
			},
		};
		render(<RunStatusBar review={stateWith(run)} />);
		expect(document.querySelectorAll("[data-step-state]")).toHaveLength(3);
		expect(document.querySelector('[data-step-state="done"]')).not.toBeNull();
		expect(document.querySelector('[data-step-state="active"]')).not.toBeNull();
		expect(
			document.querySelector('[data-step-state="pending"]'),
		).not.toBeNull();
	});

	it("shows no rail when the run has no itinerary yet", () => {
		const run: RunDto = {
			id: "run-1",
			kind: "review",
			status: "running",
			queuedAt: "t1",
			startedAt: "t1",
			idleTimeoutMs: 300_000,
			progress: {
				activity: "Reading src/index.ts",
				toolCalls: 1,
				itinerary: null,
				lastActivityAt: "t1",
			},
		};
		render(<RunStatusBar review={stateWith(run)} />);
		expect(document.querySelectorAll("[data-step-state]")).toHaveLength(0);
	});

	it("shows what the run cost and found on the completed take line", () => {
		const run: RunDto = {
			id: "run-1",
			kind: "review",
			status: "succeeded",
			queuedAt: "2026-08-21T10:00:00.000Z",
			startedAt: "2026-08-21T10:00:00.000Z",
			endedAt: "2026-08-21T10:02:41.000Z",
			idleTimeoutMs: 300_000,
			progress: {
				activity: "Writing it up",
				toolCalls: 47,
				itinerary: null,
				lastActivityAt: "2026-08-21T10:02:40.000Z",
			},
		};
		const pass: ReviewPassDto = {
			overview: "x",
			verdict: "x",
			ticket: null,
			residue: [],
			explanations: [],
			published: null,
			comments: [
				{
					id: "c1",
					path: "a.ts",
					startLine: 1,
					endLine: 1,
					tier: "blocker",
					title: "t",
					body: "b",
					proof: "p",
					verified: false,
					lane: "review",
					edited: false,
					deleted: false,
					published: false,
					placement: { kind: "exact", fileId: "a.ts", side: "new", line: 1 },
				},
				{
					id: "c2",
					path: "a.ts",
					startLine: 2,
					endLine: 2,
					tier: "nitpick",
					title: "t2",
					body: "b2",
					proof: "p2",
					verified: false,
					lane: "review",
					edited: false,
					deleted: false,
					published: false,
					placement: { kind: "exact", fileId: "a.ts", side: "new", line: 2 },
				},
			],
		};
		render(<RunStatusBar review={stateWith(run, pass)} />);
		expect(screen.getByText("2:41")).toBeTruthy();
		expect(screen.getByText(/47 steps/)).toBeTruthy();
		expect(screen.getByText(/2 findings, 1 blocker/)).toBeTruthy();
	});

	it("shows a neutral stopped line, with a retry control, when the run was cancelled", () => {
		const run: RunDto = {
			id: "run-1",
			kind: "review",
			status: "cancelled",
			queuedAt: "2026-08-21T10:00:00.000Z",
			startedAt: "2026-08-21T10:00:00.000Z",
			endedAt: "2026-08-21T10:00:48.000Z",
			idleTimeoutMs: 300_000,
		};
		render(<RunStatusBar review={stateWith(run)} />);
		expect(screen.getByText(/review stopped/i)).toBeTruthy();
		expect(screen.getByRole("button", { name: /try again/i })).toBeTruthy();
	});
});
