import type { ChangesetSourceDto } from "@dto/ChangesetDto";
import { LinkExternalIcon, MarkGithubIcon } from "@primer/octicons-react";
import styles from "./ChangesetHeading.module.css";

export interface ChangesetHeadingProps {
	source: ChangesetSourceDto;
	resolved: string;
	overrideHint: string;
	prUrl?: string;
}

export function ChangesetHeading({
	source,
	resolved,
	overrideHint,
	prUrl,
}: ChangesetHeadingProps) {
	return (
		<div className={styles.block}>
			<div className={styles.titleRow}>
				<h1 className={styles.title}>
					<Subject source={source} resolved={resolved} prUrl={prUrl} />
				</h1>
				{prUrl !== undefined && <ViewOnGithubLink href={prUrl} />}
			</div>
			<p className={styles.overrideHint}>{overrideHint}</p>
		</div>
	);
}

function Subject({
	source,
	resolved,
	prUrl,
}: Pick<ChangesetHeadingProps, "source" | "resolved" | "prUrl">) {
	if (source.kind !== "pr") {
		return <>{capitalize(resolved)}</>;
	}
	return (
		<>
			<span className={styles.repo}>{source.repo}</span>
			<span className={styles.separator} aria-hidden="true">
				·
			</span>
			<span className={styles.prRef}>
				PR <PrNumber number={source.number} href={prUrl} />
			</span>
		</>
	);
}

function PrNumber({ number, href }: { number: number; href?: string }) {
	const label = `#${number}`;
	if (href === undefined) {
		return <span className={styles.prNumber}>{label}</span>;
	}
	return (
		<a
			className={styles.prNumberLink}
			href={href}
			target="_blank"
			rel="noreferrer"
		>
			{label}
		</a>
	);
}

const GITHUB_MARK_SIZE = 16;
const EXTERNAL_LINK_ICON_SIZE = 12;

function ViewOnGithubLink({ href }: { href: string }) {
	return (
		<a className={styles.prLink} href={href} target="_blank" rel="noreferrer">
			<MarkGithubIcon size={GITHUB_MARK_SIZE} />
			View on GitHub
			<LinkExternalIcon size={EXTERNAL_LINK_ICON_SIZE} />
		</a>
	);
}

function capitalize(text: string): string {
	return text.length === 0 ? text : text[0].toUpperCase() + text.slice(1);
}
