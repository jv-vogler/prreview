import { useCallback, useRef, useState } from "react";
import styles from "./PanelResizer.module.css";
import { clampPanelWidth, type PanelWidthSpec } from "./usePanelWidth";

export interface PanelResizerProps {
	spec: PanelWidthSpec;
	width: number;
	onWidth(width: number): void;
	onDraggingChange?(dragging: boolean): void;
}

const KEY_STEP = 16;

export function PanelResizer({
	spec,
	width,
	onWidth,
	onDraggingChange,
}: PanelResizerProps) {
	const [dragging, setDraggingState] = useState(false);
	const originRef = useRef<{ x: number; width: number } | null>(null);
	const growth = spec.side === "left" ? 1 : -1;

	const setDragging = useCallback(
		(next: boolean) => {
			setDraggingState(next);
			onDraggingChange?.(next);
		},
		[onDraggingChange],
	);

	const onPointerDown = useCallback(
		(event: React.PointerEvent<HTMLHRElement>) => {
			if (event.button !== 0) {
				return;
			}

			event.currentTarget.setPointerCapture(event.pointerId);
			originRef.current = { x: event.clientX, width };
			setDragging(true);
		},
		[width, setDragging],
	);

	const onPointerMove = useCallback(
		(event: React.PointerEvent<HTMLHRElement>) => {
			const origin = originRef.current;
			if (origin === null) {
				return;
			}

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
		[setDragging],
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
