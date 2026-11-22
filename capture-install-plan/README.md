# Capture a native install plan

Run this optional step in a trusted GitHub Actions job after checkout, client setup, and a successful PackageMaze install sign-in. Give the job `contents: read` and `id-token: write`. Use the Organization ID and Project number for the selected Project.

```yaml
- uses: packagemaze/setup-maze/capture-install-plan@COMMIT_SHA
  with:
    organization: org_0123456789abcdef0123456789abcdef
    project: 7
    feed: example/python
    client: uv
    project-path: packages/widget
    lock: uv.lock
    profile: '{"groups":["docs"]}'
```

Replace `COMMIT_SHA` with the full revision of setup-maze that you reviewed. The capture step supports uv, pip, Poetry, PDM and npm when the client can report a complete plan for the selected profile. The `manifest` input can select a committed requirements file.

The Action checks out the Run commit in a fresh directory, runs the installed client in an environment without inherited CI credentials, then asks GitHub to sign the destination and report digest. The PackageMaze Run shows the receipt when its committed Project and governing inputs have been read. A failed native command records a failed plan. Unsupported or incomplete reports stop capture. A plan describes the client's dry-run decisions for that environment. Native metadata processing can execute repository or package code. Use a trusted workflow and source revision.
