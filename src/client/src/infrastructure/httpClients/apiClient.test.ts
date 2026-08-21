import { describe, expect, it } from "vitest";
import { createApiClient } from "./apiClient";
import { HttpError } from "./HttpError";

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

describe("createApiClient", () => {
	it("returns the parsed body of a 2xx", async () => {
		const api = createApiClient(async () => jsonResponse({ ok: true }));

		await expect(api.get("/api/session")).resolves.toEqual({ ok: true });
	});

	it("throws the server's reason and message for a non-2xx", async () => {
		const api = createApiClient(async () =>
			jsonResponse({ reason: "not-a-repo", message: "nope" }, 400),
		);

		await expect(api.get("/api/session")).rejects.toMatchObject({
			status: 400,
			reason: "not-a-repo",
			message: "nope",
		});
	});

	// the failure that used to escape as a bare TypeError, leaving a suspending
	// query to hang instead of reaching an error boundary
	it("turns a request that never got an answer into an unreachable HttpError", async () => {
		const cause = new TypeError("Failed to fetch");
		const api = createApiClient(async () => {
			throw cause;
		});

		const error = await api
			.get("/api/session")
			.catch((thrown: unknown) => thrown);

		expect(error).toBeInstanceOf(HttpError);
		expect(error).toMatchObject({
			status: 0,
			reason: "unreachable",
			message: expect.stringContaining("/api/session"),
			cause,
		});
	});
});
