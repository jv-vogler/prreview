// @vitest-environment jsdom
import type { SessionDto } from "@dto/SessionDto";
import { cleanup, screen } from "@testing-library/react";
import { Route, Routes } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import {
	renderWithProviders,
	sessionDto,
} from "../view/testing/renderWithProviders";
import { RootPage } from "./RootPage";

afterEach(cleanup);

function renderGate(session: SessionDto) {
	return renderWithProviders(
		<Routes>
			<Route path="/" element={<RootPage />} />
			<Route path="/orient" element={<p>orient page</p>} />
			<Route path="/diff" element={<p>diff page</p>} />
		</Routes>,
		{ responses: { "/api/session": session }, initialPath: "/" },
	);
}

function session(
	intentMapAvailable: boolean,
	coverageTotal: number,
): SessionDto {
	const base = sessionDto("claude");
	return {
		...base,
		coverage: { total: coverageTotal, byFile: {} },
		analysis: { ...base.analysis, intentMapAvailable },
	};
}

describe("RootPage gate", () => {
	it("lands on the orientation when a map exists and nothing has been read", async () => {
		renderGate(session(true, 0));

		expect(await screen.findByText("orient page")).toBeDefined();
	});

	it("lands on the diff when the review is already under way", async () => {
		renderGate(session(true, 30));

		expect(await screen.findByText("diff page")).toBeDefined();
	});

	it("lands on the diff when no analysis has produced a map", async () => {
		renderGate(session(false, 0));

		expect(await screen.findByText("diff page")).toBeDefined();
	});

	it("lands on the diff with neither a map nor a fresh start", async () => {
		renderGate(session(false, 55));

		expect(await screen.findByText("diff page")).toBeDefined();
	});
});
