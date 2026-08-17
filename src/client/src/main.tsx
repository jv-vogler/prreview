// must evaluate before any module that constructs a dto schema — see the file
import "./infrastructure/configureZod";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router";
import { buildClientContainer } from "./infrastructure/container";
import { installGoodbyeBeacon } from "./infrastructure/lifecycle/installGoodbyeBeacon";
import { CommentsPage } from "./pages/CommentsPage";
import { DiffPage } from "./pages/DiffPage";
import { OverviewPage } from "./pages/OverviewPage";
import { ReviewLayout } from "./pages/ReviewLayout";
import { RootPage } from "./pages/RootPage";
import { UnderstandPage } from "./pages/UnderstandPage";
import { ClientContainerProvider } from "./view/app/ClientContainerProvider";
import { FindingSelectionProvider } from "./view/findings/FindingSelectionProvider";
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

/**
 * Four surfaces as nested routes under one layout, so everything that must
 * survive a tab switch — coverage, the run, chat, the diff cursor, the worker
 * pool — is owned above them and rebuilt by none of them.
 *
 * `/orient` redirects permanently: the orientation it named is now Overview,
 * and a link someone saved should land somewhere true rather than 404.
 */
const router = createBrowserRouter([
	{ path: "/", element: <RootPage /> },
	{ path: "/orient", element: <Navigate to="/overview" replace /> },
	{
		element: <ReviewLayout />,
		children: [
			{ path: "/overview", element: <OverviewPage /> },
			{ path: "/diff", element: <DiffPage /> },
			{ path: "/understand", element: <UnderstandPage /> },
			{ path: "/comments", element: <CommentsPage /> },
		],
	},
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
					<FindingSelectionProvider>
						<RouterProvider router={router} />
					</FindingSelectionProvider>
				</TooltipProvider>
			</ThemeProvider>
		</ClientContainerProvider>
	</QueryClientProvider>,
);
