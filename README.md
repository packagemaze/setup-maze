# setup-maze

GitHub Action that installs the PackageMaze `maze` CLI.

```yaml
steps:
  - uses: packagemaze/setup-maze@v0.0.1
  - run: maze auth exchange-oidc --feed <organization>/<feed> --purpose install
```

Published binaries currently cover Linux x64, Linux ARM64, and macOS ARM64.
Windows is not supported yet.
