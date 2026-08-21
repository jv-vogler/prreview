import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ReviewPage } from "./ReviewPage";

describe("ReviewPage", () => {
	it("shows a loading state while the changeset is being fetched", () => {
		render(<ReviewPage />);
		expect(screen.getByText("Loading review…")).toBeTruthy();
	});
});
