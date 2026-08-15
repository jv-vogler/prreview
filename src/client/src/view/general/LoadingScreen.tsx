import styles from "./LoadingScreen.module.css";

/** The suspense gate's fallback while session + changeset load. */
export function LoadingScreen() {
	return (
		<div className={styles.screen} role="status">
			Loading review…
		</div>
	);
}
