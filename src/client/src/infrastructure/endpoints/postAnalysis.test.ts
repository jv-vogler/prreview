import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../httpClients/apiClient";
import { HttpError } from "../httpClients/HttpError";
import { postAnalysis } from "./postAnalysis";
import { postCancelRun } from "./postCancelRun";

function apiClient(post: ApiClient["post"]): ApiClient {
	return {
		get: vi.fn().mockRejectedValue(new Error("not used")),
		put: vi.fn().mockRejectedValue(new Error("not used")),
		post,
	};
}

const conflictBody = {
	reason: "run-already-running",
	message: "An analysis of this change is already running.",
	existingRunId: "run-7",
};

describe("postAnalysis", () => {
	it("returns the accepted run id", async () => {
		const api = apiClient(vi.fn().mockResolvedValue({ runId: "run-1" }));
		await expect(postAnalysis(api, { task: "comprehension" })).resolves.toEqual(
			{
				kind: "accepted",
				runId: "run-1",
			},
		);
		expect(api.post).toHaveBeenCalledWith("/api/analysis", {
			task: "comprehension",
		});
	});

	it("reads the 409 body as a conflict rather than a failure", async () => {
		const api = apiClient(
			vi
				.fn()
				.mockRejectedValue(
					new HttpError(
						409,
						conflictBody.reason,
						conflictBody.message,
						conflictBody,
					),
				),
		);
		await expect(postAnalysis(api, { task: "comprehension" })).resolves.toEqual(
			{
				kind: "conflict",
				existingRunId: "run-7",
				message: conflictBody.message,
			},
		);
	});

	it("throws a 409 whose body is not the conflict shape", async () => {
		const api = apiClient(
			vi
				.fn()
				.mockRejectedValue(new HttpError(409, "run-already-running", "no id")),
		);
		await expect(postAnalysis(api, { task: "comprehension" })).rejects.toThrow(
			HttpError,
		);
	});

	it("throws every other status, 503 agent-missing included", async () => {
		const api = apiClient(
			vi
				.fn()
				.mockRejectedValue(new HttpError(503, "agent-missing", "no claude")),
		);
		await expect(postAnalysis(api, { task: "comprehension" })).rejects.toThrow(
			"no claude",
		);
	});
});

describe("postCancelRun", () => {
	it("posts to the run's cancel path with the id escaped", async () => {
		const post = vi.fn().mockResolvedValue(undefined);
		await postCancelRun(apiClient(post), "run/1");
		expect(post).toHaveBeenCalledWith("/api/analysis/runs/run%2F1/cancel");
	});
});
