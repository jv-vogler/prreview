import { Suspense, useCallback, useState } from "react";
import { Navigate, useNavigate } from "react-router";
import { AnalysisProvider } from "../view/analysis/AnalysisProvider";
import { AnalysisTray } from "../view/analysis/AnalysisTray";
import { AppShell } from "../view/app/AppShell";
import { TopBar } from "../view/app/TopBar";
import { HelpDialog } from "../view/diff/HelpDialog";
import type { KeyAction } from "../view/diff/resolveKeyAction";
import { useKeymap } from "../view/diff/useKeymap";
import { LoadingScreen } from "../view/general/LoadingScreen";
import { OrientView } from "../view/orient/OrientView";
import { useFeatureFlags } from "../view/session/useFeatureFlags";

/** `/orient` — the orientation page behind the suspense gate (TASK-052). */
export function OrientPage() {
	return (
		<Suspense fallback={<LoadingScreen />}>
			<OrientPageContent />
		</Suspense>
	);
}

function OrientPageContent() {
	const flags = useFeatureFlags();

	// With no agent this page has no subject at all, and F12 asks for absence
	// rather than a disabled-looking surface: the reader is sent back to the
	// diff, where the one viewer-only notice explains why nothing AI is here.
	if (!flags.analysis) {
		return <Navigate to="/diff" replace />;
	}

	return (
		<AnalysisProvider>
			<OrientPageBody />
		</AnalysisProvider>
	);
}

function OrientPageBody() {
	const navigate = useNavigate();
	const [helpOpen, setHelpOpen] = useState(false);

	const onKeyAction = useCallback(
		(action: KeyAction) => {
			switch (action) {
				case "go-diff":
					return navigate("/diff");
				case "open-help":
					return setHelpOpen(true);
			}
		},
		[navigate],
	);

	useKeymap({ dialogOpen: helpOpen, onAction: onKeyAction });

	return (
		<>
			<AppShell
				topBar={<TopBar onOpenHelp={() => setHelpOpen(true)} />}
				banner={<AnalysisTray />}
				workspace={<OrientView />}
			/>
			<HelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
		</>
	);
}
