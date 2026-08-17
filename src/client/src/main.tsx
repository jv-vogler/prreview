// must evaluate before any module that constructs a dto schema — see the file
import "./infrastructure/configureZod";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { buildClientContainer } from "./infrastructure/container";
import { installGoodbyeBeacon } from "./infrastructure/lifecycle/installGoodbyeBeacon";
import { DiffPage } from "./pages/DiffPage";
import { OrientPage } from "./pages/OrientPage";
import { RootPage } from "./pages/RootPage";
import { ClientContainerProvider } from "./view/app/ClientContainerProvider";
import { TooltipProvider } from "./view/general/Tooltip";
import { ThemeProvider } from "./view/styling/ThemeProvider";
import "./view/styling/tokens.css";
import "./view/styling/pierre-theme.css";
import "./view/styling/global.css";

const container = buildClientContainer();
installGoodbyeBeacon();

// server state is authoritative and pushed over SSE (REQ-007): caches never
// go stale on their own and are patched, not refetched
const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			staleTime: Infinity,
			refetchOnWindowFocus: false,
			retry: 1,
		},
	},
});

const router = createBrowserRouter([
	{ path: "/", element: <RootPage /> },
	{ path: "/orient", element: <OrientPage /> },
	{ path: "/diff", element: <DiffPage /> },
	{ path: "*", element: <RootPage /> },
]);

const rootElement = document.getElementById("root");
if (rootElement === null) {
	throw new Error("index.html is missing the #root element");
}

createRoot(rootElement).render(
	<QueryClientProvider client={queryClient}>
		<ClientContainerProvider container={container}>
			<ThemeProvider>
				<TooltipProvider>
					<RouterProvider router={router} />
				</TooltipProvider>
			</ThemeProvider>
		</ClientContainerProvider>
	</QueryClientProvider>,
);
