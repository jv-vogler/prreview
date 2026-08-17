// @vitest-environment jsdom
import { act, cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	renderWithProviders,
	sessionDto,
} from "../testing/renderWithProviders";
import { ViewerOnlyNotice } from "./ViewerOnlyNotice";

afterEach(cleanup);
beforeEach(() => window.localStorage.clear());

function renderNotice(agent: "claude" | "none") {
	return renderWithProviders(<ViewerOnlyNotice />, {
		responses: { "/api/session": sessionDto(agent) },
	});
}

async function settled(): Promise<void> {
	await waitFor(() => expect(screen.queryByText("loading")).toBeNull());
}

describe("ViewerOnlyNotice", () => {
	it("explains the viewer floor when no agent was found", async () => {
		renderNotice("none");
		await settled();

		const notice = screen.getByRole("status");
		expect(notice.textContent).toContain("Viewer only");
		// what still works, and what to do about what does not
		expect(notice.textContent).toContain("coverage");
		expect(notice.textContent).toContain("claude");
		expect(notice.textContent).toContain("start prreview again");
	});

	it("says nothing at all when an agent is present", async () => {
		renderNotice("claude");
		await settled();

		expect(screen.queryByRole("status")).toBeNull();
	});

	it("stays dismissed across a remount", async () => {
		const first = renderNotice("none");
		await settled();

		act(() => {
			screen
				.getByRole("button", { name: "Dismiss the viewer-only notice" })
				.click();
		});
		expect(screen.queryByRole("status")).toBeNull();
		first.unmount();

		renderNotice("none");
		await settled();
		expect(screen.queryByRole("status")).toBeNull();
	});
});
