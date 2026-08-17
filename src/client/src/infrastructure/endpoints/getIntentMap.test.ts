import type { IntentMapDto } from "@dto/IntentMapDto";
import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../httpClients/apiClient";
import { HttpError } from "../httpClients/HttpError";
import { getIntentMap } from "./getIntentMap";
import { getWalkthrough } from "./getWalkthrough";

function apiClient(get: ApiClient["get"]): ApiClient {
	return {
		get,
		put: vi.fn().mockRejectedValue(new Error("not used")),
		post: vi.fn().mockRejectedValue(new Error("not used")),
	};
}

const intentMap: IntentMapDto = {
	summary: "Moves the port into the config object.",
	clusters: [
		{
			name: "config",
			kind: "core",
			description: "The port now comes from config.",
			members: [{ path: "src/server.ts", hunkIds: ["h1"] }],
		},
	],
	suggestedEntryPoint: "src/server.ts",
};

describe("getIntentMap", () => {
	it("returns the intent map when one has been produced", async () => {
		const api = apiClient(vi.fn().mockResolvedValue(intentMap));
		await expect(getIntentMap(api)).resolves.toEqual(intentMap);
		expect(api.get).toHaveBeenCalledWith("/api/intent-map");
	});

	it("resolves to null when no analysis has produced one yet", async () => {
		const api = apiClient(
			vi
				.fn()
				.mockRejectedValue(
					new HttpError(404, "not-produced", "run an analysis first"),
				),
		);
		await expect(getIntentMap(api)).resolves.toBeNull();
	});

	it("still throws every other failure", async () => {
		const api = apiClient(
			vi
				.fn()
				.mockRejectedValue(new HttpError(503, "agent-missing", "no claude")),
		);
		await expect(getIntentMap(api)).rejects.toThrow(HttpError);
	});

	it("does not swallow a 404 that means something else", async () => {
		const api = apiClient(
			vi
				.fn()
				.mockRejectedValue(new HttpError(404, "not-found", "no such route")),
		);
		await expect(getIntentMap(api)).rejects.toThrow(HttpError);
	});
});

describe("getWalkthrough", () => {
	it("resolves to null before stage A has run, and to the steps after", async () => {
		const missing = apiClient(
			vi
				.fn()
				.mockRejectedValue(
					new HttpError(404, "not-produced", "run an analysis first"),
				),
		);
		await expect(getWalkthrough(missing)).resolves.toBeNull();

		const produced = apiClient(vi.fn().mockResolvedValue({ steps: [] }));
		await expect(getWalkthrough(produced)).resolves.toEqual({ steps: [] });
		expect(produced.get).toHaveBeenCalledWith("/api/walkthrough");
	});
});
