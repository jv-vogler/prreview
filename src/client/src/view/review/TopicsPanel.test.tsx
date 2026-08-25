import type { ExplanationDto } from "@dto/ReviewDto";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Topic } from "../../domain/review/topics";
import { HighlightedTopicContext } from "./highlightedTopic";
import { TopicsPanel } from "./TopicsPanel";

const EXPLANATION: ExplanationDto = {
	id: "explanation-0",
	path: "src/cache.ts",
	startLine: 12,
	endLine: 12,
	says: ["Reduces the TTL to 60s.", "The migration in `schema.sql` forces it."],
	topic: "cache TTL",
	placement: { kind: "exact", fileId: "file-1", side: "new", line: 12 },
};

const TOPIC: Topic = { label: "cache TTL", explanations: [EXPLANATION] };

describe("TopicsPanel", () => {
	it("renders nothing without topics", () => {
		const { container } = render(
			<TopicsPanel
				topics={[]}
				onJump={() => {}}
				onToggleHighlight={() => {}}
			/>,
		);
		expect(container.firstChild).toBeNull();
	});

	it("shows the label, the says lines, and a link to each anchored change", () => {
		render(
			<TopicsPanel
				topics={[TOPIC]}
				onJump={() => {}}
				onToggleHighlight={() => {}}
			/>,
		);
		expect(screen.getByText("cache TTL")).toBeDefined();
		expect(screen.getByText("src/cache.ts:12")).toBeDefined();
		expect(screen.getByText("schema.sql").tagName).toBe("CODE");
	});

	it("jumping goes through onJump; the label toggles the highlight", () => {
		const onJump = vi.fn();
		const onToggleHighlight = vi.fn();
		render(
			<HighlightedTopicContext.Provider value="cache TTL">
				<TopicsPanel
					topics={[TOPIC]}
					onJump={onJump}
					onToggleHighlight={onToggleHighlight}
				/>
			</HighlightedTopicContext.Provider>,
		);
		fireEvent.click(screen.getByText("src/cache.ts:12"));
		expect(onJump).toHaveBeenCalledWith(EXPLANATION);

		const label = screen.getByRole("button", { name: "cache TTL" });
		expect(label.getAttribute("aria-pressed")).toBe("true");
		fireEvent.click(label);
		expect(onToggleHighlight).toHaveBeenCalledWith("cache TTL");
	});
});
