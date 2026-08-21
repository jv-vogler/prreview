import { AlertIcon } from "@primer/octicons-react";
import { useRouteError } from "react-router";
import { HttpError } from "../../infrastructure/httpClients/HttpError";
import styles from "./ErrorScreen.module.css";

/**
 * No answer, or an answer from something standing in front of a server that is
 * not there: the client's own `unreachable` (0) and the gateway statuses the
 * dev proxy answers with once the API server is gone.
 */
const NO_SERVER_BEHIND_IT = new Set([0, 502, 503, 504]);

/**
 * The router's error boundary — the edge, in the sense of ARCHITECTURE §2.
 *
 * There was none, so a failed session or changeset load reached React Router's
 * default page, and a load that failed by *hanging* reached nothing at all:
 * the reader sat on "Loading review…" indefinitely while the real reason —
 * usually that no server is running — was a line in a terminal behind the
 * browser. A screen that cannot be filled has to say why it cannot be filled.
 */
export function ErrorScreen() {
	const error = useRouteError();
	const noServer =
		error instanceof HttpError && NO_SERVER_BEHIND_IT.has(error.status);

	return (
		<div className={styles.screen} role="alert">
			<span className={styles.icon}>
				<AlertIcon size={24} />
			</span>
			<h1 className={styles.title}>
				{noServer
					? "prreview is not answering"
					: "This review could not be loaded"}
			</h1>
			<p className={styles.detail}>
				{noServer ? (
					<>
						The server behind this page is not there — it refused to start, it
						crashed, or its terminal was closed. The terminal you started it
						from says which. Run <code className={styles.code}>prreview</code>{" "}
						again in your repository, then reload.
					</>
				) : (
					messageOf(error)
				)}
			</p>
			<button
				type="button"
				className={styles.reload}
				onClick={() => window.location.reload()}
			>
				Reload
			</button>
		</div>
	);
}

function messageOf(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	return "Something went wrong and the page could not be rendered.";
}
