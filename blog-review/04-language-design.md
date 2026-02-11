# Section 4: The Language Design Session (lines 47-110)

## Paragraphs

### P1: Opener
> This was one of my favourite parts. I had strong opinions:

**Structure**: Fine. Two short sentences, leads into a blockquote.
**AI patterns**: None.

---

### P2: The blockquote
> Now I want you to take me through the language design...

**Structure**: Real quote. No issues.

---

### P3: Design review description
> What followed was genuinely like a design review. Claude would propose something, I'd push back, and we'd iterate. We landed on a Go-inspired language with:

**Structure**: Fine.
**AI patterns**: "What followed was genuinely like a design review" -- the word "genuinely" is doing a lot of work. AI uses "genuinely" and "truly" as emphasis filler. Consider cutting it: "What followed felt like a design review." Or just "It played out like a design review."

---

### P4: Language features list
> - **No nil, no null, no pointers** -- every type has a zero value
> - **Strict numeric types** -- `42` is an int, `42.0` is a float, and you can't mix them
> - ...

**Structure**: Each item is bold keyword + dash + explanation. Same parallel structure concern as the "What We Built" list.
**AI patterns**: **MILD FLAG**. Same perfectly parallel list format. Each bullet follows the exact same rhythm: bold concept, dash, elaboration. The individual items are good, but the uniformity is slightly robotic. You could vary it -- some bullets could be shorter, some could have examples inline without the dash.

---

### P5: Angle type discussion
> The angle type became a point of genuine design discussion. Should `float * angle` be legal? We decided no -- angle must be on the left side of multiplication. It's asymmetric, which feels weird, but it prevents confusion about what the result type should be. `angle(45) * 0.5` clearly means "half of 45 degrees." `0.5 * angle(45)` is ambiguous.

**Structure**: Good. The concrete examples work well. The question-then-answer structure is natural.
**AI patterns**: "genuine" again (see above -- AI loves this word as a sincerity marker). Otherwise fine.

---

### P6: Code sample intro
> Here's what a robot actually looks like in RBL:

**Structure**: Fine.
**AI patterns**: None.

---

### P7: Post-code-sample line
> That compiles to WebAssembly. The compiler emits the binary format directly -- no WAT intermediate, no IR. Just bytes.

**Structure**: Short declarative, then a detail sentence.
**AI patterns**: **FLAG**. "no WAT intermediate, no IR. Just bytes." is the same staccato negation pattern. "No X, no Y. Just Z." It's rhythmically identical to "Not from a textbook, not from a course" and "Same seed, same battle, every time." Three instances of the same rhetorical device in one post is a lot.

**Suggested fix**: "The compiler emits WASM binary directly, skipping any intermediate text format." Or simply: "That compiles to WebAssembly -- the compiler emits the binary format byte by byte, with no intermediate representation."
