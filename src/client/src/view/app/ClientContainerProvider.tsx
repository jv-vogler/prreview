import type { ReactNode } from "react";
import { createContext, useContext } from "react";
import type { ClientContainer } from "../../infrastructure/container";

const ClientContainerContext = createContext<ClientContainer | null>(null);

export interface ClientContainerProviderProps {
	container: ClientContainer;
	children: ReactNode;
}

/** Hands the composition root to the view; tests provide a fake container (PAT-001). */
export function ClientContainerProvider({
	container,
	children,
}: ClientContainerProviderProps) {
	return (
		<ClientContainerContext.Provider value={container}>
			{children}
		</ClientContainerContext.Provider>
	);
}

export function useClientContainer(): ClientContainer {
	const container = useContext(ClientContainerContext);
	if (container === null) {
		throw new Error(
			"useClientContainer must be used inside a ClientContainerProvider",
		);
	}
	return container;
}
