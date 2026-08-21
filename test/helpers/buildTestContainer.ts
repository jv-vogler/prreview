import {
	buildContainer,
	type Container,
	type ContainerOverrides,
} from "../../src/container";

const TEST_REPO_ROOT = "/repo";

/**
 * The fake-injection seam (CON-013): tests build the real container with
 * whichever services they want to fake, rather than mocking modules.
 */
export function buildTestContainer(
	overrides: ContainerOverrides = {},
): Container {
	return buildContainer({ repoRoot: TEST_REPO_ROOT }, overrides);
}
