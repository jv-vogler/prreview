import { ChevronLeftIcon, ChevronRightIcon } from "@primer/octicons-react";
import { type ReactNode, useState } from "react";
import styles from "./FoldablePanel.module.css";
import { PanelResizer } from "./PanelResizer";
import type { PanelWidthSpec } from "./usePanelWidth";

const FOLDED_PANEL_WIDTH = 32;

export interface FoldablePanelProps {
	spec: PanelWidthSpec;
	width: number;
	onWidth(width: number): void;
	folded: boolean;
	onToggleFold(): void;
	children: ReactNode;
}

export function FoldablePanel({
	spec,
	width,
	onWidth,
	folded,
	onToggleFold,
	children,
}: FoldablePanelProps) {
	const [dragging, setDragging] = useState(false);
	const foldIcon = spec.side === "left" ? ChevronLeftIcon : ChevronRightIcon;
	const unfoldIcon = spec.side === "left" ? ChevronRightIcon : ChevronLeftIcon;
	const Icon = folded ? unfoldIcon : foldIcon;

	const slot = (
		<div
			className={styles.slot}
			data-side={spec.side}
			data-folded={folded || undefined}
			data-dragging={dragging || undefined}
			style={{ width: folded ? FOLDED_PANEL_WIDTH : width }}
		>
			<div className={styles.content}>{children}</div>
			<button
				type="button"
				className={styles.foldButton}
				aria-expanded={!folded}
				aria-label={
					folded ? `Show ${spec.title} panel` : `Hide ${spec.title} panel`
				}
				onClick={onToggleFold}
			>
				<Icon size={12} />
			</button>
		</div>
	);

	const resizer = !folded && (
		<div className={styles.edge}>
			<PanelResizer
				spec={spec}
				width={width}
				onWidth={onWidth}
				onDraggingChange={setDragging}
			/>
		</div>
	);

	return spec.side === "left" ? (
		<>
			{slot}
			{resizer}
		</>
	) : (
		<>
			{resizer}
			{slot}
		</>
	);
}
