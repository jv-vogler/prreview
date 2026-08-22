import type { CommentAnchorSideDto, ReviewCommentDto } from "@dto/ReviewDto";

/**
 * Where one comment's gutter marker goes on the rendered diff — every
 * comment whose placement is `exact` or `clamped` gets one; `unplaceable`
 * comments never appear here, only in the sidebar (REQ-010).
 */
export interface PlacedComment {
	fileId: string;
	side: CommentAnchorSideDto;
	line: number;
	commentId: string;
}

export function placedComments(
	comments: readonly ReviewCommentDto[],
): PlacedComment[] {
	const placed: PlacedComment[] = [];
	for (const comment of comments) {
		if (comment.placement.kind === "unplaceable") {
			continue;
		}
		placed.push({
			fileId: comment.placement.fileId,
			side: comment.placement.side,
			line: comment.placement.line,
			commentId: comment.id,
		});
	}
	return placed;
}

/** One rendered diff line can carry more than one comment; they share a marker. */
export interface AnnotationGroup {
	fileId: string;
	side: CommentAnchorSideDto;
	line: number;
	commentIds: string[];
}

export function groupPlacedComments(
	placed: readonly PlacedComment[],
): AnnotationGroup[] {
	const groups = new Map<string, AnnotationGroup>();
	for (const item of placed) {
		const key = `${item.fileId}:${item.side}:${item.line}`;
		const existing = groups.get(key);
		if (existing === undefined) {
			groups.set(key, {
				fileId: item.fileId,
				side: item.side,
				line: item.line,
				commentIds: [item.commentId],
			});
		} else {
			existing.commentIds.push(item.commentId);
		}
	}
	return [...groups.values()];
}
