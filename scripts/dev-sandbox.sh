#!/usr/bin/env bash
# dev-sandbox — run an untrusted dev command (pnpm / vitest / vite / tsc …)
# under bubblewrap so a malicious dependency in the node_modules tree cannot
# read secrets, escape the repo, or steal credentials.
#
# WHY: `pnpm install` and every build/test/run step execute arbitrary code
# from a dependency tree you did not write, with your full user authority —
# the dominant supply-chain attack surface. This confines that code, the same
# bounded-blast-radius idea pagu applies to its runner. The SECURITY BOUNDARY
# IS THE bwrap FLAG SET BELOW, not this script's logic — read the flags, not
# just the prose.
#
# The confinement:
#   • filesystem — the repo is read-write; the nix store is read-only; nothing
#     else from $HOME is visible. ~/.ssh, ~/.aws, sops age keys, ~/.config,
#     and any .env outside this repo simply do not exist inside the sandbox.
#   • environment — cleared (`--clearenv`), then a minimal allowlist is
#     re-added. API keys (ANTHROPIC_API_KEY, AWS_*, GH_TOKEN, …) and the
#     ssh-agent socket are dropped, so there is nothing to exfiltrate even if
#     untrusted code runs.
#   • network — SHARED by default (the registry needs it to install). Pass
#     --no-net to drop the network namespace for build/test steps that don't
#     need it (stronger: then exfiltration is impossible, not just pointless).
#
# The trade: with masked secrets + a scrubbed env, leaving the network up for
# install is acceptable — there is nothing sensitive on disk or in the env to
# steal — and the edit-test loop stays fast (no VM).
#
# Usage:
#   scripts/dev-sandbox.sh pnpm install --frozen-lockfile
#   scripts/dev-sandbox.sh --no-net pnpm test
set -euo pipefail

repo="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
# HOME lives UNDER the repo (which is bound read-write), so the pnpm
# content-addressable store persists across runs and is on the same
# filesystem as node_modules (hardlinks work) — while the real $HOME and its
# secrets stay invisible.
sandbox_home="$repo/.sandbox-home"
mkdir -p "$sandbox_home"

net=(--share-net)
if [[ "${1:-}" == "--no-net" ]]; then
  net=(--unshare-net)
  shift
fi
if [[ $# -eq 0 ]]; then
  echo "usage: dev-sandbox.sh [--no-net] <command> [args…]" >&2
  exit 2
fi

# Minimal env allowlist (deny-by-default via --clearenv). Only add a var if
# it is set, so we never inject empty values that tools misread as "enabled".
env_args=(
  --setenv HOME "$sandbox_home"
  --setenv PATH "$PATH"
  --setenv TERM "${TERM:-xterm}"
  --setenv LANG "${LANG:-C.UTF-8}"
  --setenv SSL_CERT_FILE "${SSL_CERT_FILE:-${NIX_SSL_CERT_FILE:-/etc/ssl/certs/ca-certificates.crt}}"
)
[[ -n "${NODE_ENV:-}" ]] && env_args+=(--setenv NODE_ENV "$NODE_ENV")
[[ -n "${CI:-}" ]] && env_args+=(--setenv CI "$CI")

exec bwrap \
  --ro-bind /nix/store /nix/store \
  --ro-bind-try /etc/resolv.conf /etc/resolv.conf \
  --ro-bind-try /etc/nsswitch.conf /etc/nsswitch.conf \
  --ro-bind-try /etc/hosts /etc/hosts \
  --ro-bind-try /etc/ssl /etc/ssl \
  --ro-bind-try /etc/static/ssl /etc/static/ssl \
  --ro-bind-try /etc/passwd /etc/passwd \
  --ro-bind-try /etc/group /etc/group \
  --ro-bind-try /bin /bin \
  --ro-bind-try /usr/bin /usr/bin \
  --proc /proc \
  --dev /dev \
  --tmpfs /tmp \
  --bind "$repo" "$repo" \
  --chdir "$repo" \
  --clearenv \
  "${env_args[@]}" \
  --unshare-all \
  "${net[@]}" \
  --die-with-parent \
  -- "$@"
