# Section 9: What I Learned (lines 235-259)

## Paragraphs

### Lesson 1: Clear goals > specifications
> The most productive prompts were things like "build a bot that seeks cookies to restore health" or "give WallBot tracking, inspired by SawBot." Not "implement a function that calculates the bearing to the nearest cookie using the arctangent of the position delta." Claude could figure out the implementation. What it needed was a clear picture of what success looked like.

**Structure**: Examples first, then the principle. Good structure.
**AI patterns**: **FLAG**. The "Not [verbose bad example]" is the contrastive pattern. "Things like X. Not Y." It's the same structure as "Not from a textbook" etc. Also: "What it needed was a clear picture of what success looked like" is a slightly empty closing. What *specifically* about the clear goals made them work? The examples already do the work; the summary sentence just restates them abstractly.

**Suggested fix**: Cut the last sentence, or make it more specific: "The goal-oriented prompts gave Claude room to make implementation choices, while the over-specified ones just made it follow instructions badly."

---

### Lesson 2: Clean boundaries
> The four-module architecture (compiler, simulation, renderer, UI) with explicit interfaces between them meant agents could work independently without treading on each other. The `GameState` type -- a plain object that flows from simulation to renderer -- was the key abstraction. Every module knew what it produced and consumed.

**Structure**: Fine. The `GameState` example is concrete and useful.
**AI patterns**: "Every module knew what it produced and consumed" is a clean closer. No issues.

---

### Lesson 3: Run the thing
> The most valuable bugs were found by loading robots and watching them fight, not by reading code. The moment SawBot drove into a corner and killed itself, I knew something was wrong that no test had caught. The debug tooling (`debugInt`, `debugAngle`, the debug panel) was built because I needed to see what the robots thought they were doing.

**Structure**: Good. Specific, references earlier material.
**AI patterns**: "found by X, not by Y" is another contrastive pair but it's natural English here -- "found by watching, not reading" is how a person would say it. The last sentence is good.

---

### Lesson 4: Incremental delivery
> Every commit was a working state. The project was never in a "trust me, it'll work when it's all connected" phase. I could run battles from early on, even when they were ugly and broken. This made it obvious when something regressed.

**Structure**: Four sentences, all clean.
**AI patterns**: None. The quoted phrase ("trust me, it'll work when it's all connected") is natural voice. Good.

---

### Lesson 5: Property-based testing
> The adversarial test suite using fast-check found the variable shadowing bug that none of the hand-written tests caught. Random program generation is good at exploring corners of a language implementation that a human would never think to test.

**Structure**: Two sentences.
**AI patterns**: "that a human would never think to test" slightly oversells. "that you wouldn't think to write by hand" is more modest and probably more accurate.

---

### Lesson 6: Breadth vs taste
> Claude wrote 11,000 lines of source code, 22,000 lines of tests, 8 robots, and comprehensive documentation. I wrote maybe 50 words of actual code (mostly editing `.rbl` files in the browser). But I made every significant design decision: the language semantics, the physics tuning, the UI layout, when to drop features, when to push harder. The ratio of "lines written" to "decisions made" is wildly skewed, and that's fine. That's the point.

**Structure**: Contrast between Claude's volume and Tom's decisions. The numbers are punchy.
**AI patterns**: **FLAG**. "and that's fine. That's the point." is the staccato dramatic closer again. Two sentences where one would do. "...is wildly skewed, which is rather the point" or "...is wildly skewed, and that worked" or just cut "That's the point" entirely -- the reader gets it.

Also: the heading "AI is good at breadth, humans are good at taste" is an extremely clean AI-style aphorism. It's the kind of thing that reads well on a slide but feels slightly pre-packaged. Consider whether this is the framing you actually want, or whether something messier/more honest like "AI wrote the code, I made the choices" or "The division of labour was lopsided (and that was fine)" would feel more genuine.
