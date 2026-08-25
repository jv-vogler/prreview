import type { ReviewCommentDto } from "@dto/ReviewDto";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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
	deleted: false,
	published: false,
};

function actions(overrides: Partial<CommentActions> = {}): CommentActions {
	return {
		onEdit: vi.fn(),
		onDelete: vi.fn(),
		onRestore: vi.fn(),
		reworkProposal: null,
		onAcceptRework: vi.fn(),
		onDismissRework: vi.fn(),
		...overrides,
	};
}

describe("CommentBalloon", () => {
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

	it("calls onDelete when the delete button is clicked", () => {
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

	it("shows a restore button instead of edit/delete once dismissed", () => {
		const onRestore = vi.fn();
		render(
			<CommentBalloon
				comment={{ ...COMMENT, deleted: true }}
				onCollapse={() => {}}
				actions={actions({ onRestore })}
			/>,
		);
		expect(screen.queryByRole("button", { name: /edit comment/i })).toBeNull();
		expect(
			screen.queryByRole("button", { name: /delete comment/i }),
		).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: /restore comment/i }));
		expect(onRestore).toHaveBeenCalledWith("finding-0");
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
