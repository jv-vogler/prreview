import "./infrastructure/configureZod";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { ReviewPage } from "./pages/ReviewPage";
import { WorkerPoolHost } from "./view/app/WorkerPoolHost";
import { ErrorScreen } from "./view/general/ErrorScreen";
import "./view/styling/fonts.css";
import "./view/styling/tokens.css";
import "./view/styling/global.css";
import "./view/styling/pierre-theme.css";

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
	<WorkerPoolHost>
		<RouterProvider router={router} />
	</WorkerPoolHost>,
);
