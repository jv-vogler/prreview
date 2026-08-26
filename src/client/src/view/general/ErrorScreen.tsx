import { AlertIcon } from "@primer/octicons-react";
import { useRouteError } from "react-router";
import { HttpError } from "../../infrastructure/httpClients/HttpError";
import styles from "./ErrorScreen.module.css";

const NO_SERVER_BEHIND_IT = new Set([0, 502, 503, 504]);

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
