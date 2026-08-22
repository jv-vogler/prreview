import { useEffect, useState } from "react";

const TICK_MS = 1000;

/**
 * Milliseconds since an instant the server reported, re-read once a second
 * so a running review visibly costs time. Null in, null out: nothing has
 * started, so there is nothing to count.
 */
export function useElapsedSince(instant: string | null): number | null {
	const [now, setNow] = useState(() => Date.now());

	useEffect(() => {
		if (instant === null) {
			return;
		}
		setNow(Date.now());
		const timer = setInterval(() => setNow(Date.now()), TICK_MS);
		return () => clearInterval(timer);
	}, [instant]);

	if (instant === null) {
		return null;
	}
	const started = Date.parse(instant);
	return Number.isNaN(started) ? null : now - started;
}
