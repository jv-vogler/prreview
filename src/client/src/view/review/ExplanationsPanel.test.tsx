import type { ExplanationDto } from "@dto/ReviewDto";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ExplanationsPanel } from "./ExplanationsPanel";
import { HighlightedExplanationsContext } from "./highlightedExplanations";

function explanation(
	id: string,
	overrides: Partial<ExplanationDto> = {},
): ExplanationDto {
	return {
		id,
		path: "src/cache.ts",
		startLine: 12,
		endLine: 12,
		says: [
			"Reduces the TTL to 60s.",
			"The migration in `schema.sql` forces it.",
		],
		topic: "cache TTL",
		placement: { kind: "exact", fileId: "file-1", side: "new", line: 12 },
		...overrides,
	};
}

describe("ExplanationsPanel", () => {
	it("groups a topic's entries under one chip, with a jump per anchored change", () => {
		const onJumpTo = vi.fn();
		render(
			<ExplanationsPanel
				explanations={[
					explanation("explanation-0"),
					explanation("explanation-1", {
						path: "src/other.ts",
						startLine: 40,
					}),
				]}
				onJumpTo={onJumpTo}
				onToggleTopic={() => {}}
			/>,
		);
		expect(screen.getByRole("button", { name: "cache TTL" })).toBeDefined();
		fireEvent.click(screen.getByText("src/other.ts:40"));
		expect(onJumpTo).toHaveBeenCalledWith(
			expect.objectContaining({ id: "explanation-1" }),
		);
		expect(screen.getAllByText("schema.sql")[0].tagName).toBe("CODE");
	});

	it("presses the chip while its whole topic is highlighted, and toggles through it", () => {
		const onToggleTopic = vi.fn();
		render(
			<HighlightedExplanationsContext.Provider
				value={new Set(["explanation-0"])}
			>
				<ExplanationsPanel
					explanations={[explanation("explanation-0")]}
					onJumpTo={() => {}}
					onToggleTopic={onToggleTopic}
				/>
			</HighlightedExplanationsContext.Provider>,
		);
		const chip = screen.getByRole("button", { name: "cache TTL" });
		expect(chip.getAttribute("aria-pressed")).toBe("true");
		fireEvent.click(chip);
		expect(onToggleTopic).toHaveBeenCalledWith(
			expect.objectContaining({ label: "cache TTL" }),
		);
	});

	it("lists a standalone explanation under its path, and marks an unplaceable one instead of dropping it", () => {
		render(
			<ExplanationsPanel
				explanations={[
					explanation("explanation-0", {
						topic: undefined,
						path: "not/in/the/diff.ts",
						startLine: 7,
						placement: { kind: "unplaceable" },
					}),
				]}
				onJumpTo={() => {}}
				onToggleTopic={() => {}}
			/>,
		);
		expect(screen.getByText(/not\/in\/the\/diff\.ts:7/)).toBeDefined();
		expect(screen.getByText(/· not in the diff/)).toBeDefined();
		expect(screen.queryByRole("button")).toBeNull();
	});
});
