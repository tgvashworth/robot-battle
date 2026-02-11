# Blog Post Review: Pattern Summary

## The Core Problem Pattern

The em-dash/staccato contrastive pattern. Short declarative fragments arranged for rhythmic emphasis, typically in a "Not X. Not Y. Just Z." or "X did this. Y didn't." structure. It *sounds* punchy but it's become a recognisable AI writing fingerprint.

## All Flagged Instances

### HARD FLAGS (should fix)

1. **Line 35**: "Same seed, same battle, every time."
   - Three-beat rhythmic closer. Adds emphasis but no information.
   - Fix: fold into previous sentence or cut.

2. **Line 110**: "no WAT intermediate, no IR. Just bytes."
   - "No X, no Y. Just Z." pattern.
   - Fix: "the compiler emits WASM binary directly, with no intermediate representation."

3. **Line 184**: "Property-based testing found this. Hand-written tests hadn't."
   - "X did. Y didn't." two-beat contrastive.
   - Fix: "Property-based testing caught it where hand-written tests hadn't."

4. **Line 206**: "Research first. Then specification. Then interfaces. Then skeleton. Then real code in milestones."
   - Five staccato sentences. The most extreme instance.
   - Fix: "The progression was research, then spec, then interfaces, then skeleton, then code."

5. **Line 259**: "and that's fine. That's the point."
   - Emphatic two-beat closer.
   - Fix: cut "That's the point" or combine: "which is rather the point."

6. **Line 265**: "The value wasn't that AI wrote code I couldn't write -- it's that it maintained momentum..."
   - "The value wasn't X -- it's Y" classic contrastive.
   - Fix: restructure to avoid the negation-then-assertion.

### MILD FLAGS (consider fixing)

7. **Line 17**: "About 98 prompts, 20 git commits, 77 sub-agents, and one surprisingly opinionated argument..."
   - "X, Y, Z, and one [humorous thing]" escalating list hook.

8. **Line 45**: "Each agent produced a research document. Then Claude synthesised them... I reviewed those and started making decisions."
   - Three-sentence staccato wrap-up.

9. **Line 53**: "genuinely" used three times in the post (lines 53, 61, 178).
   - AI sincerity marker. Cut at least two of them.

10. **Line 134**: "If I'm being honest about what this process was actually like..."
    - Over-signals its own candour.

11. **Line 267**: "But it works." standalone after caveats.
    - Well-worn AI beat.

## Other Patterns to Watch

- **Perfectly parallel bullet lists**: Every bullet in "What We Built" and "Language Design" follows the exact same bold-dash-elaboration structure. Varying the rhythm would help.

- **Self-answered rhetorical questions**: "Could I have built this without Claude? Certainly." and "Should float * angle be legal? We decided no." Two instances is fine; watch for more.

- **Section headings as aphorisms**: "AI is good at breadth, humans are good at taste" reads like a conference talk slide. Consider something less polished.

## What Reads Well (keep these)

- All the real user quotes ("Wallbot looking very shit", "nope, that was reloaded", etc.)
- The SawBot saga structure with numbered attempts
- "(and fail)" parenthetical in the agent teams section
- "NothingBot: Does nothing. Useful for testing."
- The childhood callback in the closing paragraph
- The specific technical detail in the variable shadowing bug explanation
- The disclosure paragraph
- Tom's added paragraphs about genetics/neural networks and Opus 4.6

## Files

- `01-intro.md` -- Introduction paragraphs
- `02-what-we-built.md` -- What We Built
- `03-how-it-started.md` -- How It Started
- `04-language-design.md` -- Language Design Session
- `05-agent-teams.md` -- Building With Agent Teams
- `06-bugs.md` -- The Bugs section
- `07-shape-of-work.md` -- The Shape of the Work
- `08-what-got-built.md` -- What Actually Got Built
- `09-lessons.md` -- What I Learned
- `10-conclusion.md` -- Would I Do It Again?
