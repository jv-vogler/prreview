import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useFileFolding } from "./useFileFolding";

const PLACEMENT = {
	kind: "exact",
	fileId: "file-1",
	side: "new",
	line: 4,
} as const;

describe("marking a file viewed", () => {
	it("folds it, and unfolding again leaves it viewed", () => {
		const { result } = renderHook(() => useFileFolding());

		act(() => result.current.toggleViewed("file-1"));
		expect(result.current.viewedFileIds.has("file-1")).toBe(true);
		expect(result.current.foldedFileIds.has("file-1")).toBe(true);

		act(() => result.current.toggleFold("file-1"));
		expect(result.current.foldedFileIds.has("file-1")).toBe(false);
		expect(result.current.viewedFileIds.has("file-1")).toBe(true);
	});

	it("unfolds it again when it stops being viewed", () => {
		const { result } = renderHook(() => useFileFolding());

		act(() => result.current.toggleViewed("file-1"));
		act(() => result.current.toggleViewed("file-1"));

		expect(result.current.viewedFileIds.has("file-1")).toBe(false);
		expect(result.current.foldedFileIds.has("file-1")).toBe(false);
	});

	it("leaves a file the reader had already folded folded", () => {
		const { result } = renderHook(() => useFileFolding());

		act(() => result.current.toggleFold("file-1"));
		act(() => result.current.toggleViewed("file-1"));

		expect(result.current.foldedFileIds.has("file-1")).toBe(true);
	});
});

describe("revealing a placement", () => {
	it("scrolls straight away when its file is already open", () => {
		const { result } = renderHook(() => useFileFolding());
		const scroll = vi.fn();

		act(() => result.current.revealPlacement(PLACEMENT, scroll));

		expect(scroll).toHaveBeenCalledOnce();
	});

	it("unfolds its file first and scrolls once the diff is back", async () => {
		const { result } = renderHook(() => useFileFolding());
		const scroll = vi.fn();

		act(() => result.current.toggleFold("file-1"));
		act(() => result.current.revealPlacement(PLACEMENT, scroll));

		expect(result.current.foldedFileIds.has("file-1")).toBe(false);
		expect(scroll).not.toHaveBeenCalled();

		await act(() => nextFrame());
		expect(scroll).toHaveBeenCalledOnce();
	});

	it("does nothing for a placement the diff cannot anchor", () => {
		const { result } = renderHook(() => useFileFolding());
		const scroll = vi.fn();

		act(() => result.current.revealPlacement({ kind: "unplaceable" }, scroll));

		expect(scroll).not.toHaveBeenCalled();
	});
});

function nextFrame(): Promise<void> {
	return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
