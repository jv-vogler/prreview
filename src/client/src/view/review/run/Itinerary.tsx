import type { ItineraryStepDto } from "@dto/RunDto";
import { CheckIcon } from "@primer/octicons-react";
import { Fragment } from "react";
import styles from "./Itinerary.module.css";

export interface ItineraryProps {
	steps: readonly ItineraryStepDto[];
	stalled: boolean;
}

export function Itinerary({ steps, stalled }: ItineraryProps) {
	if (steps.length === 0) {
		return null;
	}
	return (
		<div className={styles.wrapper}>
			<div className={styles.wrapperClip}>
				<div className={styles.rail}>
					{steps.map((step, index) => (
						<Fragment key={step.label}>
							{index > 0 && (
								<div
									className={styles.connector}
									aria-hidden="true"
									data-filled={steps[index - 1].state === "done" || undefined}
								>
									<span className={styles.connectorBase} />
									<span className={styles.connectorFill} />
								</div>
							)}
							<div className={styles.step} data-step-state={step.state}>
								<span className={styles.glyphSlot}>
									<Glyph state={step.state} stalled={stalled} />
								</span>
								<span className={styles.label}>{step.label}</span>
							</div>
						</Fragment>
					))}
				</div>
			</div>
		</div>
	);
}

function Glyph({
	state,
	stalled,
}: {
	state: ItineraryStepDto["state"];
	stalled: boolean;
}) {
	if (state === "done") {
		return (
			<span className={styles.check}>
				<CheckIcon size={12} />
			</span>
		);
	}
	if (state === "active") {
		return <span className={styles.dot} data-stalled={stalled || undefined} />;
	}
	return <span className={styles.ring} />;
}
