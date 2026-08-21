import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ReviewPage } from "./ReviewPage";

describe("ReviewPage", () => {
	it("renders", () => {
		render(<ReviewPage />);
		expect(screen.getByText("prreview")).toBeTruthy();
	});
});
