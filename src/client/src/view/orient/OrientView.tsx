import type { FileDiffDto } from "@dto/ChangesetDto";
import type { IntentMapDto } from "@dto/IntentMapDto";
import { useGuaranteedChangeset } from "../diff/useGuaranteedChangeset";
import { AnalysisInvitation } from "./AnalysisInvitation";
import { IntentMapView } from "./IntentMapView";
import styles from "./OrientView.module.css";
import { useIntentMap } from "./useIntentMap";

/**
 * `/orient`'s page body (PRODUCT §6 step 2): read this before any diff. One
 * reading column, because the whole surface is prose plus proportions — a
 * dashboard layout would invite scanning, which is the habit this page exists
 * to interrupt.
 */
export function OrientView() {
	const changeset = useGuaranteedChangeset();
	const { intentMap, loading } = useIntentMap();

	return (
		<div className={styles.page}>
			<div className={styles.column}>
				<h1 className={styles.heading}>What this change is for</h1>
				<OrientBody
					intentMap={intentMap}
					loading={loading}
					files={changeset.files}
				/>
			</div>
		</div>
	);
}

interface OrientBodyProps {
	intentMap: IntentMapDto | null;
	loading: boolean;
	files: readonly FileDiffDto[];
}

function OrientBody({ intentMap, loading, files }: OrientBodyProps) {
	if (intentMap !== null) {
		return <IntentMapView intentMap={intentMap} files={files} />;
	}
	if (loading) {
		// nothing to say yet, and a skeleton of a page made of prose would just
		// be grey bars where the sentences go
		return null;
	}
	return <AnalysisInvitation />;
}
