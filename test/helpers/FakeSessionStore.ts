import type { SessionStore } from "../../src/application/ports/SessionStore";
import type { StoredReview } from "../../src/domain/pass/StoredReview";

export class FakeSessionStore implements SessionStore {
	saved: StoredReview[] = [];
	private readonly byChangesetId = new Map<string, StoredReview>();

	async loadReview(changesetId: string): Promise<StoredReview | null> {
		return this.byChangesetId.get(changesetId) ?? null;
	}

	async saveReview(review: StoredReview): Promise<void> {
		this.saved.push(review);
		this.byChangesetId.set(review.changesetId, review);
	}

	async ensureExcluded(): Promise<void> {}

	async flush(): Promise<void> {}
}
