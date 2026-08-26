import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useElapsedSince } from "./useElapsedSince";

describe("useElapsedSince", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("keeps ticking even when the server's clock is ahead of the client's", () => {
		const now = Date.now();
		vi.setSystemTime(now);

		const startedInTheFuture = new Date(now + 5_000).toISOString();

		const { result } = renderHook(() => useElapsedSince(startedInTheFuture));
		expect(result.current).toBe(0);

		act(() => {
			vi.advanceTimersByTime(3_000);
		});

		expect(result.current).toBeGreaterThanOrEqual(3_000);
	});

	it("returns null once the run stops", () => {
		const { result, rerender } = renderHook<
			number | null,
			{ instant: string | null }
		>(({ instant }) => useElapsedSince(instant), {
			initialProps: { instant: new Date().toISOString() },
		});
		expect(result.current).not.toBeNull();
		rerender({ instant: null });
		expect(result.current).toBeNull();
	});
});
