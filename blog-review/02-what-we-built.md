# Section 2: What We Built (lines 19-35)

## Paragraphs

### P1: Summary sentence
> Robot Battle is a browser-based game where you write robots in a custom programming language called RBL, those robots get compiled to WebAssembly, and then they fight each other in a deterministic physics simulation rendered in real time.

**Structure**: Dense but clear. Does the job.
**AI patterns**: None.

---

### P2: The bullet list
> The final codebase has:
> - A **complete compiler** (lexer, parser, type checker, WASM code generator) -- about 5,000 lines
> - A **deterministic physics simulation** with bullets, radar, mines, cookies, and wall collisions -- about 1,500 lines
> - ...

**Structure**: Fine as a feature list. The bold keywords + parenthetical detail + line count structure is consistent.
**AI patterns**: **MILD FLAG**. The parallel structure (bold noun, parenthetical, dash, line count) repeated 7 times is very tidy. AI loves perfectly parallel lists. A human writing this might vary the structure more, or just dump numbers in a table. Not a dealbreaker -- technical blog posts do this -- but it's worth noticing.

---

### P3: Determinism line
> The whole thing runs locally in the browser. No server. You write a `.rbl` file, the compiler turns it into WASM bytes, and the simulation runs deterministically from a seed. Same seed, same battle, every time.

**Structure**: Three short sentences, then a longer one, then a punchy closer.
**AI patterns**: **FLAG**. "Same seed, same battle, every time" is exactly the em-dash staccato pattern you identified. It's a three-beat repetitive closer that adds emphasis through rhythm rather than information. It *sounds* good but it's the AI equivalent of a mic drop. Same family as "Not from a textbook, not from a course."

**Suggested fix**: Fold it into the previous sentence. "...and the simulation is deterministic -- same seed, same result" or just cut the last sentence entirely since "deterministically from a seed" already says it.
