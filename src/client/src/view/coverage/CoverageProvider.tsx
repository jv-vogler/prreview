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
} from "react";
import type { HunkCoverage } from "../../domain/coverage/HunkCoverage";
import { upgradeHunkCoverage } from "../../domain/coverage/upgradeHunkCoverage";
import { putCoverage } from "../../infrastructure/endpoints/putCoverage";
import { useClientContainer } from "../app/ClientContainerProvider";
import { SESSION_QUERY_KEY } from "../session/useGuaranteedSession";

export interface CoverageActions {
	/** IntersectionObserver feed: batched, debounced PUT (TASK-048) */
	markViewed(hunkIds: readonly string[]): void;
	/** `v`/`m` keys: flushed immediately so the ring answers the keystroke */
	markReviewed(hunkIds: readonly string[]): void;
}

const CoverageContext = createContext<CoverageActions | null>(null);

const VIEWED_FLUSH_DELAY_MS = 800;
const RETRY_FLUSH_DELAY_MS = 5000;

export interface CoverageProviderProps {
	children: ReactNode;
}

/**
 * Owns the client's coverage knowledge: a local hunk record (upgrade-only,
 * mirroring the server's monotonic rule) that dedups what has already been
 * sent, a pending batch flushed through `PUT /api/coverage`, and the SSE
 * subscription that folds `coverage.updated` events — our own echoes and
 * other tabs' — into both the record and the session cache's summary.
 * The summary shown anywhere in the UI always comes from the server
 * (REQ-007); this provider never computes one.
 */
export function CoverageProvider({ children }: CoverageProviderProps) {
	const { api, events } = useClientContainer();
	const queryClient = useQueryClient();

	const recordRef = useRef(new Map<string, HunkCoverage>());
	const pendingRef = useRef(new Map<string, CoverageUpdateDto["state"]>());
	const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const patchSessionSummary = useCallback(
		(summary: CoverageSummaryDto) => {
			queryClient.setQueryData<SessionDto>(SESSION_QUERY_KEY, (session) =>
				session === undefined ? session : { ...session, coverage: summary },
			);
		},
		[queryClient],
	);

	const flush = useCallback(async () => {
		if (flushTimerRef.current !== null) {
			clearTimeout(flushTimerRef.current);
			flushTimerRef.current = null;
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
			for (const update of batch) {
				if (!pendingRef.current.has(update.hunkId)) {
					pendingRef.current.set(update.hunkId, update.state);
				}
			}
			flushTimerRef.current = setTimeout(() => {
				void flush();
			}, RETRY_FLUSH_DELAY_MS);
		}
	}, [api, patchSessionSummary]);

	const queueUpgrades = useCallback(
		(hunkIds: readonly string[], requested: "viewed" | "reviewed") => {
			let queuedAny = false;
			for (const hunkId of hunkIds) {
				const current = recordRef.current.get(hunkId) ?? "unseen";
				const upgraded = upgradeHunkCoverage(current, requested);
				if (upgraded === current) {
					continue;
				}
				recordRef.current.set(hunkId, upgraded);
				pendingRef.current.set(hunkId, upgraded as "viewed" | "reviewed");
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
						upgradeHunkCoverage(current, update.state),
					);
				}
				patchSessionSummary(event.summary);
			}),
		[events, patchSessionSummary],
	);

	useEffect(
		() => () => {
			if (flushTimerRef.current !== null) {
				clearTimeout(flushTimerRef.current);
			}
		},
		[],
	);

	const actions = useMemo<CoverageActions>(
		() => ({
			markViewed(hunkIds) {
				if (!queueUpgrades(hunkIds, "viewed")) {
					return;
				}
				if (flushTimerRef.current === null) {
					flushTimerRef.current = setTimeout(() => {
						void flush();
					}, VIEWED_FLUSH_DELAY_MS);
				}
			},
			markReviewed(hunkIds) {
				if (!queueUpgrades(hunkIds, "reviewed")) {
					return;
				}
				void flush();
			},
		}),
		[flush, queueUpgrades],
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
