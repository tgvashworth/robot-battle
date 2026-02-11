# Section 6: The Bugs. Oh, the Bugs. (lines 132-184)

## Paragraphs

### P1: Section opener
> If I'm being honest about what this process was actually like, I have to talk about the bugs. Because there were some absolute howlers.

**Structure**: Two sentences.
**AI patterns**: **MILD FLAG**. "If I'm being honest" is a stock phrase that AI uses to signal candour. It's the written equivalent of clearing your throat. A human writing casually might just launch straight in: "Now for the bugs. There were some absolute howlers." The current version slightly over-signals its own honesty.

---

### P2: SawBot intro
> SawBot was supposed to head to the centre of the arena, then saw back and forth perpendicular to the enemy while firing. Simple concept. It went through approximately seven rewrites.

**Structure**: Setup, then punchline. Works well.
**AI patterns**: "Simple concept." as a standalone sentence is a mild dramatic beat. Fine here because it sets up the contrast with "seven rewrites" naturally.

---

### P3: First attempt
> This led to building `debugInt()` and `debugAngle()` standard library functions, which turned out to be essential for all subsequent robot development.

**Structure**: Fine.
**AI patterns**: "which turned out to be essential for all subsequent robot development" is slightly grandiose for what's basically "these became really useful." Consider: "which turned out to be useful for everything that came after."

---

### P4: Second attempt
> Second attempt: it moved, but at 90 degrees to where it should have been going. A classic rotation offset bug -- the heading of the robot body didn't match the direction of travel in the renderer.

**Structure**: Good. Concise.
**AI patterns**: None.

---

### P5: SawBot wrap-up
> It took building the debug panel, adding angle visualisation, and several rounds of trigonometry before SawBot worked properly.

**Structure**: Fine.
**AI patterns**: None.

---

### P6: WallBot intro
> WallBot was supposed to drive to a wall, patrol along it, and shoot at things.

**Structure**: Clean setup.
**AI patterns**: None.

---

### P7: WallBot resolution
> Coordinate system bugs are a special kind of pain. Eventually we figured out WallBot needed to decelerate on approach (instead of slamming into the wall at full speed), reverse direction by negating its speed (instead of turning 180 degrees), and use a wide radar sweep instead of a narrow lock.

**Structure**: Aphoristic opener, then detail.
**AI patterns**: "X is a special kind of Y" is a slightly stock construction. Not terrible. The triple "(instead of...)" parenthetical list is good -- it shows the actual reasoning.

---

### P8: Phantom Radar description
> This was a genuinely subtle one in the simulation's radar scan detection. Tracing it required careful examination of the geometry calculations.

**Structure**: Two sentences.
**AI patterns**: **FLAG**. "genuinely" again (third time in the post -- it's becoming a verbal tic). Also, this paragraph is oddly vague compared to the vivid detail in the SawBot and WallBot sections. "Tracing it required careful examination of the geometry calculations" says basically nothing. What did the bug actually turn out to be? If you don't remember or it's not interesting enough for detail, consider cutting this subsection entirely. It's the weakest of the four bug stories.

---

### P9: Variable shadowing
> This one was found not by me, but by the adversarial test suite. When a variable was declared inside an inner block (like inside an `if`), the compiler's codegen permanently overwrote the outer scope's binding. So after the block ended, the outer variable pointed to the wrong WASM local. The fix was saving and restoring the locals map around block compilation.

**Structure**: Good. Clear explanation of a real bug with the actual fix.
**AI patterns**: None. This is solid technical writing.

---

### P10: Variable shadowing closer
> Property-based testing found this. Hand-written tests hadn't.

**Structure**: Two very short sentences.
**AI patterns**: **FLAG**. This is the staccato contrastive pattern again. "X did this. Y didn't." It's the same rhythmic family as the other flagged patterns. Consider combining: "Property-based testing caught it where hand-written tests hadn't."
