#!/bin/sh
# Mirrors the `test` job in .github/workflows/ci.yml.
set -e
pnpm run format:check
pnpm exec tsc --noEmit
pnpm exec tsc -p container/agent-runner/tsconfig.json --noEmit
# The default (one worker per core) times out the slower tests on a many-core machine.
pnpm exec vitest run --reporter=dot --maxWorkers=8
cd container/agent-runner && bun run test
