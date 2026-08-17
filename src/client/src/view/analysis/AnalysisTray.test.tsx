// @vitest-environment jsdom
import type { RunDto } from "@dto/RunDto";
import { runFailureReasonDtoSchema } from "@dto/RunDto";
import { act, cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { HttpError } from "../../infrastructure/httpClients/HttpError";
import {
	renderWithProviders,
	sessionDto,
} from "../testing/renderWithProviders";
import { AnalysisProvider } from "./AnalysisProvider";
import { AnalysisTray } from "./AnalysisTray";
import { ANALYSIS_FAILURE_COPY } from "./analysisFailureCopy";

afterEach(cleanup);

function run(overrides: Partial<RunDto> = {}): RunDto {
	return {
		id: "run-1",
		stage: "comprehension",
		lane: "analysis",
		status: "running",
		queuedAt: "2026-08-17T10:00:00.000Z",
		startedAt: "2026-08-17T10:00:00.000Z",
		...overrides,
	};
}

/** what the server answers before any analysis has run */
function notProduced(): HttpError {
	return new HttpError(404, "not-produced", "No analysis has run yet.");
}

function renderTray(agent: "claude" | "none" = "claude") {
	return renderWithProviders(
		<AnalysisProvider>
			<AnalysisTray />
		</AnalysisProvider>,
		{
			responses: {
				"/api/session": sessionDto(agent),
				"/api/annotations": [],
				"/api/intent-map": notProduced(),
				"/api/walkthrough": notProduced(),
			},
		},
	);
}

describe("AnalysisTray", () => {
	it("says nothing while nothing is happening", async () => {
		renderTray();
		await waitFor(() => {
			expect(screen.queryByText("loading")).toBeNull();
		});

		expect(screen.queryByRole("status")).toBeNull();
		expect(screen.queryByRole("alert")).toBeNull();
	});

	it("reports a queued run as waiting, with a clock", async () => {
		const { events } = renderTray();
		await waitFor(() => expect(screen.queryByText("loading")).toBeNull());

		act(() => {
			events.emit({
				type: "run.queued",
				run: run({ status: "queued", startedAt: undefined }),
			});
		});

		const tray = screen.getByRole("status");
		expect(tray.textContent).toContain("Waiting for the agent");
		expect(tray.textContent).toMatch(/\d:\d\d/);
	});

	it("reports a running run and offers to stop it", async () => {
		const { events, post } = renderTray();
		await waitFor(() => expect(screen.queryByText("loading")).toBeNull());

		act(() => {
			events.emit({ type: "run.started", run: run() });
		});
		expect(screen.getByRole("status").textContent).toContain(
			"Reading the change",
		);

		act(() => {
			screen.getByRole("button", { name: "Stop" }).click();
		});
		await waitFor(() => {
			expect(post).toHaveBeenCalledWith("/api/analysis/runs/run-1/cancel");
		});
	});

	it("goes quiet again when the run succeeds", async () => {
		const { events } = renderTray();
		await waitFor(() => expect(screen.queryByText("loading")).toBeNull());

		act(() => {
			events.emit({ type: "run.started", run: run() });
			events.emit({
				type: "run.succeeded",
				run: run({ status: "succeeded" }),
			});
		});

		expect(screen.queryByRole("status")).toBeNull();
	});

	it("has user-facing copy for every failure reason on the wire", async () => {
		for (const reason of runFailureReasonDtoSchema.options) {
			const { events, unmount } = renderTray();
			await waitFor(() => expect(screen.queryByText("loading")).toBeNull());

			act(() => {
				events.emit({
					type: "run.failed",
					run: run({
						status: "failed",
						error: { reason, message: "raw engine message" },
					}),
				});
			});

			const alert = screen.getByRole("alert");
			expect(alert.textContent).toContain(ANALYSIS_FAILURE_COPY[reason]);
			// the agent's own wording never reaches the reader
			expect(alert.textContent).not.toContain("raw engine message");
			expect(screen.getByRole("button", { name: "Try again" })).toBeDefined();
			unmount();
		}
	});

	it("offers a retry that starts a fresh run", async () => {
		const { events, post } = renderTray();
		await waitFor(() => expect(screen.queryByText("loading")).toBeNull());

		act(() => {
			events.emit({
				type: "run.failed",
				run: run({
					status: "failed",
					error: { reason: "crashed", message: "boom" },
				}),
			});
		});
		act(() => {
			screen.getByRole("button", { name: "Try again" }).click();
		});

		await waitFor(() => {
			expect(post).toHaveBeenCalledWith("/api/analysis", {
				task: "comprehension",
			});
		});
	});

	it("is absent entirely without an agent", async () => {
		const { events } = renderTray("none");
		await waitFor(() => expect(screen.queryByText("loading")).toBeNull());

		act(() => {
			events.emit({ type: "run.started", run: run() });
		});

		expect(screen.queryByRole("status")).toBeNull();
	});
});
