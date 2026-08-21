// must evaluate before any module that constructs a dto schema — see the file
import "./infrastructure/configureZod";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { ReviewPage } from "./pages/ReviewPage";
import { WorkerPoolHost } from "./view/app/WorkerPoolHost";
import { ErrorScreen } from "./view/general/ErrorScreen";
import { ThemeProvider } from "./view/styling/ThemeProvider";
import "./view/styling/tokens.css";
import "./view/styling/global.css";
import "./view/styling/pierre-theme.css";

/**
 * One screen plus an error boundary (REQ-001): everything else this app will
 * ever need is the diff view Phase 3 adds here, not a new route.
 */
const router = createBrowserRouter([
	{
		errorElement: <ErrorScreen />,
		children: [{ path: "/", element: <ReviewPage /> }],
	},
]);

const rootElement = document.getElementById("root");
if (rootElement === null) {
	throw new Error("index.html is missing the #root element");
}

createRoot(rootElement).render(
	<ThemeProvider>
		<WorkerPoolHost>
			<RouterProvider router={router} />
		</WorkerPoolHost>
	</ThemeProvider>,
);
