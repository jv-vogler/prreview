import { CheckIcon, CopyIcon } from "@primer/octicons-react";
import { useEffect, useState } from "react";
import styles from "./CopyPathButton.module.css";

const COPIED_FEEDBACK_MS = 1200;
const ICON_SIZE = 14;

export interface CopyPathButtonProps {
	path: string;
}

export function CopyPathButton({ path }: CopyPathButtonProps) {
	const [copied, setCopied] = useState(false);

	useEffect(() => {
		if (!copied) {
			return;
		}
		const timer = setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
		return () => clearTimeout(timer);
	}, [copied]);

	return (
		<button
			type="button"
			className={styles.copy}
			data-copy-path={path}
			data-copied={copied ? "true" : undefined}
			aria-label={copied ? `Copied ${path}` : `Copy ${path}`}
			onClick={() => {
				navigator.clipboard.writeText(path).then(
					() => setCopied(true),
					() => {},
				);
			}}
		>
			{copied ? <CheckIcon size={ICON_SIZE} /> : <CopyIcon size={ICON_SIZE} />}
		</button>
	);
}
