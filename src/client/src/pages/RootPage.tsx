import { Suspense } from "react";
import { Navigate } from "react-router";
import { chooseLanding } from "../domain/session/chooseLanding";
import { LoadingScreen } from "../view/general/LoadingScreen";
import { useGuaranteedSession } from "../view/session/useGuaranteedSession";

/**
 * `/` — the gate route (ARCHITECTURE §9 pages/): it reads the session and sends
 * the reader to the orientation or straight to the diff. Which one is a domain
 * rule (`chooseLanding`), not a condition in a component.
 */
export function RootPage() {
	return (
		<Suspense fallback={<LoadingScreen />}>
			<RootRedirect />
		</Suspense>
	);
}

function RootRedirect() {
	const session = useGuaranteedSession();
	return <Navigate to={`/${chooseLanding(session)}`} replace />;
}
