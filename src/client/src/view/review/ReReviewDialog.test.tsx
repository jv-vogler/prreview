import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ReReviewDialog } from "./ReReviewDialog";

function renderDialog(
	overrides: Partial<Parameters<typeof ReReviewDialog>[0]> = {},
) {
	const onConfirm = vi.fn();
	const onCancel = vi.fn();
	render(
		<ReReviewDialog
			freshness={null}
			worktree={false}
			editedCount={0}
			dismissedCount={0}
			pendingReviewUrl={null}
			onConfirm={onConfirm}
			onCancel={onCancel}
			{...overrides}
		/>,
	);
	return { onConfirm, onCancel };
}

describe("ReReviewDialog", () => {
	it("states the same-commit fact", () => {
		renderDialog({ freshness: { kind: "same-commit" } });
		expect(
			screen.getByText(
				"This change was already reviewed at this exact commit.",
			),
		).toBeTruthy();
	});

	it("counts the commits the change moved by", () => {
		renderDialog({ freshness: { kind: "new-commits", count: 3 } });
		expect(
			screen.getByText(/3 new commits since the last review/),
		).toBeTruthy();
	});

	it("claims nothing it cannot know about a worktree", () => {
		renderDialog({ freshness: { kind: "unknown" }, worktree: true });
		expect(
			screen.getByText(/This working tree was already reviewed/),
		).toBeTruthy();
	});

	it("mentions curation and the pending review only when they exist", () => {
		renderDialog({
			editedCount: 2,
			dismissedCount: 1,
			pendingReviewUrl: "https://example.com/pr/1#r1",
		});
		expect(
			screen.getByText(/2 edited comments, 1 dismissed comment/),
		).toBeTruthy();
		expect(
			screen
				.getByRole("link", { name: "pending review on GitHub" })
				.getAttribute("href"),
		).toBe("https://example.com/pr/1#r1");
	});

	it("omits the loss lines when there is nothing to lose", () => {
		renderDialog();
		expect(screen.queryByText(/curation/)).toBeNull();
		expect(screen.queryByRole("link")).toBeNull();
	});

	it("confirms and cancels through its buttons, and cancels on Escape", () => {
		const { onConfirm, onCancel } = renderDialog();
		fireEvent.click(screen.getByRole("button", { name: "Run new review" }));
		expect(onConfirm).toHaveBeenCalledOnce();
		fireEvent.click(
			screen.getByRole("button", { name: "Keep the current review" }),
		);
		expect(onCancel).toHaveBeenCalledOnce();
		fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
		expect(onCancel).toHaveBeenCalledTimes(2);
	});

	it("focuses the safe choice first", () => {
		renderDialog();
		expect(document.activeElement).toBe(
			screen.getByRole("button", { name: "Keep the current review" }),
		);
	});
});
