import type { ExplanationDto } from "@dto/ReviewDto";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DiffExplanationAnnotation } from "./DiffExplanationAnnotation";

function explanation(id: string): ExplanationDto {
	return {
		id,
		path: "src/a.ts",
		startLine: 2,
		endLine: 2,
		says: [`The account behind ${id}.`],
		placement: { kind: "exact", fileId: "file-1", side: "new", line: 2 },
	};
}

describe("DiffExplanationAnnotation", () => {
	it("renders nothing at all for a line without explanations", () => {
		const { container } = render(
			<DiffExplanationAnnotation
				topicColors={new Map()}
				explanations={[]}
				mode="chips"
			/>,
		);
		expect(container.firstChild).toBeNull();
	});

	it("chips mode starts unfolded; the chip folds the cards and back", () => {
		render(
			<DiffExplanationAnnotation
				topicColors={new Map()}
				explanations={[explanation("explanation-0")]}
				mode="chips"
			/>,
		);
		const chip = screen.getByRole("button", {
			name: "Fold change explanation",
		});
		expect(document.querySelector("[data-explanation-id]")).not.toBeNull();
		fireEvent.click(chip);
		expect(chip.getAttribute("aria-expanded")).toBe("false");
		expect(document.querySelector("[data-closing='true']")).not.toBeNull();
		fireEvent.click(chip);
		expect(chip.getAttribute("aria-expanded")).toBe("true");
		expect(document.querySelector("[data-closing]")).toBeNull();
		expect(document.querySelector("[data-explanation-id]")).not.toBeNull();
	});

	it("chips mode counts the explanations sharing the line on the chip", () => {
		render(
			<DiffExplanationAnnotation
				topicColors={new Map()}
				explanations={[
					explanation("explanation-0"),
					explanation("explanation-1"),
				]}
				mode="chips"
			/>,
		);
		expect(screen.getByText("2")).toBeDefined();
	});

	it("margin mode keeps the cards open and offers no chip", () => {
		render(
			<DiffExplanationAnnotation
				topicColors={new Map()}
				explanations={[explanation("explanation-0")]}
				mode="margin"
			/>,
		);
		expect(document.querySelector("[data-explanation-id]")).not.toBeNull();
		expect(screen.queryByRole("button")).toBeNull();
	});
});
