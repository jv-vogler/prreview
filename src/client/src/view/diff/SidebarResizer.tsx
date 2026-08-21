import { useCallback, useRef, useState } from "react";
import styles from "./SidebarResizer.module.css";
import {
	clampSidebarWidth,
	SIDEBAR_WIDTH_MAX,
	SIDEBAR_WIDTH_MIN,
} from "./useSidebarWidth";

/**
 * The grab handle between the file panel and the diff.
 *
 * It is a `separator` with an `aria-valuenow`, not a decorative strip,
 * because a pointer-only resize is a resize half the people using the app
 * cannot do. The arrow keys move it in useful steps and Home/End take it to
 * the stops.
 */

export interface SidebarResizerProps {
	width: number;
	onWidth(width: number): void;
}

/** one arrow press; big enough to be worth pressing, small enough to aim with */
const KEY_STEP = 16;

export function SidebarResizer({ width, onWidth }: SidebarResizerProps) {
	const [dragging, setDragging] = useState(false);
	const originRef = useRef<{ x: number; width: number } | null>(null);

	const onPointerDown = useCallback(
		(event: React.PointerEvent<HTMLHRElement>) => {
			if (event.button !== 0) {
				return;
			}
			// capture, so a fast drag that outruns the handle keeps resizing
			// instead of being dropped over the diff
			event.currentTarget.setPointerCapture(event.pointerId);
			originRef.current = { x: event.clientX, width };
			setDragging(true);
		},
		[width],
	);

	const onPointerMove = useCallback(
		(event: React.PointerEvent<HTMLHRElement>) => {
			const origin = originRef.current;
			if (origin === null) {
				return;
			}
			// measured against where the drag started rather than against the
			// pointer's absolute position, so the handle never jumps to sit
			// under the cursor on the first move
			onWidth(origin.width + (event.clientX - origin.x));
		},
		[onWidth],
	);

	const onPointerUp = useCallback(
		(event: React.PointerEvent<HTMLHRElement>) => {
			event.currentTarget.releasePointerCapture(event.pointerId);
			originRef.current = null;
			setDragging(false);
		},
		[],
	);

	const onKeyDown = useCallback(
		(event: React.KeyboardEvent<HTMLHRElement>) => {
			const next = keyedWidth(event.key, width);
			if (next === null) {
				return;
			}
			event.preventDefault();
			onWidth(next);
		},
		[width, onWidth],
	);

	return (
		// an `hr`, which already means "separator", rather than a div wearing
		// the role. It is focusable here, which is what lets it carry a value
		// and be moved from the keyboard.
		<hr
			aria-orientation="vertical"
			aria-label="Resize the file panel"
			aria-valuenow={Math.round(width)}
			aria-valuemin={SIDEBAR_WIDTH_MIN}
			aria-valuemax={SIDEBAR_WIDTH_MAX}
			tabIndex={0}
			className={styles.resizer}
			data-dragging={dragging ? "true" : undefined}
			data-sidebar-resizer
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
			onPointerCancel={onPointerUp}
			onKeyDown={onKeyDown}
			onDoubleClick={() => onWidth(SIDEBAR_WIDTH_MIN)}
		/>
	);
}

function keyedWidth(key: string, width: number): number | null {
	switch (key) {
		case "ArrowLeft":
			return clampSidebarWidth(width - KEY_STEP);
		case "ArrowRight":
			return clampSidebarWidth(width + KEY_STEP);
		case "Home":
			return SIDEBAR_WIDTH_MIN;
		case "End":
			return SIDEBAR_WIDTH_MAX;
		default:
			return null;
	}
}
