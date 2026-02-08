# Agent Guidelines

## Commands

```sh
bun run test          # run all tests
bun run typecheck     # type-check (tsc --noEmit)
bun run check         # biome lint + format check
bun run check:fix     # auto-fix lint + formatting
```

Always run `bun run typecheck && bun run test && bun run check` before considering work done. Bun needs `/opt/homebrew/bin` in PATH.

## Code Style

- **Biome** handles formatting and linting. Config: `biome.json`
- Tabs, double quotes, no semicolons
- `noNonNullAssertion` is OFF (we use `!` because `noUncheckedIndexedAccess` is on)
- `noParameterAssign` is ON — use a local variable instead of reassigning params
- `verbatimModuleSyntax` — always use `import type` for type-only imports
- Vitest globals are OFF — explicitly import `describe`, `it`, `expect` from `"vitest"`
- Call `cleanup` from `@testing-library/react` in `afterEach` for React component tests

## Architecture

Four modules: compiler, simulation, renderer, UI. Interfaces live in `spec/`. Implementation in `src/`.

`GameState` (defined in `spec/simulation.ts`) is THE canonical type. It flows simulation → renderer and must be a plain object (survives `structuredClone()`).

### Module Rules

- **Compiler** (`src/compiler/`): pure function, no runtime deps. String in, `CompileResult` out.
- **Simulation** (`src/simulation/`): deterministic. Same seed → same output. Uses `RobotModule` interface for both WASM and test stubs.
- **Renderer** (`src/renderer/`): reads `GameState`, draws pixels. No knowledge of WASM or compiler. Currently Canvas2D, will become PixiJS.
- **UI** (`src/ui/`): orchestrates the other three. Never calls WASM or PixiJS directly.

## Testing

- Tests live in `__tests__/` directories next to the code they test
- Simulation tests use test stub robots (`src/simulation/test-stubs.ts`), not the compiler
- Renderer tests don't require a real canvas — test that it doesn't crash
- Integration test (`src/__tests__/integration.test.ts`) demonstrates cross-module data flow

## Key Files

- `spec/INTERFACES.md` — module boundaries, invariants, data flow diagrams
- `research/06-language-spec.md` — RBL language specification
- `design/` — detailed design docs per module
