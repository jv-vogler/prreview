import type { ExplanationDto } from "@dto/ReviewDto";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ExplanationBalloon } from "./ExplanationBalloon";

const EXPLANATION: ExplanationDto = {
	id: "explanation-0",
	path: "src/cache.ts",
	startLine: 3,
	endLine: 3,
	says: [
		"Reduces the TTL to 60s.",
		"The migration in `schema.sql` invalidates entries faster than the old TTL allowed.",
	],
	topic: "cache TTL",
	placement: { kind: "exact", fileId: "file-1", side: "new", line: 3 },
};

describe("ExplanationBalloon", () => {
	it("renders one paragraph per says sentence, with inline code from backticks", () => {
		render(<ExplanationBalloon explanation={EXPLANATION} />);
		expect(screen.getByText("Reduces the TTL to 60s.").tagName).toBe("P");
		expect(screen.getByText("schema.sql").tagName).toBe("CODE");
	});

	it("shows the topic chip and carries no action buttons", () => {
		render(<ExplanationBalloon explanation={EXPLANATION} />);
		expect(screen.getByText("cache TTL")).toBeDefined();
		expect(screen.queryByRole("button")).toBeNull();
	});

	it("says so when it sits beside a line it is not about", () => {
		render(
			<ExplanationBalloon
				explanation={{
					...EXPLANATION,
					startLine: 42,
					endLine: 42,
					placement: {
						kind: "clamped",
						fileId: "file-1",
						side: "new",
						line: 3,
						requestedStartLine: 42,
						requestedEndLine: 42,
					},
				}}
			/>,
		);
		expect(screen.getByText(/Written about line 42/).textContent).toContain(
			"pinned to the nearest line",
		);
	});

	it("omits the topic chip when the explanation stands alone", () => {
		const { topic, ...rest } = EXPLANATION;
		void topic;
		render(<ExplanationBalloon explanation={rest} />);
		expect(screen.queryByText("cache TTL")).toBeNull();
	});

	it("offers a dismiss button that calls onDismiss when given one", () => {
		const onDismiss = vi.fn();
		render(
			<ExplanationBalloon explanation={EXPLANATION} onDismiss={onDismiss} />,
		);
		fireEvent.click(
			screen.getByRole("button", { name: "Hide change explanation" }),
		);
		expect(onDismiss).toHaveBeenCalledOnce();
	});
});
