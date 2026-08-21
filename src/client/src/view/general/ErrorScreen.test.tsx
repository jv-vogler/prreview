// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { HttpError } from "../../infrastructure/httpClients/HttpError";
import { ErrorScreen } from "./ErrorScreen";

afterEach(cleanup);

function renderThrowing(error: unknown) {
	const router = createMemoryRouter([
		{
			errorElement: <ErrorScreen />,
			children: [
				{
					path: "/",
					element: null,
					loader: () => {
						throw error;
					},
				},
			],
		},
	]);
	return render(<RouterProvider router={router} />);
}

async function shown(): Promise<HTMLElement> {
	return await screen.findByRole("alert");
}

describe("ErrorScreen", () => {
	it("names the missing server, and what to run, when nothing answered", async () => {
		renderThrowing(
			new HttpError(0, "unreachable", "Could not reach the prreview server."),
		);

		const alert = await shown();
		expect(alert.textContent).toContain("not answering");
		expect(alert.textContent).toContain("prreview");
		expect(alert.textContent).toContain("reload");
	});

	it("says the same for a gateway status, which is the dev proxy's version of it", async () => {
		renderThrowing(new HttpError(503, "unreachable", "No server."));

		expect((await shown()).textContent).toContain("not answering");
	});

	it("shows the real message for a failure that is not a missing server", async () => {
		renderThrowing(new HttpError(500, "internal", "the changeset exploded"));

		const alert = await shown();
		expect(alert.textContent).toContain("could not be loaded");
		expect(alert.textContent).toContain("the changeset exploded");
	});
});
