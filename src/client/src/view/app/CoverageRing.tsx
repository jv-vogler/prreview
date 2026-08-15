import styles from "./CoverageRing.module.css";

export interface CoverageRingProps {
	/** unrounded 0–100 (F7); rounding happens here, in presentation */
	percent: number;
}

const RING_SIZE = 20;
const RING_STROKE_WIDTH = 2.5;
const RING_RADIUS = (RING_SIZE - RING_STROKE_WIDTH) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
const FULL_PERCENT = 100;

/** How much of the ring's circumference stays unpainted for a given percent. */
export function ringDashOffset(percent: number): number {
	const clamped = Math.min(FULL_PERCENT, Math.max(0, percent));
	return RING_CIRCUMFERENCE * (1 - clamped / FULL_PERCENT);
}

/** The total-coverage ring in the top bar (F7): server-fed, never re-derived. */
export function CoverageRing({ percent }: CoverageRingProps) {
	const rounded = Math.round(percent);
	const center = RING_SIZE / 2;
	return (
		// biome-ignore lint/a11y/useSemanticElements: a native <meter> cannot render as an SVG ring; the ARIA meter role carries the same semantics
		<div
			className={styles.ring}
			role="meter"
			aria-valuemin={0}
			aria-valuemax={FULL_PERCENT}
			aria-valuenow={rounded}
			aria-label="Review coverage"
			data-complete={rounded === FULL_PERCENT || undefined}
		>
			<svg width={RING_SIZE} height={RING_SIZE} aria-hidden="true">
				<circle
					className={styles.track}
					cx={center}
					cy={center}
					r={RING_RADIUS}
					fill="none"
					strokeWidth={RING_STROKE_WIDTH}
				/>
				<circle
					className={styles.progress}
					cx={center}
					cy={center}
					r={RING_RADIUS}
					fill="none"
					strokeWidth={RING_STROKE_WIDTH}
					strokeLinecap="round"
					strokeDasharray={RING_CIRCUMFERENCE}
					strokeDashoffset={ringDashOffset(percent)}
					transform={`rotate(-90 ${center} ${center})`}
				/>
			</svg>
			<span className={styles.label}>{rounded}%</span>
		</div>
	);
}
