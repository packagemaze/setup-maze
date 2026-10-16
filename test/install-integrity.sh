#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
test_root="$(mktemp -d)"
trap 'rm -rf "$test_root"' EXIT
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
sha256() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1"; else sha256sum "$1"; fi | awk '{print $1}'
}
mkdir -p "${test_root}/release"
cat > "${test_root}/maze" <<'FIXTURE'
#!/usr/bin/env bash
printf 'executed\n' > "$EXECUTION_MARKER"
printf 'maze fixture\n'
FIXTURE
chmod 0755 "${test_root}/maze"
package_fixture() {
  tar -czf "${test_root}/release/maze_linux_amd64.tar.gz" -C "$test_root" maze
  printf '%s  maze_linux_amd64.tar.gz\n' "$(sha256 "${test_root}/release/maze_linux_amd64.tar.gz")" > "${test_root}/release/maze_checksums.txt"
}
package_fixture
trusted_digest="$(sha256 "${test_root}/release/maze_linux_amd64.tar.gz")"
install_script="${test_root}/install.sh"
awk '
  /^    - id: install$/ { selected=1; next }
  selected && /^      run: \|$/ { body=1; next }
  body && /^    - / { exit }
  body { sub(/^        /, ""); print }
' "${repo_root}/action.yml" > "$install_script"
[ -s "$install_script" ] || fail 'could not extract the actual action installer'
run_installer() {
  env RUNNER_OS=Linux RUNNER_ARCH=X64 RUNNER_TEMP="$test_root" \
    REQUESTED_INSTALL_DIR="$1/bin" RELEASE_BASE_URL="file://${test_root}/release" \
    VERSION="$2" REPOSITORY="$3" ARCHIVE_SHA256="$4" \
    GITHUB_PATH="$1/continuation" GITHUB_OUTPUT="$1/output" \
    EXECUTION_MARKER="${test_root}/executed" bash "$install_script"
}

check_case() {
  local label="$1" expected_status="$2" version="$3" repository="$4" digest="$5"
  local case_dir="${test_root}/${label}"
  mkdir -p "${case_dir}/bin"
  printf 'existing binary\n' > "${case_dir}/bin/maze"
  printf '# existing continuation\n' > "${case_dir}/continuation"
  cp "${case_dir}/continuation" "${case_dir}/output"
  rm -f "${test_root}/executed"
  if run_installer "$case_dir" "$version" "$repository" "$digest" > "${case_dir}/log" 2>&1; then
    [ "$expected_status" = success ] || fail "$label accepted untrusted bytes"
    [ -f "${test_root}/executed" ] || fail "$label did not run the verified binary"
  else
    [ "$expected_status" = failure ] || { cat "${case_dir}/log" >&2; fail "$label rejected a compatible install"; }
    [ ! -e "${test_root}/executed" ] || fail "$label executed before verification"
    [ "$(cat "${case_dir}/bin/maze")" = 'existing binary' ] || fail "$label overwrote the installed binary"
    [ "$(cat "${case_dir}/continuation")" = '# existing continuation' ] || fail "$label modified the continuation environment"
    [ "$(cat "${case_dir}/output")" = '# existing continuation' ] || fail "$label published outputs"
  fi
}
check_case matching-pin success v0.0.8 packagemaze/maze-cli "$trusted_digest"
check_case uppercase-pin success v0.0.8 packagemaze/maze-cli "$(printf '%s' "$trusted_digest" | tr '[:lower:]' '[:upper:]')"
check_case default-mirror-pin failure v0.0.8 packagemaze/maze-cli ''
check_case malformed-pin failure v-custom packagemaze/maze-cli 'not-a-sha256'
check_case short-pin failure v-custom packagemaze/maze-cli "${trusted_digest:1}"
check_case newline-pin failure v-custom packagemaze/maze-cli "$trusted_digest"$'\n'
# An attacker replaces BOTH files at the release URL after a trusted pin is recorded.
printf '# substituted bytes\n' >> "${test_root}/maze"
package_fixture
check_case substituted-pair failure v0.0.8 packagemaze/maze-cli "$trusted_digest"
check_case unpinned-version success v-custom packagemaze/maze-cli ''
check_case unpinned-repository success v0.0.8 example/custom-cli ''
printf 'Installer integrity contracts passed.\n'
