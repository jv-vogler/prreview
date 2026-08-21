/**
 * The one piece of ambient state the walking skeleton needs: what time it is.
 * A port rather than a bare `Date.now()` call so `GET /api/session` — and
 * every use-case after it that reports "when" — can be tested against a
 * fixed instant instead of the real clock (CON-013).
 */
export interface Clock {
	now(): Date;
}
