const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const SECOND_DIGITS = 2;

/**
 * How long a run has been going, as a clock: `0:07`, `1:42`, `12:05`.
 * Minutes are never padded and seconds always are, which is how every
 * stopwatch a reader has ever seen behaves.
 */
export function formatElapsed(elapsedMs: number): string {
	const totalSeconds = Math.max(0, Math.floor(elapsedMs / MS_PER_SECOND));
	const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE);
	const seconds = totalSeconds % SECONDS_PER_MINUTE;
	return `${minutes}:${String(seconds).padStart(SECOND_DIGITS, "0")}`;
}
