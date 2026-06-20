# setup-maze

GitHub Action that installs the PackageMaze `maze` CLI.

```yaml
permissions:
  contents: read
  id-token: write

steps:
  - uses: packagemaze/setup-maze@v0.0.1
  - id: packagemaze
    run: maze auth exchange-oidc --feed <organization>/<feed> --purpose install --format github-output
  - run: npm ci
    env:
      NODE_AUTH_TOKEN: ${{ steps.packagemaze.outputs.token }}
```

Published binaries currently cover Linux x64, Linux ARM64, and macOS ARM64.
Windows is not supported yet.
