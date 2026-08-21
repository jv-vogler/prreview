// must evaluate before any module that constructs a dto schema — see the file
import "./infrastructure/configureZod";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router";
import { buildClientContainer } from "./infrastructure/container";
import { installGoodbyeBeacon } from "./infrastructure/lifecycle/installGoodbyeBeacon";
import { CommentsPage } from "./pages/CommentsPage";
import { DiffPage } from "./pages/DiffPage";
import { ReviewLayout } from "./pages/ReviewLayout";
import { RootPage } from "./pages/RootPage";
import { UnderstandPage } from "./pages/UnderstandPage";
import { ClientContainerProvider } from "./view/app/ClientContainerProvider";
import { FindingSelectionProvider } from "./view/findings/FindingSelectionProvider";
import { ErrorScreen } from "./view/general/ErrorScreen";
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
 * Three surfaces as nested routes under one layout, so everything that must
 * survive a tab switch — coverage, the run, chat, the diff cursor, the worker
 * pool, and which finding is selected — is owned above them and rebuilt by none
 * of them.
 *
 * `/orient` and `/overview` both redirect to Understanding. Overview was its
 * own tab for one release and should not have been: it and Understanding came
 * from the same pass over the diff and read as one account, so splitting them
 * charged a click for half a thought. Old links land on the whole thing.
 */
const router = createBrowserRouter([
	{
		// One boundary over everything, because there is exactly one way this
		// app fails before it can draw: the session or the changeset does not
		// arrive. Without it a suspending query's throw reached React Router's
		// default page, which reads like a stack trace and names no remedy.
		errorElement: <ErrorScreen />,
		children: [
			{ path: "/", element: <RootPage /> },
			{ path: "/orient", element: <Navigate to="/understand" replace /> },
			{ path: "/overview", element: <Navigate to="/understand" replace /> },
			{
				element: <ReviewLayout />,
				children: [
					{ path: "/understand", element: <UnderstandPage /> },
					{ path: "/diff", element: <DiffPage /> },
					{ path: "/comments", element: <CommentsPage /> },
				],
			},
			{ path: "*", element: <RootPage /> },
		],
	},
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
