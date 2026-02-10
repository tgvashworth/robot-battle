# Robot Battle Documentation

## Reference

Detailed specifications for the language, APIs, and internal systems.

- [RBL Language Reference](reference/language.md) — Types, operators, control flow, functions, events, structs, arrays
- [Standard Library Reference](reference/stdlib.md) — All robot API functions, physics defaults, coordinate system
- [Compiler Architecture](reference/compiler.md) — Lex, parse, analyze, codegen pipeline and WASM binary generation
- [Renderer Architecture](reference/renderer.md) — Canvas2D rendering, visual elements, frame interpolation, render options

## Tutorial

- [Writing a Bot](tutorial/writing-a-bot.md) — Step-by-step guide from first bot to competitive fighter. Covers movement, radar, shooting, events, and advanced techniques.

## Architecture

- [System Overview](architecture/overview.md) — Module map, data flow, tick order, deterministic simulation, tournament system, tech stack

## Explainer

- [Language Design Choices](explainer/language-design.md) — Why a custom language, why Go-inspired syntax, the angle type, strict typing, intent-based control, WASM compilation, and what was left out
