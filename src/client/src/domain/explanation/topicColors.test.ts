import { describe, expect, it } from "vitest";
import { TOPIC_COLOR_COUNT, topicColorsFor } from "./topicColors";

describe("topicColorsFor", () => {
	it("assigns one stable slot per label, in first-mention order", () => {
		const colors = topicColorsFor([
			{ topic: "renderer cache" },
			{ topic: "old passes still load" },
			{ topic: "renderer cache" },
			{},
		]);
		expect(colors.get("renderer cache")).toBe(0);
		expect(colors.get("old passes still load")).toBe(1);
		expect(colors.size).toBe(2);
	});

	it("wraps around once the palette runs out", () => {
		const labels = Array.from(
			{ length: TOPIC_COLOR_COUNT + 1 },
			(_, index) => ({ topic: `topic ${index}` }),
		);
		const colors = topicColorsFor(labels);
		expect(colors.get(`topic ${TOPIC_COLOR_COUNT}`)).toBe(0);
	});
});
