import { describe, expect, it } from "vitest";
import { newAnnotationId } from "./newAnnotationId";

const ULID_SHAPE = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const SAMPLE_SIZE = 200;

describe("newAnnotationId", () => {
	it("produces a 26-character Crockford base32 ulid", () => {
		expect(newAnnotationId()).toMatch(ULID_SHAPE);
	});

	it("produces unique ids", () => {
		const ids = new Set(
			Array.from({ length: SAMPLE_SIZE }, () => newAnnotationId()),
		);
		expect(ids.size).toBe(SAMPLE_SIZE);
	});
});
