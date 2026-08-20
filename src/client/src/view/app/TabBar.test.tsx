// @vitest-environment jsdom
import { cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
	type AgentKind,
	renderWithProviders,
	sessionDto,
} from "../testing/renderWithProviders";
import { TabBar } from "./TabBar";

afterEach(cleanup);

function renderTabs(agent: AgentKind) {
	return renderWithProviders(<TabBar />, {
		responses: { "/api/session": sessionDto(agent) },
	});
}

async function settled(): Promise<void> {
	await waitFor(() => expect(screen.queryByText("loading")).toBeNull());
}

describe("TabBar", () => {
	/**
	 * Suggested comments was pulled from the bar for a release, and the route it
	 * points at stayed reachable by URL only — which is a surface nobody finds.
	 * This is the assertion that it is findable again.
	 */
	it("offers all three surfaces when an agent is installed", async () => {
		renderTabs("claude");
		await settled();

		expect(
			[...document.querySelectorAll("[data-tab]")].map((tab) =>
				tab.getAttribute("data-tab"),
			),
		).toEqual(["understand", "diff", "comments"]);
	});

	/**
	 * Absence, not disablement: a disabled control says "you could have this",
	 * and with no agent that is not true (REQ-004, F12).
	 */
	it("leaves the AI surfaces out entirely with no agent", async () => {
		renderTabs("none");
		await settled();

		expect(
			[...document.querySelectorAll("[data-tab]")].map((tab) =>
				tab.getAttribute("data-tab"),
			),
		).toEqual(["diff"]);
		expect(screen.queryByText("Suggested comments")).toBeNull();
	});
});
