import { useEffect, useRef, useState } from "react";

const TICK_MS = 1000;

interface Anchor {
	instant: string;
	perfStart: number;
	offsetMs: number;
}

/**
 * Milliseconds since an instant the server reported, re-read once a second
 * so a running review visibly costs time. Null in, null out: nothing has
 * started, so there is nothing to count.
 *
 * The offset against the server's timestamp is computed once, when `instant`
 * first appears; every tick after that adds `performance.now()`'s own delta
 * instead of re-diffing against the server clock, so a skewed server or
 * client clock stops ticking at a wrong number rather than getting stuck at
 * zero forever.
 */
export function useElapsedSince(instant: string | null): number | null {
	const [, forceTick] = useState(0);
	const anchorRef = useRef<Anchor | null>(null);

	if (instant === null) {
		anchorRef.current = null;
	} else if (anchorRef.current?.instant !== instant) {
		const started = Date.parse(instant);
		anchorRef.current = Number.isNaN(started)
			? null
			: {
					instant,
					perfStart: performance.now(),
					offsetMs: Math.max(0, Date.now() - started),
				};
	}

	useEffect(() => {
		if (instant === null) {
			return;
		}
		const timer = setInterval(() => forceTick((tick) => tick + 1), TICK_MS);
		return () => clearInterval(timer);
	}, [instant]);

	if (anchorRef.current === null) {
		return null;
	}
	return (
		anchorRef.current.offsetMs +
		(performance.now() - anchorRef.current.perfStart)
	);
}
