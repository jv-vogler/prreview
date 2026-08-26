import type { ChangesetId } from "../../domain/changeset/ChangesetId";
import type { StoredReview } from "../../domain/pass/StoredReview";

export interface SessionStore {
	loadReview(changesetId: ChangesetId): Promise<StoredReview | null>;
	saveReview(review: StoredReview): Promise<void>;
	ensureExcluded(gitCommonDir: string): Promise<void>;
	flush(): Promise<void>;
}
