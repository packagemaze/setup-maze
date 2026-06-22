# setup-maze

GitHub Action that installs the PackageMaze `maze` CLI from
[`packagemaze/maze-cli`](https://github.com/packagemaze/maze-cli) releases.

By default, setup-maze only installs the CLI and adds it to `PATH`.

```yaml
permissions:
  contents: read

steps:
  - uses: packagemaze/setup-maze@v0.0.2
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
    uses: packagemaze/setup-maze@v0.0.2
    with:
      feed: <organization>/<feed>
      purpose: install

  # Assumes your project .npmrc points the registry at PackageMaze.
  - run: npm ci
    env:
      NODE_AUTH_TOKEN: ${{ steps.maze.outputs.token }}
```

Publish tokens can include the package name:

```yaml
permissions:
  contents: read
  id-token: write

steps:
  - id: maze
    uses: packagemaze/setup-maze@v0.0.2
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
    uses: packagemaze/setup-maze@v0.0.2
    with:
      feed: <organization>/<feed>

  - run: pip install -r requirements.txt
    env:
      PIP_INDEX_URL: https://__token__:${{ steps.maze.outputs.token }}@pkg.packagemaze.com/<organization>/<feed>/simple/
```

setup-maze does not configure package clients. Keep `.npmrc`, npm/pnpm/yarn/bun
settings, pip/uv/Poetry index settings, and any workflow environment for package
clients in your project workflow or repository configuration.

## Inputs

| Name | Default | Description |
| --- | --- | --- |
| `version` | `v0.0.1` | PackageMaze CLI release tag to install. Use `latest` for the latest release. |
| `repository` | `packagemaze/maze-cli` | GitHub repository that publishes maze CLI release assets. |
| `install-dir` | runner temp directory | Directory where the maze binary is installed. |
| `release-base-url` | release URL for `version` | Override release asset base URL for tests and mirrors. |
| `feed` | unset | PackageMaze Feed in `org/feed` form. When omitted, setup-maze only installs `maze`. |
| `purpose` | `install` | Token purpose passed to `maze auth exchange-oidc`. |
| `package` | unset | Package name for publish tokens. Only valid with `purpose: publish`. |

## Outputs

| Name | Description |
| --- | --- |
| `binary` | Installed maze binary path. |
| `path` | Directory added to `PATH`. |
| `token` | PackageMaze token when `feed` is set. The CLI writes the GitHub output and masks the token. |

Published CLI binaries currently cover Linux x64, Linux ARM64, and macOS ARM64.
Windows is not supported yet.
