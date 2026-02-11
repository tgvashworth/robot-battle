# Section 8: What Actually Got Built (lines 214-233)

## Paragraphs

### P1: Robot list intro
> The final product has eight robots with different strategies:

**Structure**: Fine.
**AI patterns**: None.

---

### P2: Robot bullet list
> - **SpinBot**: Heads to centre, spins in circles, fires opportunistically
> - **CircleBot**: Orbits detected enemies at medium range with radar lock and predictive aiming -- the tournament champion at 80% win rate
> - ...

**Structure**: Good. The parenthetical asides about rewrites add personality.
**AI patterns**: The list is parallel but that's appropriate for a feature catalogue. The "(after seven rewrites)" callbacks to earlier sections are a nice touch. **NothingBot: Does nothing. Useful for testing.** is good dry humour.

---

### P3: Compiler summary
> The compiler handles the full language: variables, functions, if/for control flow, structs, fixed-size arrays, multi-return functions, and 8 event types. The type system enforces strict numeric separation and the angle type's wrapping semantics.

**Structure**: Dense technical summary. Fine for the audience.
**AI patterns**: None.

---

### P4: Simulation summary
> The simulation runs deterministically with a seeded PRNG. Bullets use swept line-segment collision detection. There's an event pipeline that delivers scan, hit, wall collision, and robot collision events. Mines deal 30 damage. Cookies restore 20 health. You can shoot both to deny them to enemies.

**Structure**: Six sentences, all short, all factual.
**AI patterns**: **MILD FLAG**. The machine-gun short sentences are slightly list-like. "Mines deal 30 damage. Cookies restore 20 health." could be combined: "Mines deal 30 damage and cookies restore 20 health." The final sentence ("You can shoot both to deny them to enemies") is good because it breaks the pattern with an actual gameplay insight.

---

### P5: Tournament
> The tournament system runs N games with the same robots and scores them: 3 points for a win, 1 for survival.

**Structure**: Clean. One sentence, all the info you need.
**AI patterns**: None.
