import { useEffect, useRef, useState } from "react";

const TICK_MS = 1000;

interface Anchor {
	instant: string;
	perfStart: number;
	offsetMs: number;
}

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
