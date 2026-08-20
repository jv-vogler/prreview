import type { ReviewPresetDto } from "@dto/AnalysisRequest";
import styles from "./DepthPicker.module.css";

/**
 * How hard to look.
 *
 * Three presets and no custom, because the two things a reviewer might actually
 * want to tune are already unreachable by design: the lens locks live in
 * `customDepth` on the server (a checkbox this UI disabled would still be one
 * line of curl away), and a spend ceiling can only honestly promise "stops once
 * it has spent about $X" — a number below one turn's cost does not prevent the
 * run, it makes it fail after paying.
 *
 * The copy states lens count, how many children run at once, and whether the
 * smallest tier of remark exists. It deliberately never says "more thinking":
 * `--effort` was measured as having no demonstrated effect on a review task
 * (`spikes/depth-and-fanout/VERDICT.md`), and the claim is forbidden until
 * somebody shows it.
 */

export type DepthChoice = Extract<
	ReviewPresetDto,
	"light" | "standard" | "thorough"
>;

interface Preset {
	id: DepthChoice;
	label: string;
	/** the real numbers, from ReviewDepth — so the copy invents nothing */
	detail: string;
}

const PRESETS: Preset[] = [
	{
		id: "light",
		label: "Light",
		detail:
			"2 readings — correctness and security. One at a time, up to 8 comments, no nitpicks at all.",
	},
	{
		id: "standard",
		label: "Standard",
		detail:
			"5 readings — the two above plus edge cases, design, and one that knows nothing about the project. Three at a time, up to 15 comments.",
	},
	{
		id: "thorough",
		label: "Thorough",
		detail:
			"6 readings — all of the above plus what else the change reaches. Five at a time, up to 20 comments.",
	},
];

export interface DepthPickerProps {
	value: DepthChoice;
	onChange(value: DepthChoice): void;
	disabled?: boolean;
}

export function DepthPicker({
	value,
	onChange,
	disabled = false,
}: DepthPickerProps) {
	return (
		<fieldset className={styles.picker} disabled={disabled}>
			<legend className={styles.legend}>How hard to look</legend>
			{PRESETS.map((preset) => (
				<label
					className={styles.option}
					key={preset.id}
					data-depth={preset.id}
					data-selected={preset.id === value ? "true" : "false"}
				>
					<input
						type="radio"
						name="review-depth"
						value={preset.id}
						checked={preset.id === value}
						onChange={() => onChange(preset.id)}
					/>
					<span className={styles.label}>{preset.label}</span>
					<span className={styles.detail}>{preset.detail}</span>
				</label>
			))}
		</fieldset>
	);
}
