# obsidian-typed-codeblocks task runner

default:
    @just --list

# install dependencies (frozen lockfile)
install:
    pnpm install --frozen-lockfile

# two-stage build: worker → inlined string → root + /run entries
build:
    pnpm build

# run every test project (unit + dom); builds first because tests exercise the real artifacts
test: build
    pnpm test

# eslint + typecheck
lint:
    pnpm lint

# bundle dependency-graph boundaries (requires a prior build)
check-graph: build
    pnpm check:graph

# everything CI runs
ci: lint test
    pnpm check:graph
