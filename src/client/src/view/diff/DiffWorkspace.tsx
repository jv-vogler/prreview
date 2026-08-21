import type { BlobRequest } from "@dto/BlobRequest";
import type { ChangesetDto, FileDiffDto } from "@dto/ChangesetDto";
import type {
	CodeViewDiffItem,
	FileDiffLoadedFiles,
	FileDiffMetadata,
} from "@pierre/diffs";
import { parsePatchFiles } from "@pierre/diffs";
import type { CodeViewHandle } from "@pierre/diffs/react";
import { CodeView } from "@pierre/diffs/react";
import { useCallback, useMemo, useRef } from "react";
import { blobSidesFor } from "../../domain/changeset/blobSidesFor";
import { buildPatchText } from "../../domain/changeset/buildPatchText";
import { getBlob } from "../../infrastructure/endpoints/getBlob";
import type { ApiClient } from "../../infrastructure/httpClients/apiClient";
import { HIGHLIGHTER, PIERRE_THEME_NAME } from "../app/WorkerPoolHost";
import { PIERRE_DIFF_CHROME_CSS } from "../styling/pierreChromeCss";
import styles from "./DiffWorkspace.module.css";
import { FileFoldChevron } from "./FileFoldChevron";
import { useHeaderFoldClicks } from "./useHeaderFoldClicks";

export interface DiffWorkspaceHandle {
	scrollToFile(fileId: string): void;
}

export interface DiffWorkspaceProps {
	api: ApiClient;
	changeset: ChangesetDto;
	/** files without hunks (binary, mode-only, pure renames) have no rows to render */
	renderedFiles: readonly FileDiffDto[];
	foldedFileIds: ReadonlySet<string>;
	onToggleFold(fileId: string): void;
	handleRef: React.RefObject<DiffWorkspaceHandle | null>;
}

/** The one screen's renderer: Pierre's virtualized CodeView over the resolved changeset. */
export function DiffWorkspace({
	api,
	changeset,
	renderedFiles,
	foldedFileIds,
	onToggleFold,
	handleRef,
}: DiffWorkspaceProps) {
	const codeViewRef = useRef<CodeViewHandle<undefined>>(null);
	const containerRef = useRef<HTMLDivElement>(null);

	const cacheKeyPrefix = `${changeset.ref.baseSha}-${changeset.ref.headSha ?? "worktree"}`;

	const items = useMemo<CodeViewDiffItem<undefined>[]>(() => {
		const parsed = parsePatchFiles(
			buildPatchText(renderedFiles),
			cacheKeyPrefix,
		);
		const parsedFiles = parsed[0]?.files ?? [];
		return renderedFiles.flatMap((file, index) => {
			const fileDiff = parsedFiles[index];
			if (fileDiff === undefined || fileDiff.name !== file.path) {
				console.error(
					`prreview: patch round-trip mismatch for ${file.path}; file skipped`,
				);
				return [];
			}
			const collapsed = foldedFileIds.has(file.id);
			return [
				{
					id: file.id,
					type: "diff" as const,
					fileDiff,
					// the renderer reuses a file's rendered record until this number
					// moves, so a fold that is not in the version is a fold that
					// does not happen
					version: collapsed ? 1 : 0,
					collapsed,
				},
			];
		});
	}, [renderedFiles, cacheKeyPrefix, foldedFileIds]);

	const filesByPath = useMemo(
		() => new Map(renderedFiles.map((file) => [file.path, file])),
		[renderedFiles],
	);
	const filesById = useMemo(
		() => new Map(renderedFiles.map((file) => [file.id, file])),
		[renderedFiles],
	);

	const loadDiffFiles = useCallback(
		async (metadata: FileDiffMetadata): Promise<FileDiffLoadedFiles> => {
			const file = filesByPath.get(metadata.name);
			if (file === undefined) {
				throw new Error(`unknown file requested by renderer: ${metadata.name}`);
			}
			const sides = blobSidesFor(file, changeset.ref);
			const [oldFile, newFile] = await Promise.all([
				loadSide(sides.oldSide, file.oldPath ?? file.path),
				loadSide(sides.newSide, file.path),
			]);
			return { oldFile, newFile };

			async function loadSide(side: BlobRequest | null, name: string) {
				// an absent side IS the full contents: added files have an empty
				// old side, deleted files an empty new side
				if (side === null) {
					return { name, contents: "" };
				}
				const blob = await getBlob(api, side);
				return { name: blob.name, contents: blob.contents };
			}
		},
		[api, filesByPath, changeset.ref],
	);

	useHeaderFoldClicks(containerRef, onToggleFold);

	handleRef.current = {
		scrollToFile: (fileId) => {
			codeViewRef.current?.scrollTo({
				type: "item",
				id: fileId,
				align: "start",
				behavior: "instant",
			});
		},
	};

	return (
		<CodeView<undefined>
			ref={codeViewRef}
			containerRef={containerRef}
			items={items}
			className={styles.codeView}
			// the far-left slot, immediately before the change-type icon
			renderHeaderPrefix={(item) => {
				const file = filesById.get(item.id);
				if (file === undefined) {
					return null;
				}
				return (
					<FileFoldChevron
						fileId={file.id}
						path={file.path}
						folded={foldedFileIds.has(file.id)}
						onToggle={onToggleFold}
					/>
				);
			}}
			options={{
				theme: PIERRE_THEME_NAME,
				diffStyle: "unified",
				loadDiffFiles,
				hunkSeparators: "line-info",
				stickyHeaders: true,
				unsafeCSS: PIERRE_DIFF_CHROME_CSS,
				preferredHighlighter: HIGHLIGHTER.preferredHighlighter,
			}}
		/>
	);
}
