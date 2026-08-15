const GOODBYE_URL = "/api/goodbye";

/**
 * The client half of the server's liveness protocol (ARCHITECTURE §3): a
 * goodbye beacon on pagehide lets the server start its shutdown grace timer
 * without waiting for the SSE socket teardown. A reload's reconnect cancels
 * the timer, and the server redeems beacon + socket-close as one decrement,
 * so this can never double-count.
 */
export function installGoodbyeBeacon(): void {
	window.addEventListener("pagehide", () => {
		navigator.sendBeacon(GOODBYE_URL);
	});
}
