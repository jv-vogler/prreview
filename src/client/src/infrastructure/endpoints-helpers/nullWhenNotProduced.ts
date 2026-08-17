import { HttpError } from "../httpClients/HttpError";

const NOT_FOUND = 404;
const NOT_PRODUCED = "not-produced";

/**
 * "Not produced yet" is a state, not an error (TASK-047). The intent map and
 * the walkthrough only exist after an analysis has run, and until then the
 * server answers 404 with reason `not-produced` — which resolves to `null` so
 * the UI can render the analysis call-to-action instead of an error. Any other
 * failure still throws.
 */
export async function nullWhenNotProduced<Value>(
	load: () => Promise<Value>,
): Promise<Value | null> {
	try {
		return await load();
	} catch (error) {
		if (
			error instanceof HttpError &&
			error.status === NOT_FOUND &&
			error.reason === NOT_PRODUCED
		) {
			return null;
		}
		throw error;
	}
}
