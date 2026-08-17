import type { SessionDto } from "@dto/SessionDto";
import type { WalkthroughProgressResponse } from "@dto/WalkthroughProgressPut";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useSearchParams } from "react-router";
import type { WalkthroughStepDto } from "../../domain/walkthrough/resolveStepTarget";
import { resolveStepTarget } from "../../domain/walkthrough/resolveStepTarget";
import type { WalkthroughFlow } from "../../domain/walkthrough/walkthroughFlow";
import {
	completeWalkthrough,
	detour,
	leaveWalkthrough,
	nextStep,
	notStartedWalkthrough,
	previousStep,
	resumeWalkthrough,
	startWalkthrough,
} from "../../domain/walkthrough/walkthroughFlow";
import { putWalkthroughProgress } from "../../infrastructure/endpoints/putWalkthroughProgress";
import {
	searchParamsForWalkthroughStep,
	walkthroughStepFromSearchParams,
} from "../../pages/diffUrl";
import { useClientContainer } from "../app/ClientContainerProvider";
import { useDiffNavigation } from "../diff/DiffNavigationProvider";
import {
	SESSION_QUERY_KEY,
	useGuaranteedSession,
} from "../session/useGuaranteedSession";
import { useWalkthrough } from "./useWalkthrough";

export interface WalkthroughMode {
	/** an analysis has produced a reading order for this round */
	available: boolean;
	steps: readonly WalkthroughStepDto[];
	flow: WalkthroughFlow;
	/** `w`: into the guided order, out of it, or back to where it was left */
	toggle(): void;
	next(): void;
	previous(): void;
	/** leave the guided order but remember the step, so it can be resumed */
	browseFreely(): void;
	resume(): void;
	restart(): void;
	/** put the rail away without claiming the walkthrough was read */
	dismiss(): void;
}

const WalkthroughContext = createContext<WalkthroughMode | null>(null);

export interface WalkthroughProviderProps {
	children: ReactNode;
}

/**
 * The guided walkthrough as a mode over `/diff` (F5, ARCHITECTURE §9): it owns
 * the flow machine, the step in the URL, the scroll into each step, and the
 * progress call that also moves coverage.
 *
 * A mode rather than a route, so the workspace never remounts — the reader's
 * diff, its loaded blobs and its scroll position all survive stepping in and
 * out. Every step entry issues one `PUT /api/walkthrough/progress`, and the
 * fresh coverage summary in that response is what the ring shows: reading a
 * step IS reviewing it (§7), and the percentage is never computed here
 * (REQ-008).
 */
export function WalkthroughProvider({ children }: WalkthroughProviderProps) {
	const { api } = useClientContainer();
	const session = useGuaranteedSession();
	const navigation = useDiffNavigation();
	const queryClient = useQueryClient();
	const { walkthrough } = useWalkthrough();
	const [searchParams, setSearchParams] = useSearchParams();

	const steps = walkthrough?.steps ?? [];
	const available = session.analysis.walkthroughAvailable;
	const storedPosition = session.analysis.walkthroughProgress;

	// the URL is read once, at entry — afterwards the flow writes the URL
	const restoredStepRef = useRef<number | null>(null);
	const restoredReadRef = useRef(false);
	if (!restoredReadRef.current) {
		restoredReadRef.current = true;
		restoredStepRef.current = walkthroughStepFromSearchParams(searchParams);
	}

	const [flow, setFlow] = useState<WalkthroughFlow>(() =>
		restoredStepRef.current === null
			? notStartedWalkthrough
			: startWalkthrough(restoredStepRef.current),
	);

	const progress = useMutation({
		mutationFn: (entered: { position: number; completed: boolean }) =>
			putWalkthroughProgress(api, entered),
		onSuccess: (response) => patchSession(queryClient, response),
	});

	// One place decides what "the reader is now in step N" means: the flow says
	// so, the server is told, and the diff scrolls there. Driven by the flow
	// rather than by each button, so a step restored from the URL lands exactly
	// like a step reached by clicking Next.
	const enteredStepRef = useRef<number | null>(null);
	const jumpTo = navigation.jumpTo;
	const enter = progress.mutate;
	useEffect(() => {
		if (flow.state !== "at-step") {
			enteredStepRef.current = null;
			return;
		}
		if (steps.length === 0 || enteredStepRef.current === flow.index) {
			return;
		}
		const step = steps[flow.index];
		if (step === undefined) {
			// the reading order shrank under a restored step: nothing to show
			setFlow(completeWalkthrough(flow));
			return;
		}
		enteredStepRef.current = flow.index;
		enter({ position: flow.index, completed: false });
		const target = resolveStepTarget(step, navigation.files);
		if (target !== null) {
			jumpTo(target);
		}
	}, [flow, steps, navigation.files, jumpTo, enter]);

	// the last step's "Done" is the one moment progress is completed, and the
	// server needs a position that exists, so it re-enters the final step
	const lastIndex = steps.length - 1;
	useEffect(() => {
		if (flow.state !== "completed" || lastIndex < 0) {
			return;
		}
		enter({ position: lastIndex, completed: true });
	}, [flow.state, lastIndex, enter]);

	useEffect(() => {
		const stepIndex = flow.state === "at-step" ? flow.index : null;
		setSearchParams(
			(current) => searchParamsForWalkthroughStep(current, stepIndex),
			{ replace: true },
		);
	}, [flow, setSearchParams]);

	const entryPoint = useCallback(() => {
		// a walkthrough already read through restarts; one left half-read
		// resumes where the last visit stopped (F13)
		if (storedPosition === undefined || storedPosition.completed) {
			return startWalkthrough();
		}
		return startWalkthrough(storedPosition.position);
	}, [storedPosition]);

	const value = useMemo<WalkthroughMode>(
		() => ({
			available,
			steps,
			flow,
			toggle() {
				if (!available) {
					return;
				}
				setFlow((current) => {
					if (current.state === "at-step") {
						return detour(current);
					}
					if (current.state === "detoured") {
						return resumeWalkthrough(current);
					}
					return entryPoint();
				});
			},
			next() {
				setFlow((current) => nextStep(current, steps.length));
			},
			previous() {
				setFlow(previousStep);
			},
			browseFreely() {
				setFlow(detour);
			},
			resume() {
				setFlow(resumeWalkthrough);
			},
			restart() {
				setFlow(startWalkthrough());
			},
			dismiss() {
				setFlow(leaveWalkthrough());
			},
		}),
		[available, steps, flow, entryPoint],
	);

	return (
		<WalkthroughContext.Provider value={value}>
			{children}
		</WalkthroughContext.Provider>
	);
}

export function useWalkthroughMode(): WalkthroughMode {
	const mode = useContext(WalkthroughContext);
	if (mode === null) {
		throw new Error(
			"useWalkthroughMode must be used inside a WalkthroughProvider",
		);
	}
	return mode;
}

/**
 * One response carries both halves of what entering a step changed, so both are
 * written into the session cache the header reads: where the reader is, and the
 * coverage the step's hunks moved. The summary is the server's, verbatim.
 */
function patchSession(
	queryClient: ReturnType<typeof useQueryClient>,
	response: WalkthroughProgressResponse,
): void {
	queryClient.setQueryData<SessionDto>(SESSION_QUERY_KEY, (session) =>
		session === undefined
			? session
			: {
					...session,
					coverage: response.coverage,
					analysis: {
						...session.analysis,
						walkthroughProgress: response.progress,
					},
				},
	);
}
