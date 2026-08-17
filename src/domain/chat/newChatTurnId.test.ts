import { describe, expect, it } from "vitest";
import { newChatTurnId } from "./newChatTurnId";

const ULID_SHAPE = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const SAMPLE_SIZE = 200;

describe("newChatTurnId", () => {
	it("produces a 26-character Crockford base32 ulid", () => {
		expect(newChatTurnId()).toMatch(ULID_SHAPE);
	});

	it("produces unique ids, so two turns can never share a stream", () => {
		const ids = new Set(
			Array.from({ length: SAMPLE_SIZE }, () => newChatTurnId()),
		);
		expect(ids.size).toBe(SAMPLE_SIZE);
	});
});
