import type { ExplanationDto } from "@dto/ReviewDto";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
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

	it("omits the topic chip when the explanation stands alone", () => {
		const { topic, ...rest } = EXPLANATION;
		void topic;
		render(<ExplanationBalloon explanation={rest} />);
		expect(screen.queryByText("cache TTL")).toBeNull();
	});
});
