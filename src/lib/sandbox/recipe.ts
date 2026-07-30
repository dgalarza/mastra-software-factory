import { createHash } from 'node:crypto';

/**
 * The weft sandbox environment, written plainly.
 *
 * This is Station 2's one target stack — deliberately not abstracted into
 * per-stack adapters or repo detection. When the factory grows a second
 * target repo (Station 5), THAT is the moment to extract a seam, with two
 * real cases to design against instead of one.
 *
 * Everything here mirrors what weft's own CI declares (.github/workflows/
 * ci.yml, .ruby-version): Ruby 4.0.5, Postgres 17, rspec as the gate.
 */

/**
 * Ruby 4.0.5 is not in Debian trixie's apt (candidate: 3.3), so it comes
 * from ruby-builder's prebuilt tarball. The binary is compiled against this
 * exact prefix — extracted anywhere else it cannot find libruby.so.4.0.
 * The ubuntu-24.04 build (glibc 2.39) runs fine on trixie (glibc 2.41).
 */
export const RUBY_PREFIX = '/opt/hostedtoolcache/Ruby/4.0.5/x64';

const RUBY_TARBALL =
  'https://github.com/ruby/ruby-builder/releases/download/ruby-4.0.5/ruby-4.0.5-ubuntu-24.04-x64.tar.gz';

/**
 * The audit workspace: a depth-1 clone of weft's default branch, baked into
 * the image with its gem bundle installed and test schema loaded. Per-triage
 * work is then a fetch + checkout + delta `bundle install`, not a cold clone
 * and full install (~26s warm, minutes cold — measured in the Ep. 2 spikes).
 */
export const WEFT_DIR = '/app';

const WEFT_CLONE_URL = 'https://github.com/dgalarza/weft.git';

/**
 * Build-time credential: the STABLE token value, read from the environment.
 *
 * Railway content-addresses template builds, so anything varying between
 * builds forces a rebuild — a freshly minted installation token in withEnv()
 * did exactly that (measured: 56s rotated vs 0.2s identical). So this must be
 * a long-lived value, i.e. a fine-grained PAT with Contents:read on weft.
 *
 * `${{shared.*}}` would have been cleaner — the template would store only a
 * reference and the secret would live in Railway. It does not work: sandboxes
 * do not resolve Railway variable references. Verified with a control — a
 * literal in the same withEnv() passed through while
 * `${{shared.PROBE_VALUE}}` came back empty at BOTH build time and runtime,
 * against a variable confirmed present in the dashboard. That syntax is for
 * services and deployments, despite the sandbox docs implying otherwise.
 *
 * Consequence, accepted deliberately: the PAT value is part of the template
 * definition stored in the Railway account, and rotating it costs one ~60s
 * rebuild. Read-only, single repo. Per-triage git operations do NOT use this
 * — they use short-lived GitHub App installation tokens delivered to tmpfs
 * (see GITHUB_TOKEN_PATH), so the long-lived credential only ever builds the
 * immutable base.
 */
export function buildTimeToken(): string {
  return process.env.GITHUB_TOKEN ?? '';
}

/**
 * Credential hygiene invariant — nothing below may put a credential on disk.
 *
 * The built image is shared by every audit, so a token that reaches disk is
 * a token shared with every future triage. Embedding one in a clone URL
 * persists it in .git/config; that is the failure mode this helper prevents.
 *
 * The helper script contains NO secret — it reads $GITHUB_TOKEN from the
 * environment at invocation time. At build time the value arrives via the
 * builder's withEnv(); at audit time via the sandbox's runtime env, or the
 * tmpfs drop at GITHUB_TOKEN_PATH when running on App credentials alone.
 */
const GIT_CRED_HELPER = '/usr/local/bin/gh-cred';

/**
 * Registration writes /etc/gitconfig directly instead of running
 * `git config --system`: Railway's base image shadows git with a `safe-git`
 * allowlist wrapper that refuses --system writes outright (verified by
 * bisecting live template builds — the wrapper's denial was this recipe's
 * first failure mode). The wrapper permits clone/fetch/checkout/clean, so
 * the audit's runtime git use passes through it untouched.
 */
const GIT_CRED_HELPER_STEP = `printf '#!/bin/sh\\n[ "$1" = get ] || exit 0\\necho username=x-access-token\\necho "password=\${GITHUB_TOKEN:-$(cat /dev/shm/github-token 2>/dev/null)}"\\n' > ${GIT_CRED_HELPER} && chmod +x ${GIT_CRED_HELPER} && printf '[credential]\\n\\thelper = ${GIT_CRED_HELPER}\\n' > /etc/gitconfig`;

/**
 * Postgres socket directory — on persistent disk, NOT the default
 * /var/run/postgresql. /var/run is tmpfs, so it is empty in every freshly
 * forked sandbox and Postgres cannot create its socket there. Rails is
 * unaffected (it connects over TCP); only pg_ctl/psql/pg_isready use it.
 */
export const PG_SOCKET_DIR = '/var/lib/postgresql/sockets';

const PG_CTL =
  '/usr/lib/postgresql/17/bin/pg_ctl -D /var/lib/postgresql/17/main -o "-c config_file=/etc/postgresql/17/main/postgresql.conf"';

/**
 * `pg-up`: idempotent Postgres boot, baked into the image.
 *
 * The image is built with Postgres stopped, but a pidfile can still be
 * present from the build's own start/stop cycle, and the boot path must be
 * safe to call repeatedly within one audit. So it is defensive: recreate
 * the socket directory, clear any stale pid, start only if not already up.
 * Do not simplify it into a bare `pg_ctl start`; the failures it absorbs
 * are intermittent and present as a Postgres that simply will not boot.
 */
const PG_UP_SCRIPT = `#!/usr/bin/env bash
set -euo pipefail
mkdir -p ${PG_SOCKET_DIR} && chown postgres:postgres ${PG_SOCKET_DIR}
if su postgres -c "pg_isready -h ${PG_SOCKET_DIR}" >/dev/null 2>&1; then echo "postgres already up"; exit 0; fi
rm -f /var/lib/postgresql/17/main/postmaster.pid
su postgres -c '${PG_CTL} start -w' >/dev/null
su postgres -c "pg_isready -h ${PG_SOCKET_DIR}"
`;

/** Debian packages the audit needs beyond the sandbox's stock image. */
export const APT_PACKAGES = [
  'build-essential',
  'git',
  'libpq-dev',
  'libyaml-dev',
  'zlib1g-dev',
  'postgresql-17',
] as const;

/** Environment for running weft's suite, matching config/database.yml. */
export const AUDIT_ENV =
  'RAILS_ENV=test WEFT_DATABASE_HOST=localhost WEFT_DATABASE_USERNAME=weft WEFT_DATABASE_PASSWORD=weft';

/**
 * Where `probe-assertion` appends its machine-written results. One JSON
 * object per line, authored by the helper — never by the agent. Same trust
 * property as the rspec artifact: the tool that observed the outcome is the
 * tool that recorded it.
 */
export const PROBE_ARTIFACT_PATH = '/tmp/probes.jsonl';

/** Where the suite writes its machine-readable report inside the sandbox. */
export const RSPEC_ARTIFACT_PATH = '/tmp/rspec.json';

/**
 * Runtime token drop for the credential helper's fallback path. /dev/shm is
 * tmpfs — the same property that forced Postgres's socket OFF tmpfs is why
 * the secret goes ON it: nothing there can ever be captured. The workflow
 * writes a fresh ~1h installation token here before each triage, which is
 * what lets per-triage git run on short-lived GitHub App credentials while
 * the long-lived build PAT never touches a running audit.
 */
export const GITHUB_TOKEN_PATH = '/dev/shm/github-token';

/**
 * `probe-assertion <source-file> <perl-expr> <spec-file>`
 *
 * Verifies that a spec actually detects the breakage of the thing it
 * asserts. After upgrading test tooling a green suite is ambiguous — it
 * means either "everything works" or "the assertions silently stopped
 * asserting" — and this is what disambiguates it.
 *
 * The hygiene rules are enforced structurally rather than instructed:
 *   - refuses to run against an already-modified file (a stale edit would
 *     silently invalidate the result)
 *   - refuses when the mutation changed nothing, which otherwise looks
 *     identical to "the assertion failed to detect it"
 *   - always restores the file, including when rspec dies
 */
const PROBE_SCRIPT = `#!/usr/bin/env bash
set -uo pipefail
export PATH=${RUBY_PREFIX}/bin:$PATH
# rspec's JSON carries UTF-8 (em dashes, arrows in spec descriptions) and the
# sandbox sets no locale, so Ruby's default external encoding is US-ASCII and
# every JSON.parse raises InvalidByteSequenceError. Without this, EVERY probe
# reports "could not read the report" — which previously looked identical to
# "the assertion did not detect the mutation" and produced a false alarm
# claiming the suite was decorative.
export LANG=C.UTF-8 LC_ALL=C.UTF-8 RUBYOPT=-EUTF-8
cd ${WEFT_DIR} || exit 4
src="$1"; expr="$2"; spec="$3"
emit() { # status, exitCode, failureCount, note
  printf '{"source":"%s","spec":"%s","status":"%s","exitCode":%s,"failureCount":%s,"note":"%s"}\\n' \\
    "$src" "$spec" "$1" "$2" "$3" "$4" >> ${PROBE_ARTIFACT_PATH}
  echo "probe $src via $spec -> $1 ($4)"
}
git diff --quiet -- "$src" || { echo "refused: $src already modified" >&2; emit errored -1 -1 "file already modified"; exit 2; }
perl -0777 -i -pe "$expr" "$src" || { git checkout -- "$src"; emit errored -1 -1 "mutation command failed"; exit 3; }
if git diff --quiet -- "$src"; then
  git checkout -- "$src"
  emit errored -1 -1 "mutation matched nothing"
  exit 3
fi
out="$(mktemp)"
${AUDIT_ENV} bundle exec rspec "$spec" --format json --out "$out" >/dev/null 2>&1
rc=$?
git checkout -- "$src"
fc="$(ruby -rjson -e 'begin; puts JSON.parse(File.read(ARGV[0], mode: "r:UTF-8"))["summary"]["failure_count"]; rescue; puts -1; end' "$out" 2>/dev/null || echo -1)"
case "$fc" in
  ''|*[!0-9-]*|-1) emit errored "$rc" -1 "no parseable rspec report"; exit 0 ;;
esac
if [ "$fc" -gt 0 ]; then
  emit detected "$rc" "$fc" "spec failed as it should"
else
  emit missed "$rc" "$fc" "spec stayed green while its subject was broken"
fi
`;

/**
 * Image build steps, in order — the first half of the template.
 *
 * Railway builds these once, content-addresses the result, and caches it;
 * a sandbox then forks that build in ~3s. Order is part of the content
 * hash, so reordering silently produces a different image.
 *
 * Split from WARMUP_STEPS only for readability: everything the environment
 * needs before weft itself is present lives here, the heavy per-repo state
 * lives below. Both halves go into the same template — see
 * `auditTemplate()` in workspace.ts.
 */
export const BUILD_STEPS: readonly string[] = [
  // Ruby at its required prefix
  `mkdir -p ${RUBY_PREFIX} && curl -fsSL ${RUBY_TARBALL} | tar xz -C ${RUBY_PREFIX} --strip-components=1`,
  // Bundler pinned to what weft's Gemfile.lock was bundled with
  `${RUBY_PREFIX}/bin/gem install bundler -v 4.0.3 --no-document`,
  // Socket dir on persistent disk + config pointing at it
  `mkdir -p ${PG_SOCKET_DIR} && chown postgres:postgres ${PG_SOCKET_DIR} && sed -i "s|^#*unix_socket_directories.*|unix_socket_directories = '${PG_SOCKET_DIR}'|" /etc/postgresql/17/main/postgresql.conf`,
  // pg-up helper
  `printf '%s' '${PG_UP_SCRIPT.replaceAll("'", `'\\''`)}' > /usr/local/bin/pg-up && chmod +x /usr/local/bin/pg-up`,
  // probe-assertion helper, installed base64-encoded so no shell quoting
  // of the script body is required in this build step.
  `printf '%s' '${Buffer.from(PROBE_SCRIPT).toString('base64')}' | base64 -d > /usr/local/bin/probe-assertion && chmod +x /usr/local/bin/probe-assertion`,
  // The weft role, created against a temporarily-started server, stopped
  // cleanly so the built image never ships a running-state pidfile
  `mkdir -p /var/run/postgresql && chown postgres:postgres /var/run/postgresql && su postgres -c '${PG_CTL} start -w' && su postgres -c "psql -h ${PG_SOCKET_DIR} -qc \\"CREATE ROLE weft LOGIN SUPERUSER PASSWORD 'weft'\\"" && su postgres -c '${PG_CTL} stop -m fast -w' && rm -f /var/lib/postgresql/17/main/postmaster.pid`,
  // Git auth via env-reading helper — never a token in a URL or on disk
  GIT_CRED_HELPER_STEP,
  // Weft workspace: depth-1 clone of the default branch. Auth comes from the
  // credential helper + the builder's build-time GITHUB_TOKEN (withEnv in
  // workspace.ts) — the URL stays credential-free so .git/config never
  // carries a secret into the shared image.
  `git clone --depth 1 ${WEFT_CLONE_URL} ${WEFT_DIR}`,
] as const;

/**
 * Warmup: the heavy per-repo state that makes forked sandboxes start ready
 * — weft's gem bundle and test schema — plus a scrub so the image ships
 * clean.
 *
 * `pnpm build-template` pays this once, out-of-band. Building it during
 * `Sandbox.create()` is what fails: that path materializes the image behind
 * a ~120s gateway and reliably 504s once the bundle is included (measured:
 * light steps boot in ~37s, adding bundle install + db:prepare times out).
 * `template.build()` has no such limit and takes ~60s.
 *
 * Gems install into the Ruby prefix (system gems, root-owned) so a
 * per-triage `git clean` in the worktree can never delete them. Weft's CI
 * runs db:prepare with no RAILS_MASTER_KEY, so no secret is needed.
 */
export const WARMUP_STEPS: readonly string[] = [
  `export PATH=${RUBY_PREFIX}/bin:$PATH && cd ${WEFT_DIR} && bundle install --jobs 8`,
  `export PATH=${RUBY_PREFIX}/bin:$PATH && pg-up && cd ${WEFT_DIR} && ${AUDIT_ENV} bundle exec rails db:prepare`,
  // Scrub before capture. A base must never carry a previous audit's
  // evidence: a triage that fails to run its own suite would restore these
  // files and report them as its own findings. That is exactly what
  // happened on 2026-07-28 — PR #52 could not fetch, restored PR #38's
  // /tmp/probes.jsonl, and posted "7/7 assertions verified" it never ran.
  // Audit sandboxes no longer carry a checkpointName (ADR 004) so they can
  // no longer poison the base, but prewarm restores the existing checkpoint
  // before re-capturing, so anything already inside would persist forever.
  `rm -f ${RSPEC_ARTIFACT_PATH} ${PROBE_ARTIFACT_PATH} ${GITHUB_TOKEN_PATH}`,
  `cd ${WEFT_DIR} && git checkout -f main && git clean -fd`,
  // Stopped cleanly so a capture taken right after warmup never contains a
  // running-state pidfile
  `su postgres -c '${PG_CTL} stop -m fast -w' && rm -f /var/lib/postgresql/17/main/postmaster.pid`,
] as const;

/**
 * Railway content-addresses the template from its own build steps, so this
 * recipe no longer needs a hand-rolled hash or a checkpoint name. An
 * identical recipe rebuilds in 0.2s from cache; changing any step below
 * produces a different template and a fresh build (~60s). See ADR 004.
 *
 * Caching is content-based, which means anything varying between builds
 * defeats it — notably a freshly minted token in withEnv. The build-time
 * credential is therefore minted ONCE per process (workspace.ts).
 */

/**
 * Shell prelude for every audit command. PATH must carry the real Ruby bin
 * directory: bundler re-execs itself to match Gemfile.lock's BUNDLED WITH
 * version through a sanitized environment, which drops /usr/local/bin
 * symlinks. pipefail because a piped command otherwise reports the LAST
 * command's exit status — the audit's honesty depends on real exit codes.
 */
export const SHELL_PRELUDE = `set -o pipefail; export PATH=${RUBY_PREFIX}/bin:$PATH;`;
