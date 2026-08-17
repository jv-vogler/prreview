import {
	CheckIcon,
	ChevronLeftIcon,
	ChevronRightIcon,
} from "@primer/octicons-react";
import type { WalkthroughStepDto } from "../../domain/walkthrough/resolveStepTarget";
import { ResumeWalkthroughPill } from "./ResumeWalkthroughPill";
import { Stepper } from "./Stepper";
import styles from "./WalkthroughOverlay.module.css";
import { useWalkthroughMode } from "./WalkthroughProvider";

/**
 * The guided walkthrough's own strip, under the diff (F5).
 *
 * In flow rather than floating, despite the name: a panel that hovered over the
 * bottom of the code would hide the lines the narration is about, and the diff
 * is the protagonist here — the walkthrough narrates it, it does not replace it.
 * The strip is present only while the reader is in the guided order or has a
 * place to come back to; browsing freely leaves the workspace exactly as M1
 * drew it.
 */
export function WalkthroughOverlay() {
	const mode = useWalkthroughMode();

	if (!mode.available || mode.flow.state === "not-started") {
		return null;
	}

	return (
		<section className={styles.rail} aria-label="Guided walkthrough">
			<RailContent />
		</section>
	);
}

function RailContent() {
	const mode = useWalkthroughMode();
	const total = mode.steps.length;

	if (mode.flow.state === "detoured") {
		return (
			<ResumeWalkthroughPill
				fromStep={mode.flow.fromStep}
				total={total}
				step={mode.steps[mode.flow.fromStep]}
				onResume={mode.resume}
				onDismiss={mode.dismiss}
			/>
		);
	}

	if (mode.flow.state === "completed") {
		return (
			<CompletionNote
				total={total}
				onRestart={mode.restart}
				onDismiss={mode.dismiss}
			/>
		);
	}

	if (mode.flow.state !== "at-step") {
		return null;
	}
	const step = mode.steps[mode.flow.index];
	if (step === undefined) {
		return null;
	}

	return (
		<StepBody
			step={step}
			index={mode.flow.index}
			total={total}
			onNext={mode.next}
			onPrevious={mode.previous}
			onBrowseFreely={mode.browseFreely}
		/>
	);
}

interface StepBodyProps {
	step: WalkthroughStepDto;
	index: number;
	total: number;
	onNext(): void;
	onPrevious(): void;
	onBrowseFreely(): void;
}

function StepBody({
	step,
	index,
	total,
	onNext,
	onPrevious,
	onBrowseFreely,
}: StepBodyProps) {
	const onLastStep = index === total - 1;

	return (
		<div className={styles.step}>
			{/* the step changes under a reader who may not be looking at the strip */}
			<div className={styles.reading} aria-live="polite">
				<Stepper total={total} current={index} />
				<h2 className={styles.title}>{step.title}</h2>
				<p className={styles.narration}>{step.narration}</p>
			</div>
			<div className={styles.controls}>
				<button
					type="button"
					className={styles.secondary}
					onClick={onPrevious}
					disabled={index === 0}
				>
					<ChevronLeftIcon size={16} />
					Previous
				</button>
				<button type="button" className={styles.primary} onClick={onNext}>
					{onLastStep ? "Finish" : "Next"}
					{onLastStep ? (
						<CheckIcon size={16} />
					) : (
						<ChevronRightIcon size={16} />
					)}
				</button>
				<button
					type="button"
					className={styles.quiet}
					onClick={onBrowseFreely}
					title="Leave the guided order; the strip keeps your place (w)"
				>
					Browse freely
				</button>
			</div>
		</div>
	);
}

interface CompletionNoteProps {
	total: number;
	onRestart(): void;
	onDismiss(): void;
}

function CompletionNote({ total, onRestart, onDismiss }: CompletionNoteProps) {
	return (
		<div className={styles.completion}>
			<p className={styles.finished}>
				<span className={styles.check} aria-hidden="true">
					<CheckIcon size={16} />
				</span>
				That is all {total} steps. Coverage counted every hunk they walked
				through.
			</p>
			<button type="button" className={styles.quiet} onClick={onRestart}>
				Read it again
			</button>
			<button type="button" className={styles.secondary} onClick={onDismiss}>
				Done
			</button>
		</div>
	);
}
