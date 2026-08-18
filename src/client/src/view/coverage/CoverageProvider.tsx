import type { CoverageUpdateDto } from "@dto/CoveragePut";
import type { CoverageSummaryDto } from "@dto/CoverageSummaryDto";
import type { SessionDto } from "@dto/SessionDto";
import { useQueryClient } from "@tanstack/react-query";
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
import { applyHunkCoverage } from "../../domain/coverage/applyHunkCoverage";
import type { HunkCoverage } from "../../domain/coverage/HunkCoverage";
import { putCoverage } from "../../infrastructure/endpoints/putCoverage";
import { useClientContainer } from "../app/ClientContainerProvider";
import { SESSION_QUERY_KEY } from "../session/useGuaranteedSession";

export interface CoverageActions {
	/** `v` on one hunk: flushed immediately so the ring answers the keystroke */
	markReviewed(hunkIds: readonly string[]): void;
	/** the "Viewed" box: ticking marks the whole file, unticking clears it */
	setFileViewed(
		fileId: string,
		hunkIds: readonly string[],
		viewed: boolean,
	): void;
	/**
	 * Whether the box should read as ticked, given what the server currently
	 * says. The two differ only for as long as a write is in flight.
	 */
	isFileViewed(fileId: string, serverViewed: boolean): boolean;
	/**
	 * Fold or unfold one file without changing whether it has been read.
	 *
	 * Folding is a view of the desk, not a claim about the work: GitHub lets you
	 * reopen a file you already ticked, and closing one you have not read is
	 * just getting it out of the way.
	 */
	toggleFold(fileId: string, currentlyFolded: boolean): void;
	/** whether this file is currently folded, ticked or not */
	isFolded(fileId: string, viewed: boolean): boolean;
}

const CoverageContext = createContext<CoverageActions | null>(null);

const RETRY_FLUSH_DELAY_MS = 5000;

export interface CoverageProviderProps {
	children: ReactNode;
}

/**
 * Owns the client's coverage knowledge: a local hunk record that dedups what
 * has already been sent, a pending batch flushed through `PUT /api/coverage`,
 * the SSE subscription that folds `coverage.updated` events — our own echoes
 * and other tabs' — into both the record and the session cache's summary, and
 * which files are folded shut.
 *
 * Nothing here infers that a file was read. Coverage used to be fed by an
 * IntersectionObserver, so scrolling past a file counted as reviewing it, and
 * the percentage measured how far down the page you had got rather than what
 * you had actually looked at. The observer is gone; a person ticks a box.
 *
 * The summary shown anywhere in the UI still comes from the server (REQ-007);
 * this provider never computes one.
 */
export function CoverageProvider({ children }: CoverageProviderProps) {
	const { api, events } = useClientContainer();
	const queryClient = useQueryClient();

	const recordRef = useRef(new Map<string, HunkCoverage>());
	const pendingRef = useRef(new Map<string, CoverageUpdateDto["state"]>());
	const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	/** per-file override of the fold-follows-viewed default; absent means follow */
	const [foldOverrides, setFoldOverrides] = useState<
		Readonly<Record<string, boolean>>
	>({});
	/*
	 * What the reader just asked for, held until the server agrees.
	 *
	 * The tick is server-authoritative, and the server is a round trip away. A
	 * box that stays empty until the PUT lands reads as a broken control — the
	 * reader clicks again, and the second click undoes the first. This is the
	 * only optimism in the file, and it is cleared when the write fails, so it
	 * can be briefly ahead of the truth but never quietly wrong about it.
	 */
	const [pendingViewed, setPendingViewed] = useState<
		Readonly<Record<string, boolean>>
	>({});

	const patchSessionSummary = useCallback(
		(summary: CoverageSummaryDto) => {
			queryClient.setQueryData<SessionDto>(SESSION_QUERY_KEY, (session) =>
				session === undefined ? session : { ...session, coverage: summary },
			);
		},
		[queryClient],
	);

	const flush = useCallback(async () => {
		if (retryTimerRef.current !== null) {
			clearTimeout(retryTimerRef.current);
			retryTimerRef.current = null;
		}
		if (pendingRef.current.size === 0) {
			return;
		}
		const batch: CoverageUpdateDto[] = Array.from(
			pendingRef.current,
			([hunkId, state]) => ({ hunkId, state }),
		);
		pendingRef.current.clear();
		try {
			patchSessionSummary(await putCoverage(api, batch));
		} catch (error) {
			console.error("prreview: coverage flush failed, retrying", error);
			// the optimistic tick outlived its warrant: show the server's answer
			// again rather than a box claiming work the server never recorded
			setPendingViewed({});
			for (const update of batch) {
				if (!pendingRef.current.has(update.hunkId)) {
					pendingRef.current.set(update.hunkId, update.state);
				}
			}
			retryTimerRef.current = setTimeout(() => {
				void flush();
			}, RETRY_FLUSH_DELAY_MS);
		}
	}, [api, patchSessionSummary]);

	const queueChanges = useCallback(
		(hunkIds: readonly string[], requested: HunkCoverage) => {
			let queuedAny = false;
			for (const hunkId of hunkIds) {
				const current = recordRef.current.get(hunkId) ?? "unseen";
				const next = applyHunkCoverage(current, requested);
				if (next === current) {
					continue;
				}
				recordRef.current.set(hunkId, next);
				pendingRef.current.set(hunkId, next);
				queuedAny = true;
			}
			return queuedAny;
		},
		[],
	);

	useEffect(
		() =>
			events.subscribe("coverage.updated", (event) => {
				for (const update of event.updates) {
					const current = recordRef.current.get(update.hunkId) ?? "unseen";
					recordRef.current.set(
						update.hunkId,
						applyHunkCoverage(current, update.state),
					);
				}
				patchSessionSummary(event.summary);
			}),
		[events, patchSessionSummary],
	);

	useEffect(
		() => () => {
			if (retryTimerRef.current !== null) {
				clearTimeout(retryTimerRef.current);
			}
		},
		[],
	);

	const actions = useMemo<CoverageActions>(
		() => ({
			markReviewed(hunkIds) {
				if (queueChanges(hunkIds, "reviewed")) {
					void flush();
				}
			},
			setFileViewed(fileId, hunkIds, viewed) {
				setPendingViewed((current) => ({ ...current, [fileId]: viewed }));
				/*
				 * Sent unconditionally, not through the dedup.
				 *
				 * The local record starts empty on every page load while the server
				 * remembers everything, so "unseen → unseen, nothing changed" is
				 * exactly what unticking a file looks like after a reload. Skipping
				 * it there would make the box refuse to clear, silently. The PUT is
				 * idempotent; sending it twice costs nothing worth protecting.
				 */
				const state: HunkCoverage = viewed ? "reviewed" : "unseen";
				for (const hunkId of hunkIds) {
					recordRef.current.set(hunkId, state);
					pendingRef.current.set(hunkId, state);
				}
				if (hunkIds.length > 0) {
					void flush();
				}
			},
			isFileViewed(fileId, serverViewed) {
				return pendingViewed[fileId] ?? serverViewed;
			},
			/*
			 * The caller passes what the reader can see, not what the override map
			 * holds. With no override the fold follows `viewed`, so negating the
			 * absent entry would set a folded-because-viewed file to "folded" —
			 * the chevron would do nothing at all, which is exactly what it did.
			 */
			toggleFold(fileId, currentlyFolded) {
				setFoldOverrides((current) => ({
					...current,
					[fileId]: !currentlyFolded,
				}));
			},
			isFolded(fileId, viewed) {
				return foldOverrides[fileId] ?? viewed;
			},
		}),
		[flush, queueChanges, foldOverrides, pendingViewed],
	);

	return (
		<CoverageContext.Provider value={actions}>
			{children}
		</CoverageContext.Provider>
	);
}

export function useCoverageActions(): CoverageActions {
	const actions = useContext(CoverageContext);
	if (actions === null) {
		throw new Error(
			"useCoverageActions must be used inside a CoverageProvider",
		);
	}
	return actions;
}
