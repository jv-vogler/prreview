import type { ReviewPassDto } from "@dto/ReviewDto";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OverviewPanel } from "./OverviewPanel";

const NO_TOPICS: ReadonlyMap<string, number> = new Map();

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
				folded={false}
				onToggleFold={() => {}}
				topicColors={NO_TOPICS}
				onToggleTopic={() => {}}
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
				folded={false}
				onToggleFold={() => {}}
				topicColors={NO_TOPICS}
				onToggleTopic={() => {}}
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
			<OverviewPanel
				folded={false}
				onToggleFold={() => {}}
				topicColors={NO_TOPICS}
				onToggleTopic={() => {}}
				pass={pass({ overview: "All one line, no breaks." })}
			/>,
		);
		expect(screen.getByText("All one line, no breaks.")).toBeTruthy();
	});

	it("shows the verdict, and the ticket line only when there is one", () => {
		const { rerender } = render(
			<OverviewPanel
				folded={false}
				onToggleFold={() => {}}
				topicColors={NO_TOPICS}
				onToggleTopic={() => {}}
				pass={pass()}
			/>,
		);
		expect(screen.getByText("Matches the ticket.")).toBeTruthy();
		expect(screen.queryByText("PROJ-1")).toBeNull();

		rerender(
			<OverviewPanel
				folded={false}
				onToggleFold={() => {}}
				topicColors={NO_TOPICS}
				onToggleTopic={() => {}}
				pass={pass({ ticket: "PROJ-1" })}
			/>,
		);
		expect(screen.getByText("PROJ-1")).toBeTruthy();
	});

	it("sets the verdict under the overview, colored by the scope outcome", () => {
		const { container, rerender } = render(
			<OverviewPanel
				folded={false}
				onToggleFold={() => {}}
				topicColors={NO_TOPICS}
				onToggleTopic={() => {}}
				pass={pass({ scope: "matches" })}
			/>,
		);
		const verdict = () =>
			container.querySelector("[data-scope]") as HTMLElement;
		expect(verdict().dataset.scope).toBe("matches");
		// below the overview: the verdict row is the panel's last block
		expect(verdict().closest("div")?.previousElementSibling).not.toBeNull();

		rerender(
			<OverviewPanel
				folded={false}
				onToggleFold={() => {}}
				topicColors={NO_TOPICS}
				onToggleTopic={() => {}}
				pass={pass({ scope: "misses-pieces" })}
			/>,
		);
		expect(verdict().dataset.scope).toBe("misses-pieces");

		rerender(
			<OverviewPanel
				folded={false}
				onToggleFold={() => {}}
				topicColors={NO_TOPICS}
				onToggleTopic={() => {}}
				pass={pass()}
			/>,
		);
		expect(verdict().dataset.scope).toBe("neutral");
	});

	it("folded, keeps only the verdict line, colored by scope", () => {
		const onToggleFold = vi.fn();
		render(
			<OverviewPanel
				folded={true}
				onToggleFold={onToggleFold}
				topicColors={NO_TOPICS}
				onToggleTopic={() => {}}
				pass={pass({ overview: "The long account.", scope: "matches" })}
			/>,
		);
		expect(screen.queryByText("The long account.")).toBeNull();
		const verdict = screen.getByText("Matches the ticket.");
		expect(verdict.getAttribute("data-scope")).toBe("matches");

		fireEvent.click(screen.getByRole("button", { name: /Overview/ }));
		expect(onToggleFold).toHaveBeenCalledTimes(1);
	});

	it("renders a topic mention as its clickable colored chip, but never inside code", () => {
		const onToggleTopic = vi.fn();
		render(
			<OverviewPanel
				folded={false}
				onToggleFold={() => {}}
				topicColors={new Map([["renderer cache", 2]])}
				onToggleTopic={onToggleTopic}
				pass={pass({
					overview:
						"The renderer cache moves once. The `renderer cache` token stays code.",
				})}
			/>,
		);
		const chip = screen.getByRole("button", { name: "renderer cache" });
		expect(chip.getAttribute("data-topic-color")).toBe("2");
		fireEvent.click(chip);
		expect(onToggleTopic).toHaveBeenCalledWith("renderer cache");
		expect(
			screen.getByText("renderer cache", { selector: "code" }),
		).toBeDefined();
	});

	it("escapes HTML in the overview rather than rendering it", () => {
		const { container } = render(
			<OverviewPanel
				folded={false}
				onToggleFold={() => {}}
				topicColors={NO_TOPICS}
				onToggleTopic={() => {}}
				pass={pass({ overview: "<img src=x onerror=alert(1)>" })}
			/>,
		);
		expect(container.querySelector("img")).toBeNull();
	});
});
