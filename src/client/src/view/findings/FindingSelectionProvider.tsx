import type { ReactNode } from "react";
import { createContext, useContext, useMemo, useState } from "react";

/**
 * Which finding is currently in focus, shared across every surface.
 *
 * This lives in context rather than being threaded through props for a reason
 * specific to the diff renderer: a balloon reaches the page through
 * `renderAnnotation`, which is itself a memo dependency. Closing over selection
 * state there means either a stale highlight or a re-render of every balloon on
 * every selection change. Reading it from context inside the card sidesteps
 * both — and it is one of the two Pierre traps that fail *silently*, so it is
 * worth stating rather than discovering twice.
 */

export interface FindingSelection {
	selectedId: string | null;
	select(id: string | null): void;
}

const FindingSelectionContext = createContext<FindingSelection | null>(null);

export function FindingSelectionProvider({
	children,
}: {
	children: ReactNode;
}) {
	const [selectedId, setSelectedId] = useState<string | null>(null);

	const value = useMemo<FindingSelection>(
		() => ({
			selectedId,
			select: (id) => setSelectedId((current) => (current === id ? null : id)),
		}),
		[selectedId],
	);

	return (
		<FindingSelectionContext.Provider value={value}>
			{children}
		</FindingSelectionContext.Provider>
	);
}

export function useFindingSelection(): FindingSelection {
	const selection = useContext(FindingSelectionContext);
	if (selection === null) {
		throw new Error(
			"useFindingSelection must be used inside a FindingSelectionProvider",
		);
	}
	return selection;
}
