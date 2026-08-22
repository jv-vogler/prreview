import type { ReviewCommentDto } from "@dto/ReviewDto";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CommentActions } from "./CommentActions";
import { CommentBalloon } from "./CommentBalloon";

const COMMENT: ReviewCommentDto = {
	id: "finding-0",
	path: "src/greeting.ts",
	startLine: 1,
	endLine: 1,
	tier: "nitpick",
	title: "a nit",
	body: "original body",
	proof: "Inferred: x",
	verified: false,
	lane: "review",
	placement: { kind: "unplaceable" },
	edited: false,
};

function actions(overrides: Partial<CommentActions> = {}): CommentActions {
	return {
		onEdit: vi.fn(),
		onDelete: vi.fn(),
		reworkProposal: null,
		onAcceptRework: vi.fn(),
		onDismissRework: vi.fn(),
		...overrides,
	};
}

describe("CommentBalloon", () => {
	beforeEach(() => {
		vi.spyOn(window, "confirm").mockReturnValue(true);
	});

	it("commits an edit on blur (TASK-047)", () => {
		const onEdit = vi.fn();
		render(
			<CommentBalloon
				comment={COMMENT}
				onCollapse={() => {}}
				actions={actions({ onEdit })}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: /edit comment/i }));
		const textarea = screen.getByRole("textbox");
		fireEvent.change(textarea, { target: { value: "reworded body" } });
		fireEvent.blur(textarea);

		expect(onEdit).toHaveBeenCalledWith("finding-0", "reworded body");
	});

	it("does not call onEdit when the body did not change", () => {
		const onEdit = vi.fn();
		render(
			<CommentBalloon
				comment={COMMENT}
				onCollapse={() => {}}
				actions={actions({ onEdit })}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: /edit comment/i }));
		fireEvent.blur(screen.getByRole("textbox"));

		expect(onEdit).not.toHaveBeenCalled();
	});

	it("deletes only after the reader confirms", () => {
		const onDelete = vi.fn();
		render(
			<CommentBalloon
				comment={COMMENT}
				onCollapse={() => {}}
				actions={actions({ onDelete })}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: /delete comment/i }));
		expect(onDelete).toHaveBeenCalledWith("finding-0");
	});

	it("skips the delete when the reader cancels the confirm", () => {
		vi.spyOn(window, "confirm").mockReturnValue(false);
		const onDelete = vi.fn();
		render(
			<CommentBalloon
				comment={COMMENT}
				onCollapse={() => {}}
				actions={actions({ onDelete })}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: /delete comment/i }));
		expect(onDelete).not.toHaveBeenCalled();
	});

	it("hides the rework control entirely when no agent is available (REQ-009)", () => {
		render(
			<CommentBalloon
				comment={COMMENT}
				onCollapse={() => {}}
				actions={actions()}
			/>,
		);
		expect(screen.queryByText("Shorter")).toBeNull();
	});

	it("starts a rework with the clicked instruction", () => {
		const onRework = vi.fn();
		render(
			<CommentBalloon
				comment={COMMENT}
				onCollapse={() => {}}
				actions={actions({ onRework })}
			/>,
		);
		fireEvent.click(screen.getByText("Shorter"));
		expect(onRework).toHaveBeenCalledWith("finding-0", "concise");
	});

	it("shows a proposal and forwards accept with its body", () => {
		const onAcceptRework = vi.fn();
		render(
			<CommentBalloon
				comment={COMMENT}
				onCollapse={() => {}}
				actions={actions({
					onRework: vi.fn(),
					onAcceptRework,
					reworkProposal: {
						commentId: "finding-0",
						status: "succeeded",
						proposedBody: "shorter body",
					},
				})}
			/>,
		);
		expect(screen.getByText("shorter body")).toBeTruthy();
		fireEvent.click(screen.getByText("Use this"));
		expect(onAcceptRework).toHaveBeenCalledWith("finding-0", "shorter body");
	});
});
