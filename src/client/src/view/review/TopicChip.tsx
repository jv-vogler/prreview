import styles from "./TopicChip.module.css";

/**
 * One topic label, wearing its palette slot (topicColors.ts) everywhere it
 * appears — on a balloon's header and in the sidebar — so repeated topics
 * match at a glance. With `onToggle` it becomes the control that lights up
 * every balloon of its topic.
 */
export function TopicChip({
	label,
	color,
	pressed,
	wrap,
	onToggle,
}: {
	label: string;
	color?: number;
	pressed?: boolean;
	/** a label is a clause, so anywhere with room lets it take a second line */
	wrap?: boolean;
	onToggle?(): void;
}) {
	const className = wrap ? `${styles.chip} ${styles.wrapped}` : styles.chip;
	if (onToggle === undefined) {
		return (
			<span className={className} data-topic-color={color}>
				{label}
			</span>
		);
	}
	return (
		<button
			type="button"
			className={className}
			data-topic-color={color}
			aria-pressed={pressed}
			onClick={onToggle}
		>
			{label}
		</button>
	);
}
