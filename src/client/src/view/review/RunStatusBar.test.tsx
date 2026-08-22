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
});
