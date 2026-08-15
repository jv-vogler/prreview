import { Navigate } from "react-router";

/**
 * `/` — the gate route. In M1 it always lands on the diff; the "redirect to
 * /orient when an intent map exists and coverage is 0" rule activates in M2
 * (ARCHITECTURE §9 pages/).
 */
export function RootPage() {
	return <Navigate to="/diff" replace />;
}
