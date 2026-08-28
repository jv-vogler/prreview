import styles from "./TopicChip.module.css";

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
			<span className={styles.chip} data-topic-color={color} title={label}>
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
			title={label}
			onClick={onToggle}
		>
			{label}
		</button>
	);
}
