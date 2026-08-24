import type { ReviewPassDto } from "@dto/ReviewDto";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OverviewPanel } from "./OverviewPanel";

function pass(overrides: Partial<ReviewPassDto> = {}): ReviewPassDto {
	return {
		overview: "One short overview.",
		verdict: "Matches the ticket.",
		ticket: null,
		comments: [],
		explanations: [],
		residue: [],
		published: null,
		...overrides,
	};
}

describe("OverviewPanel", () => {
	it("renders each blank-line-separated paragraph as its own block", () => {
		const { container } = render(
			<OverviewPanel
				pass={pass({ overview: "First paragraph.\n\nSecond paragraph." })}
			/>,
		);
		const paragraphs = [...container.querySelectorAll("p")].map(
			(node) => node.textContent,
		);
		expect(paragraphs).toContain("First paragraph.");
		expect(paragraphs).toContain("Second paragraph.");
	});

	it("renders a backticked name as code rather than literal backticks", () => {
		const { container } = render(
			<OverviewPanel
				pass={pass({ overview: "It now tracks `.impeccable/config.json`." })}
			/>,
		);
		expect(container.querySelector("code")?.textContent).toBe(
			".impeccable/config.json",
		);
		expect(container.textContent).not.toContain("`");
	});

	it("still renders an overview written as one unbroken line", () => {
		render(
			<OverviewPanel pass={pass({ overview: "All one line, no breaks." })} />,
		);
		expect(screen.getByText("All one line, no breaks.")).toBeTruthy();
	});

	it("shows the verdict, and the ticket line only when there is one", () => {
		const { rerender } = render(<OverviewPanel pass={pass()} />);
		expect(screen.getByText("Matches the ticket.")).toBeTruthy();
		expect(screen.queryByText("PROJ-1")).toBeNull();

		rerender(<OverviewPanel pass={pass({ ticket: "PROJ-1" })} />);
		expect(screen.getByText("PROJ-1")).toBeTruthy();
	});

	it("escapes HTML in the overview rather than rendering it", () => {
		const { container } = render(
			<OverviewPanel
				pass={pass({ overview: "<img src=x onerror=alert(1)>" })}
			/>,
		);
		expect(container.querySelector("img")).toBeNull();
	});
});
