import styles from "./TopicChip.module.css";

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
