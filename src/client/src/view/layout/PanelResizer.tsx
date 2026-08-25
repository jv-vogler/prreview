import { useCallback, useRef, useState } from "react";
import styles from "./PanelResizer.module.css";
import { clampPanelWidth, type PanelWidthSpec } from "./usePanelWidth";

/**
 * The grab handle on a side panel's inner edge, used by both panels.
 *
 * It is a `separator` with an `aria-valuenow`, not a decorative strip,
 * because a pointer-only resize is a resize half the people using the app
 * cannot do. The arrow keys move it in useful steps and Home/End take it to
 * the stops.
 *
 * `spec.side` sets which way the pointer has to travel: a right-docked panel
 * grows as the handle moves left, so the delta is read against the edge the
 * panel is anchored to rather than against the screen.
 */

export interface PanelResizerProps {
	spec: PanelWidthSpec;
	width: number;
	onWidth(width: number): void;
}

/** one arrow press; big enough to be worth pressing, small enough to aim with */
const KEY_STEP = 16;

export function PanelResizer({ spec, width, onWidth }: PanelResizerProps) {
	const [dragging, setDragging] = useState(false);
	const originRef = useRef<{ x: number; width: number } | null>(null);
	const growth = spec.side === "left" ? 1 : -1;

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
			onWidth(origin.width + growth * (event.clientX - origin.x));
		},
		[onWidth, growth],
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
			const next = keyedWidth(event.key, width, spec, growth);
			if (next === null) {
				return;
			}
			event.preventDefault();
			onWidth(next);
		},
		[width, onWidth, spec, growth],
	);

	return (
		// an `hr`, which already means "separator", rather than a div wearing
		// the role. It is focusable here, which is what lets it carry a value
		// and be moved from the keyboard.
		<hr
			aria-orientation="vertical"
			aria-label={spec.label}
			aria-valuenow={Math.round(width)}
			aria-valuemin={spec.min}
			aria-valuemax={spec.max}
			tabIndex={0}
			className={styles.resizer}
			data-dragging={dragging ? "true" : undefined}
			data-panel-resizer={spec.side}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
			onPointerCancel={onPointerUp}
			onKeyDown={onKeyDown}
			onDoubleClick={() => onWidth(spec.min)}
		/>
	);
}

/** Arrow keys move the seam; the panel grows whichever way its edge faces. */
function keyedWidth(
	key: string,
	width: number,
	spec: PanelWidthSpec,
	growth: number,
): number | null {
	switch (key) {
		case "ArrowLeft":
			return clampPanelWidth(spec, width - growth * KEY_STEP);
		case "ArrowRight":
			return clampPanelWidth(spec, width + growth * KEY_STEP);
		case "Home":
			return spec.min;
		case "End":
			return spec.max;
		default:
			return null;
	}
}
