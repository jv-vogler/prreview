import type { FileDiffDto } from "@dto/ChangesetDto";
import type { TopicDto } from "@dto/TopicDto";
import type { FileDiffMetadata } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import { ChevronDownIcon } from "@primer/octicons-react";
import { useMemo, useState } from "react";
import { narrowToHunks } from "../../domain/understanding/narrowToHunks";
import { PIERRE_THEME_NAME } from "../app/WorkerPoolHost";
import { PIERRE_EXCERPT_CHROME_CSS } from "../styling/pierreChromeCss";
import styles from "./TopicBlock.module.css";

/**
 * One topic, told in plain language, with the code that serves it.
 *
 * Two design commitments show up here directly:
 *
 * - **the code is always available, uncapped.** A topic that says "this
 *   reshapes the write path" and then makes you go find the write path has
 *   done half a job. Collapsed by default so the page opens as a readable
 *   table of contents; one click shows every hunk the topic covers.
 * - **repetition under overlap is accepted.** Topic↔hunk is many-to-many, so a
 *   hunk that serves two topics renders under both. Deduplicating would mean
 *   one of the two topics silently missing its own evidence, which is worse
 *   than seeing the same eight lines twice.
 *
 * Every block is keyed composite (`${topicId}:${path}`) — never by hunk alone,
 * which would collide the moment two topics share one.
 */

export interface TopicBlockProps {
	topic: TopicDto;
	/** the fraction of the whole change this topic covers, in [0, 1] */
	coverage: number;
	/** parsed Pierre metadata by path, from the changeset's patch text */
	parsedByPath: Map<string, FileDiffMetadata>;
	/** the changeset's files by path, for resolving hunk ids to indices */
	filesByPath: Map<string, FileDiffDto>;
	defaultOpen?: boolean;
}

const PERCENT = 100;

export function TopicBlock({
	topic,
	coverage,
	parsedByPath,
	filesByPath,
	defaultOpen = false,
}: TopicBlockProps) {
	const [open, setOpen] = useState(defaultOpen);

	const excerpts = useMemo(
		() => buildExcerpts(topic, parsedByPath, filesByPath),
		[topic, parsedByPath, filesByPath],
	);

	const percent = Math.round(coverage * PERCENT);

	return (
		<section
			className={styles.topic}
			data-topic-id={topic.id}
			data-open={open ? "true" : "false"}
		>
			<header className={styles.header}>
				<button
					type="button"
					className={styles.disclosure}
					aria-expanded={open}
					data-topic-toggle={topic.id}
					onClick={() => setOpen((current) => !current)}
				>
					{/* one chevron that turns; two glyphs swapping cannot be eased */}
					<span aria-hidden="true" className={styles.caret}>
						<ChevronDownIcon size={16} />
					</span>
					<span className={styles.title}>{topic.title}</span>
				</button>
				<div className={styles.meta}>
					<span className={styles.kind} data-kind={topic.kind}>
						{topic.kind}
					</span>
					<span className={styles.coverage}>
						covers ~{percent}% of the change
					</span>
				</div>
				<p className={styles.summary}>{topic.summary}</p>
			</header>

			{/*
				The code stays mounted whether the topic is open or not, and the
				block opens by growing rather than by appearing.

				Mounting it always is what makes the animation possible at all: a
				height cannot be eased from nothing, because there is no height to
				ease from until the content exists. It is affordable because the
				renderer materializes only what is on screen — Spike 7 measured 48
				blocks mounted and expanded at 147 DOM nodes, 9.5 MB, and no long
				tasks — and a collapsed block, being zero pixels tall, materializes
				none of them.
			*/}
			<div
				className={styles.excerptsClip}
				data-topic-code={topic.id}
				// clipped to nothing is not the same as gone: without this, a
				// screen reader would read out the code of every collapsed topic
				// on the page, and Tab would visit controls nobody can see
				inert={!open}
			>
				<div className={styles.excerpts}>
					{excerpts.length === 0 ? (
						<p className={styles.empty}>
							This topic names no code in this round.
						</p>
					) : (
						excerpts.map((excerpt) => (
							<div
								key={`${topic.id}:${excerpt.path}`}
								className={styles.excerpt}
								data-block-key={`${topic.id}:${excerpt.path}`}
							>
								<FileDiff
									fileDiff={excerpt.fileDiff}
									options={{
										theme: PIERRE_THEME_NAME,
										diffStyle: "unified",
										hunkSeparators: "line-info",
										stickyHeader: false,
										unsafeCSS: PIERRE_EXCERPT_CHROME_CSS,
										// deliberately no loadDiffFiles: the gaps between a
										// topic's hunks stay collapsed and unexpandable, so a
										// block is a curated excerpt rather than a doorway back
										// into the whole file
									}}
								/>
							</div>
						))
					)}
				</div>
			</div>
		</section>
	);
}

interface Excerpt {
	path: string;
	fileDiff: FileDiffMetadata;
}

/**
 * Resolves a topic's refs into narrowed Pierre metadata, one per file.
 *
 * A ref naming hunk ids shows exactly those hunks; a ref with none — or with
 * ids this round no longer has — shows the whole file, which is the same
 * honest fallback the sizing arithmetic uses. Refs to the same file are merged
 * so one file yields one excerpt rather than three stacked ones.
 */
function buildExcerpts(
	topic: TopicDto,
	parsedByPath: Map<string, FileDiffMetadata>,
	filesByPath: Map<string, FileDiffDto>,
): Excerpt[] {
	const indicesByPath = new Map<string, Set<number> | "whole">();

	for (const ref of topic.refs) {
		const file = filesByPath.get(ref.path);
		if (file === undefined) {
			continue;
		}
		if (indicesByPath.get(ref.path) === "whole") {
			continue;
		}
		if (ref.hunkIds.length === 0) {
			indicesByPath.set(ref.path, "whole");
			continue;
		}
		const wanted = new Set(ref.hunkIds);
		const indices = file.hunks.flatMap((hunk, index) =>
			wanted.has(hunk.id) ? [index] : [],
		);
		if (indices.length === 0) {
			indicesByPath.set(ref.path, "whole");
			continue;
		}
		const existing = indicesByPath.get(ref.path);
		const merged =
			existing === undefined || existing === "whole"
				? new Set<number>()
				: existing;
		for (const index of indices) {
			merged.add(index);
		}
		indicesByPath.set(ref.path, merged);
	}

	const excerpts: Excerpt[] = [];
	for (const [path, indices] of indicesByPath) {
		const parsed = parsedByPath.get(path);
		if (parsed === undefined) {
			continue;
		}
		excerpts.push({
			path,
			fileDiff:
				indices === "whole" ? parsed : narrowToHunks(parsed, [...indices]),
		});
	}
	return excerpts;
}
