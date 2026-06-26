# setup-maze

GitHub Action that installs the PackageMaze `maze` CLI from
[`packagemaze/maze-cli`](https://github.com/packagemaze/maze-cli) releases.

By default, setup-maze only installs the CLI and adds it to `PATH`.

```yaml
permissions:
  contents: read

steps:
  - uses: packagemaze/setup-maze@v0.0.3
  - run: maze version
```

If your workflow needs PackageMaze access, pass a Feed to request a token during
setup. The action exposes that token as `steps.<id>.outputs.token`. Your
project or workflow still owns npm, pnpm, yarn, bun, pip, uv, and Poetry
configuration.

```yaml
permissions:
  contents: read
  id-token: write

steps:
  - id: maze
    uses: packagemaze/setup-maze@v0.0.3
    with:
      feed: <organization>/<feed>
      purpose: install

  # Assumes your project .npmrc points the registry at PackageMaze.
  - run: npm ci
    env:
      NODE_AUTH_TOKEN: ${{ steps.maze.outputs.token }}
```

Docker image builds use the same one-token-per-step model, but setup-maze
packages the token as a BuildKit secret bundle instead of exposing a plain token
output. Use one setup-maze step for the Docker build Feed and mount the
generated secret only for the package-client `RUN` instruction. The generated
package-client config uses the Feed Base URL returned by PackageMaze during
token exchange. Install and publish access rules do not cover Docker image
build tokens; configure a separate PackageMaze GitHub Actions access rule with
`purpose: docker-build` for the Feed.

```yaml
permissions:
  contents: read
  id-token: write

steps:
  - uses: actions/checkout@v6

  - id: maze-docker
    uses: packagemaze/setup-maze@v0.0.3
    with:
      feed: <organization>/<feed>
      purpose: docker-build

  - uses: docker/build-push-action@v7
    with:
      context: .
      file: Dockerfile
      secret-files: ${{ steps.maze-docker.outputs.secret_files }}

  - if: always()
    run: rm -f "$PACKAGE_MAZE_DOCKER_SECRET"
    env:
      PACKAGE_MAZE_DOCKER_SECRET: ${{ steps.maze-docker.outputs.secret_path }}
```

```dockerfile
# syntax=docker/dockerfile:1.7
RUN --mount=type=secret,id=packagemaze_npm \
    . /run/secrets/packagemaze_npm && pnpm install --frozen-lockfile
```

For PyPI Feeds, mount `packagemaze_pypi`:

```dockerfile
# syntax=docker/dockerfile:1.7
RUN --mount=type=secret,id=packagemaze_pypi \
    . /run/secrets/packagemaze_pypi && pip install -r requirements.txt
```

The generated PyPI bundle also exports pip and `uv pip` index settings for the
same PackageMaze Feed during that `RUN` instruction. Docker bundles do not
expose a generic `MAZE_TOKEN` environment variable.

After sourcing a generated Docker bundle, let that bundle own package-client
configuration for the `RUN`. Do not reset its exported config environment
variables or pass registry/index/config flags such as `--userconfig`,
`--registry`, `--@scope:registry`, `--index-url`, `--extra-index-url`,
`--default-index`, `--index`, `--no-index`, or `--find-links`.

Docker bundles currently complete npm/pnpm installs for npm Feeds and pip or
`uv pip` installs for PyPI Feeds. `uv sync`, Yarn, Bun, Poetry, and PDM Docker
installs need first-class bundle support before PackageMaze can treat them as
complete.

If one Docker build needs multiple PackageMaze Feeds, keep one setup-maze step
per Feed and list each `secret_files` output directly under the same
`secret-files: |` block:

```yaml
- id: maze-npm-docker
  uses: packagemaze/setup-maze@v0.0.3
  with:
    feed: <organization>/<npm-feed>
    purpose: docker-build
- id: maze-pypi-docker
  uses: packagemaze/setup-maze@v0.0.3
  with:
    feed: <organization>/<pypi-feed>
    purpose: docker-build
- uses: docker/build-push-action@v7
  with:
    context: .
    file: Dockerfile
    secret-files: |
      ${{ steps.maze-npm-docker.outputs.secret_files }}
      ${{ steps.maze-pypi-docker.outputs.secret_files }}
```

If one Dockerfile `RUN` sources more than one generated bundle, setup-maze uses
shared cleanup so every tokenized temp config is removed before that layer is
committed.
After the Docker build, remove each setup-maze step's runner-side `secret_path`
output.

For target-specific Docker builds, PackageMaze review currently fails closed
because it cannot prove which Dockerfile stages are reached. To be review-ready,
either use a non-target build or pass all generated bundle outputs required
anywhere in that Dockerfile to each target-specific build.

If one Docker build needs two Feeds that use the same Artifact Protocol, keep
one setup-maze step per Feed and give each step a distinct lowercase,
protocol-matched `secret-id`, such as `packagemaze_npm_web` and
`packagemaze_npm_admin`. Use those ids in the matching Dockerfile mounts.

Publish tokens require the Feed and package name:

```yaml
permissions:
  contents: read
  id-token: write

steps:
  - id: maze
    uses: packagemaze/setup-maze@v0.0.3
    with:
      feed: <organization>/<feed>
      purpose: publish
      package: <package-name>

  - run: npm publish
    env:
      NODE_AUTH_TOKEN: ${{ steps.maze.outputs.token }}
```

Python package workflows can use the same token output with project-owned pip,
uv, or Poetry configuration:

```yaml
permissions:
  contents: read
  id-token: write

steps:
  - id: maze
    uses: packagemaze/setup-maze@v0.0.3
    with:
      feed: <organization>/<feed>

  - run: pip install -r requirements.txt
    env:
      PIP_INDEX_URL: https://__token__:${{ steps.maze.outputs.token }}@pkg.packagemaze.com/<organization>/<feed>/simple/
```

Outside `purpose: docker-build`, setup-maze does not configure package clients.
Keep `.npmrc`, npm/pnpm/yarn/bun settings, pip/uv/Poetry index settings, and
any workflow environment for package clients in your project workflow or
repository configuration.

## Inputs

| Name               | Default                   | Description                                                                                                                                                                                          |
| ------------------ | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `version`          | `v0.0.2`                  | PackageMaze CLI release tag to install. Use `latest` for the latest release.                                                                                                                         |
| `repository`       | `packagemaze/maze-cli`    | GitHub repository that publishes maze CLI release assets.                                                                                                                                            |
| `install-dir`      | runner temp directory     | Directory where the maze binary is installed.                                                                                                                                                        |
| `release-base-url` | release URL for `version` | Override release asset base URL for tests and mirrors.                                                                                                                                               |
| `feed`             | unset                     | PackageMaze Feed in `org/feed` form. When omitted, setup-maze only installs `maze`.                                                                                                                  |
| `purpose`          | `install`                 | Token purpose passed to `maze auth exchange-oidc`.                                                                                                                                                   |
| `package`          | unset                     | Package name for publish tokens. Required with `purpose: publish`.                                                                                                                                   |
| `secret-id`        | protocol default          | Optional Docker BuildKit bundle id for `purpose: docker-build`. Use a lowercase protocol-matched id only when one Docker build needs multiple same-protocol Feeds; do not include a `token` segment. |

## Outputs

| Name           | Description                                                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `binary`       | Installed maze binary path.                                                                                                     |
| `path`         | Directory added to `PATH`.                                                                                                      |
| `token`        | PackageMaze token for non-Docker package-client steps when `feed` is set. The CLI writes the GitHub output and masks the token. |
| `secret_files` | `docker/build-push-action` `secret-files` value for `purpose: docker-build`.                                                    |
| `secret_args`  | `docker buildx build --secret` arguments for `purpose: docker-build`.                                                           |
| `secret_id`    | BuildKit secret id to mount in Dockerfile for `purpose: docker-build`.                                                          |
| `secret_path`  | Runner-temp secret bundle path for cleanup after the Docker build.                                                              |

Use `secret_args` directly in the `run:` command, for example
`docker buildx build ${{ steps.maze-docker.outputs.secret_args }} .`. Do not
copy it into an environment variable first; shell quoting inside a variable is
not re-parsed.

Published CLI binaries currently cover Linux x64, Linux ARM64, and macOS ARM64.
Windows is not supported yet.
