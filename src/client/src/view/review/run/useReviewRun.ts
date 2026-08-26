import type { PassFreshnessDto, ReviewPassDto } from "@dto/ReviewDto";
import type { ReviewStatusDto, RunDto } from "@dto/RunDto";
import { serverEventSchema } from "@dto/ServerEvent";
import { useCallback, useEffect, useState } from "react";
import type { PostReviewOptions } from "../../../infrastructure/endpoints/reviewRun";
import {
	cancelReviewRun,
	getReviewRun,
	postReviewRun,
} from "../../../infrastructure/endpoints/reviewRun";
import type { ApiClient } from "../../../infrastructure/httpClients/apiClient";

const POLL_MS = 8_000;
const LIVE_STATUSES = new Set(["queued", "running"]);

export interface ReviewRunState {
	run: RunDto | null;
	starting: boolean;
	startError: string | null;
	pass: ReviewPassDto | null;
	freshness: PassFreshnessDto | null;
	applyPass(pass: ReviewPassDto): void;
	applyStatus(status: ReviewStatusDto): void;
	start(options?: PostReviewOptions): void;
	cancel(): void;
}

export function useReviewRun(api: ApiClient): ReviewRunState {
	const [run, setRun] = useState<RunDto | null>(null);
	const [pass, setPass] = useState<ReviewPassDto | null>(null);
	const [freshness, setFreshness] = useState<PassFreshnessDto | null>(null);
	const [starting, setStarting] = useState(false);
	const [startError, setStartError] = useState<string | null>(null);

	const refetch = useCallback(() => {
		getReviewRun(api).then((status) => {
			setRun(status.run);
			setPass(status.pass);
			setFreshness(status.freshness);
		}, noop);
	}, [api]);

	useEffect(() => {
		refetch();
	}, [refetch]);

	useEffect(() => {
		const source = new EventSource("/api/events");
		source.onmessage = (event) => {
			const parsed = serverEventSchema.safeParse(JSON.parse(event.data));
			if (!parsed.success || parsed.data.type === "heartbeat") {
				return;
			}
			setRun(parsed.data.run);
			if (parsed.data.type === "run.succeeded") {
				refetch();
			}
		};
		return () => source.close();
	}, [refetch]);

	const runStatus = run?.status;
	useEffect(() => {
		if (runStatus === undefined || !LIVE_STATUSES.has(runStatus)) {
			return;
		}
		const timer = setInterval(refetch, POLL_MS);
		return () => clearInterval(timer);
	}, [runStatus, refetch]);

	const applyStatus = useCallback((status: ReviewStatusDto) => {
		setRun(status.run);
		setPass(status.pass);
		setFreshness(status.freshness);
	}, []);

	const start = useCallback(
		(options: PostReviewOptions = {}) => {
			setStarting(true);
			setStartError(null);
			postReviewRun(api, options).then(
				(result) => {
					setStarting(false);
					if (result.kind === "conflict") {
						setStartError(result.message);
					}
				},
				(error: unknown) => {
					setStarting(false);
					setStartError(error instanceof Error ? error.message : String(error));
				},
			);
		},
		[api],
	);

	const cancel = useCallback(() => {
		void cancelReviewRun(api);
	}, [api]);

	return {
		run,
		pass,
		freshness,
		applyPass: setPass,
		applyStatus,
		starting,
		startError,
		start,
		cancel,
	};
}

function noop(): void {}
