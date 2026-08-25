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
	onToggle,
}: {
	label: string;
	color?: number;
	pressed?: boolean;
	onToggle?(): void;
}) {
	if (onToggle === undefined) {
		return (
			<span className={styles.chip} data-topic-color={color}>
				{label}
			</span>
		);
	}
	return (
		<button
			type="button"
			className={styles.chip}
			data-topic-color={color}
			aria-pressed={pressed}
			onClick={onToggle}
		>
			{label}
		</button>
	);
}
