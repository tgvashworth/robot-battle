# Simulation and Physics Models for Robot Battle

## Overview

This document covers the simulation engine design for Robot Battle: a 2D arena game
where up to 8 programmable robots (tanks) fight each other. Each robot has independently
controllable body movement, gun turret rotation, and the ability to fire projectiles,
scan the arena, and interact with mines (damage) and cookies (health pickups). The
engine must support both real-time visualization and headless batch simulation
(10,000+ rounds at maximum speed), running in the browser and potentially in Web Workers.

---

## 1. Tick-Based vs Continuous Simulation

### 1.1 Discrete Tick-Based (Fixed Tick Count)

This is the classic model used by Robocode and the original Robot Battle. Time advances
in discrete "turns" (ticks). Each tick, every robot executes code and selects actions,
then the engine resolves all movement, bullets, collisions, and scans in a deterministic
order.

**How Robocode does it (per tick):**
1. All robots execute code until they take an action (or yield).
2. Time counter increments.
3. All bullets move and are checked for collisions.
4. All robots move (gun rotation, radar rotation, heading, acceleration, velocity, position).
5. Gun heat decreases.
6. All robots perform scans.
7. Robot event queues are processed.

**Advantages:**
- Fully deterministic by design -- same inputs always produce identical output.
- Simple to reason about: each tick is an atomic state transition.
- Trivial to replay: just record inputs per tick.
- Easy to fast-forward: no interpolation needed.
- Natural fit for a programming game where players think in discrete steps.

**Disadvantages:**
- Motion can feel "stepped" at low tick rates.
- Tick rate creates a fixed resolution for game actions.
- All robots act simultaneously, which can create ordering ambiguities if not carefully
  specified.

### 1.2 Continuous with Fixed dt (Fixed Timestep Physics)

A physics-style approach where the simulation steps at a fixed delta-time (e.g., 1/60s).
Positions and velocities are updated using numerical integration (Euler or Verlet).
This is the model used by Box2D and most real-time physics engines.

**Advantages:**
- Smoother motion and more "physical" feel.
- Well-suited for real-time rendering (easy to match display refresh rate).
- Large ecosystem of physics libraries and references.

**Disadvantages:**
- Floating-point accumulation can break determinism across platforms.
- More complex state to serialize (positions, velocities, angular velocities).
- Overkill for a game with 8 entities and simple movement rules.
- Harder to reason about for robot programmers ("how far do I move per frame?").

### 1.3 Comparison Matrix

| Criterion             | Discrete Tick-Based       | Continuous Fixed dt       |
|-----------------------|---------------------------|---------------------------|
| Determinism           | Trivially deterministic   | Requires careful handling |
| Reproducibility       | Guaranteed                | Platform-dependent        |
| Performance (batch)   | Very fast (integer math)  | Moderate (float math)     |
| Game feel             | Stepped but predictable   | Smooth                    |
| Implementation        | Simple                    | Moderate                  |
| Robot API clarity     | Clear (per-tick actions)  | Ambiguous (continuous)    |
| Replay size           | Minimal (inputs only)     | Larger (state snapshots)  |

### 1.4 Tick Rate and Instructions Per Tick

**Robocode reference values:**
- 1 tick = 1 turn. Robots move up to 8 pixels/turn.
- A default arena of 800x600 means crossing the arena takes ~100 ticks.
- A typical Robocode battle lasts several hundred to a few thousand ticks.

**Recommended values for Robot Battle:**

| Parameter               | Value   | Rationale                                    |
|-------------------------|---------|----------------------------------------------|
| Ticks per round         | 2,000   | ~20-30 seconds of action at 60 FPS display   |
| Max round duration      | 2,000 ticks (hard cap) | Prevents stalemates          |
| Display rate            | 60 FPS  | Each frame renders 1 tick in real-time mode   |
| Fast-forward            | Skip rendering, run ticks as fast as possible |
| WASM instructions/tick  | 10,000  | Enough for complex logic, prevents infinite loops |

At 2,000 ticks per round, and a target of 10,000 rounds for batch simulation, we need
to process 20 million ticks total. At ~1 microsecond per tick (achievable for simple
physics with 8 entities), that is approximately 20 seconds of wall-clock time on a
single core. Parallelizing across 4-8 Web Workers brings this under 5 seconds.

### 1.5 Recommendation

**Use discrete tick-based simulation.** It provides guaranteed determinism, minimal
replay data, maximum batch simulation speed, and a clear mental model for robot
programmers. The "stepped" feel is actually a feature in a programming game -- it makes
the game predictable and debuggable.

For real-time display, render one tick per frame at 60 FPS, with optional interpolation
between tick states for smoother visual presentation (cosmetic only, does not affect
simulation).

---

## 2. Robot Execution Model

### 2.1 Overview of Approaches

The central question: how does each robot's user-written code execute within the
simulation loop?

#### Option A: Cooperative Multitasking (Yield on Action)

Each robot runs its code continuously. When it calls a "blocking" function
(`move()`, `fire()`, `scan()`), execution yields back to the engine, which advances
the simulation by one tick.

```
// Robot code (conceptual)
loop {
    scan();           // yields, engine runs 1 tick
    if (enemy_seen) {
        fire(3);      // yields, engine runs 1 tick
    }
    move(100);        // yields, engine runs ~12 ticks (100px at 8px/tick)
}
```

**Robocode uses this model.** The robot's `run()` method executes in its own thread
(Java threads), and blocking API calls synchronize with the engine tick.

**Pros:** Intuitive programming model. Robot code reads like sequential logic.
**Cons:** A robot that never yields (infinite loop without action) would hang the
simulation. Requires either threads or coroutine/async mechanisms.

#### Option B: Preemptive with Instruction Budgets (WASM Fuel)

Each robot gets a fixed budget of N WASM instructions per tick. The engine calls
the robot's tick handler, and execution is forcibly suspended when the budget is
exhausted.

**How WASM fuel/metering works:**

1. **Wasmtime fuel:** The Wasmtime runtime has a built-in "fuel" mechanism. The
   embedder sets an initial fuel value. Each WASM basic block consumes fuel
   proportional to its instruction count. When fuel reaches zero, execution traps
   with an `OutOfFuel` error.

2. **wasm-metering (npm):** A compile-time transformation that injects gas-counting
   code into WASM binaries. It inserts calls to an imported `usegas` function at
   the start of each basic block. The host provides this function and tracks
   remaining gas. When gas is exhausted, the host throws to halt execution.

3. **Browser compatibility:** Since browsers use their own WASM engine (V8/SpiderMonkey),
   native fuel APIs (Wasmtime/Wasmer) are not available. The `wasm-metering` approach
   works in browsers because it modifies the WASM binary itself, adding metering as
   injected code that calls back to JavaScript.

**Pros:** Fair -- every robot gets exactly the same computation budget. Prevents
infinite loops and resource hogging. No coroutine complexity.
**Cons:** More complex setup (WASM binary instrumentation). Robot code must be
structured as a per-tick function rather than a continuous loop. Instruction budget
must be calibrated carefully.

#### Option C: Turn-Based (One Call Per Tick)

Each tick, the engine calls each robot's `onTick(state)` function. The robot
returns an action (or set of actions) synchronously. Simplest possible model.

```typescript
// Robot code
function onTick(state: RobotState): Action {
    if (state.scannedEnemy) {
        return { type: 'fire', power: 3 };
    }
    return { type: 'move', distance: 8 };
}
```

**Pros:** Dead simple. No concurrency issues. Easy to sandbox. Easy to test.
**Cons:** Least expressive -- can only do one thing per tick. No persistent state
between ticks without explicit state management. Robot code feels more like a
callback than a program.

### 2.2 How the Original Games Handled This

| Game          | Model                    | Details                              |
|---------------|--------------------------|--------------------------------------|
| Robocode      | Cooperative multitasking | Java threads, blocking API calls     |
| Robot Battle  | Instruction-counted      | RIPPLE language, interpreter counted instructions |
| RoboWar       | Instruction-counted      | Stack-based language, fixed ops/tick |
| Screeps       | Turn-based callback      | JS, one `module.loop()` per tick     |

The original Robot Battle (Mac, 1991) used its own interpreted language (RIPPLE)
and counted instructions per tick natively in the interpreter -- essentially the
same concept as WASM fuel metering.

### 2.3 WASM Fuel Metering in Detail

For running in the browser, the most viable approach to instruction metering:

**Compile-time injection (wasm-metering pattern):**

```
Original WASM binary
    |
    v
[wasm-metering transform]
    |
    v
Instrumented WASM binary (with gas counting injected)
    |
    v
Browser instantiates with imported gas counter function
```

The `wasm-metering` npm package (now orphaned but forked as `@permaweb/wasm-metering`)
works by:

1. Parsing the WASM binary.
2. Identifying basic blocks (sequences of instructions between branches).
3. Injecting a call to `metering.usegas(cost)` at the start of each block.
4. The cost is configurable per-opcode via a cost table.
5. The host JavaScript provides the `usegas` import and tracks remaining gas.

**Typical gas costs (from Ethereum WASM research):**
- Simple arithmetic (add, sub, mul): 1 gas each
- Memory load/store: 3 gas each
- Control flow (br, call): 2 gas each
- Division: 3 gas
- Floating-point ops: 2-4 gas

With a budget of 10,000 gas per tick, a robot can execute roughly 5,000-10,000
real instructions depending on the mix -- enough for pathfinding, trigonometry,
and decision-making.

### 2.4 Recommendation

**Use a hybrid of Option B (instruction-budgeted) and Option C (turn-based).**

The execution model:

1. Each tick, the engine calls each robot's exported `onTick` function.
2. The WASM module has been pre-instrumented with gas metering.
3. The robot has a gas budget of N per tick (e.g., 10,000).
4. The robot's `onTick` receives the current game state and returns actions.
5. If gas is exhausted mid-execution, the robot's turn ends with whatever actions
   were queued so far (or a no-op).
6. Between ticks, the robot can maintain persistent state in WASM linear memory.

This gives us:
- Fairness (instruction budget).
- Simplicity (no coroutines or threads needed).
- Expressiveness (robots keep state in WASM memory, can run complex logic).
- Browser compatibility (wasm-metering works in any browser).

---

## 3. Physics and Collision Detection

### 3.1 Robot Hitboxes

**Recommendation: Use circle hitboxes.**

| Shape     | Pros                                    | Cons                              |
|-----------|-----------------------------------------|-----------------------------------|
| Circle    | Simplest collision math, rotation-invariant | Less visually accurate for tanks |
| AABB      | Simple, fast                            | Rotation changes bounds           |
| OBB       | Accurate for rotated rectangles         | Complex collision math            |

Circle-circle collision is a single distance check:
`colliding = distance(a, b) < a.radius + b.radius`

For 8 robots, this is 28 pair checks per tick -- trivially fast.

Robocode uses a 36x36 pixel bounding box for robots. For Robot Battle, a circle
with radius 18 units is equivalent and simpler.

**Proposed robot dimensions:**
- Hitbox: Circle with radius 18 units
- Visual: 36x36 unit square (rendered), with circular collision

### 3.2 Bullet Trajectory: Hitscan vs Projectile

| Approach     | Description                          | Pros                      | Cons                          |
|--------------|--------------------------------------|---------------------------|-------------------------------|
| Hitscan      | Bullet hits instantly along a ray    | Simple, no bullet state   | Unrealistic, no dodging       |
| Projectile   | Bullet travels with finite speed     | Tactical depth, dodgeable | Must track bullet entities    |

**Recommendation: Projectile with travel time** (matching Robocode).

Robocode bullet speed formula: `speed = 20 - 3 * firepower`

| Firepower | Speed (units/tick) | Damage          | Notes           |
|-----------|--------------------|-----------------|-----------------|
| 0.1       | 19.7               | 0.4             | Fast, low damage |
| 1.0       | 17.0               | 4.0             | Standard        |
| 2.0       | 14.0               | 6.0 (4+2)      | Medium          |
| 3.0       | 11.0               | 8.0 (4+4)      | Slow, high damage |

Damage formula: `damage = 4 * firepower + max(0, 2 * (firepower - 1))`

With an arena of ~800x600, a max-power bullet crosses the arena in ~55-73 ticks.
A min-power bullet crosses in ~30-41 ticks. This gives meaningful travel time and
dodging opportunity.

**Bullet-robot collision:** Each tick, move the bullet by its velocity vector.
Check if the bullet's new position is within any robot's hitbox circle. For fast
bullets, use swept-circle collision (check along the line segment from old to new
position) to prevent tunneling.

### 3.3 Scan Mechanics (Ray-Casting)

The scan originates from the robot's gun turret and casts a ray in the gun's
facing direction. The scan has a limited arc width (e.g., 10 degrees) rather than
being an infinitely thin ray, making it more forgiving and strategic.

**Proposed scan mechanics:**

| Parameter      | Value            | Rationale                           |
|----------------|------------------|-------------------------------------|
| Scan origin    | Robot center     | Gun turret position                 |
| Scan direction | Gun heading      | Independent of body heading         |
| Scan arc       | 10 degrees       | Wider = easier to find, less precise |
| Scan range     | 1200 units       | Covers full arena diagonal          |
| Scan cost      | 1 tick           | Consumes the robot's tick action    |

**What a scan returns:**
```typescript
interface ScanResult {
    found: boolean;
    entity?: {
        type: 'robot' | 'mine' | 'cookie';
        distance: number;      // units from scanner
        bearing: number;       // angle relative to gun heading
        // If robot:
        energy?: number;       // target's current health
        velocity?: number;     // target's current speed
        heading?: number;      // target's body heading
    };
}
```

A scan only returns the nearest entity in the arc. The robot must actively scan
(it costs a tick), creating a trade-off between information gathering and action.

**Implementation:** For each entity, check if it falls within the scan cone
(angle check) and within range (distance check). Among all entities in the cone,
return the nearest. With 8 robots + mines + cookies (~20-30 entities max), brute
force is fine.

### 3.4 Wall Collisions and Arena Boundaries

**Arena:** Rectangular, 800x600 units (adjustable). Origin at top-left (0,0),
or centered -- centered is more intuitive for robot programmers.

**Wall collision handling:**
1. After computing a robot's new position, clamp it to stay within arena bounds
   (accounting for robot radius).
2. Apply wall damage: `damage = max(0, abs(velocity) * 0.5 - 1)`.
3. Set velocity to zero on collision.

This matches the Robocode model: hitting walls hurts more at high speed, and
the robot stops. This punishes careless movement and rewards arena awareness.

### 3.5 Mines and Cookies

**Mines (damage zones):**
- Placed at fixed or random positions at round start.
- Stationary, visible on the arena.
- Collision: robot center enters mine radius -> mine explodes.
- Mine damage: 15 HP (significant but not lethal from full health).
- Mine radius: 10 units.
- After detonation, the mine is removed.
- Count: 4-8 per round (scaled to arena size).

**Cookies (health pickups):**
- Spawned periodically during the round (e.g., every 200 ticks).
- Placed at random positions (using the seeded PRNG).
- Collision: robot center enters cookie radius -> cookie consumed.
- Health restored: 20 HP.
- Cookie radius: 10 units.
- Max cookies on field at once: 3.
- This encourages movement and map control.

### 3.6 Spatial Partitioning

**For 8 robots, spatial partitioning is unnecessary.**

Entity counts per tick:
- 8 robots (max)
- ~16-24 bullets (if everyone is firing frequently)
- 4-8 mines
- 0-3 cookies
- **Total: ~30-40 entities**

Collision pair checks:
- Robot-robot: C(8,2) = 28 checks
- Bullet-robot: 24 * 8 = 192 checks
- Robot-mine: 8 * 8 = 64 checks
- Robot-cookie: 8 * 3 = 24 checks
- Bullet-wall: 24 checks
- **Total: ~330 checks per tick**

Each check is a distance comparison (2 subtractions, 2 multiplications, 1
comparison). At ~5ns per check, that is ~1.7 microseconds per tick for all
collisions. A grid or quadtree would add overhead greater than the savings.

**Recommendation: Brute-force O(n^2) collision detection.** It is simpler, faster
for this entity count, and introduces zero structural complexity.

---

## 4. Determinism and Reproducibility

### 4.1 Why Determinism Matters

For Robot Battle, determinism is a hard requirement:

1. **Tournament fairness:** Two runs of the same matchup must produce identical
   results. Otherwise rankings are unreliable.
2. **Replay:** Record only inputs + seed, replay deterministically. This reduces
   replay storage by 100-1000x compared to full state recording.
3. **Debugging:** Robot authors can reproduce exact scenarios to debug their code.
4. **Batch simulation:** 10,000 rounds must produce the same final scores every
   time they are run.

### 4.2 Floating-Point Challenges

IEEE 754 floating-point arithmetic is deterministic on a single platform with
identical compiler settings. However, it is NOT reproducible across:

- Different JavaScript engines (V8 vs SpiderMonkey vs JavaScriptCore).
- Different CPU architectures (x86 vs ARM -- different FMA behavior).
- Different optimization levels (JIT reordering of operations).
- Different WASM engines (even for the same WASM binary).

Specific problem areas:
- `Math.sin()`, `Math.cos()`, `Math.atan2()` -- implementations vary.
- Fused multiply-add (FMA) instructions -- some CPUs fuse `a*b+c` into one
  operation with different rounding than separate multiply and add.
- Expression evaluation order under optimization.
- Denormalized numbers handled differently on some platforms.

### 4.3 Solution: Integer/Fixed-Point Arithmetic

**Recommendation: Use integer arithmetic for all game simulation math.**

Integer arithmetic (`+`, `-`, `*`, with careful handling of `/`) is perfectly
deterministic across all platforms. JavaScript's bitwise operators (`|0`, `>>> 0`)
force values to 32-bit integers.

**Approach 1: Pure Integer (Simplest)**

Scale all game values by a fixed factor. Example: 1 unit = 256 internal units
(8-bit fractional precision).

```typescript
// Internal representation: Q24.8 fixed point
const SCALE = 256;  // 2^8

// Position: 800 * 256 = 204,800 (fits in 32-bit int)
// Velocity: 8 * 256 = 2,048
// Angle: use 0-65535 for 0-360 degrees (16-bit angle)

function fixedMul(a: number, b: number): number {
    return (a * b) >> 8;  // Multiply, then shift back
}

function fixedDiv(a: number, b: number): number {
    return (a << 8) / b | 0;  // Shift up, divide, truncate
}
```

**Approach 2: Q16.16 Fixed-Point Library**

Use a library like `@shaisrc/fixed-point` for TypeScript. This provides:
- Q16.16 format (16 bits integer, 16 bits fraction).
- Deterministic sin/cos via lookup tables (3x faster than `Math.sin`).
- Overflow-safe operations.
- BigInt backend for operations that need more precision.

Performance benchmarks (5M iterations):

| Operation                   | Time (ms)  |
|-----------------------------|------------|
| Native add/mul              | 6.7        |
| Fixed-point add/mul (number)| 120.2      |
| Fixed-point add/mul (BigInt)| 389.5      |
| Native Math.sin             | 197.9      |
| Fixed-point sin (LUT)       | 64.8       |

Fixed-point basic arithmetic is ~18x slower than native floats, but the LUT-based
trig is 3x faster. For our use case (330 collision checks + 8 robot updates per
tick), even the overhead is negligible -- we are doing ~500 arithmetic operations
per tick, not millions.

**Approach 3: Integer Angles with Lookup Tables (Recommended)**

Use regular integers for positions and velocities (scaled by 256). For angles,
use a 16-bit integer (0-65535 = 0-360 degrees). Pre-compute sin/cos lookup tables
with 65536 entries, storing results as fixed-point integers.

```typescript
// Pre-computed: SIN_TABLE[angle] = Math.round(Math.sin(angle * 2 * Math.PI / 65536) * 256)
const SIN_TABLE = new Int16Array(65536);
const COS_TABLE = new Int16Array(65536);

function moveRobot(x: number, y: number, angle: number, speed: number) {
    // All integer math, fully deterministic
    x += (speed * COS_TABLE[angle]) >> 8;
    y += (speed * SIN_TABLE[angle]) >> 8;
    return { x, y };
}
```

This approach:
- Uses only integer arithmetic (deterministic everywhere).
- Requires no external library.
- Is extremely fast (array lookups + integer multiply + shift).
- Provides sufficient precision for a game (1/256 unit resolution).

### 4.4 Seeded Random Number Generator

All random events (spawn positions, cookie placement, initial robot positions)
must use a seeded PRNG. JavaScript's `Math.random()` is not seedable.

**Recommended: Mulberry32**

A 32-bit state PRNG that passes all standard randomness tests and is extremely
fast:

```typescript
function mulberry32(seed: number): () => number {
    return function() {
        let t = seed += 0x6D2B79F5;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Usage: every round gets a unique seed
const rng = mulberry32(roundSeed);
const cookieX = Math.floor(rng() * ARENA_WIDTH);
```

Properties:
- Period: ~2^32 (~4 billion values before repeating).
- Speed: ~50M calls/second in JavaScript.
- Quality: passes gjrand test suite.
- Deterministic: same seed always produces same sequence.

For integer-only output (avoiding the float division), return the raw 32-bit value:

```typescript
function mulberry32int(seed: number): () => number {
    return function() {
        let t = seed += 0x6D2B79F5;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return (t ^ (t >>> 14)) >>> 0;  // Returns 0 to 2^32-1
    };
}
```

### 4.5 Ensuring Identical Results

Checklist for guaranteed determinism:

1. **No floating-point math in simulation.** All positions, velocities, angles,
   damage values use integers (or fixed-point integers).
2. **Seeded PRNG for all randomness.** Never use `Math.random()`.
3. **Deterministic iteration order.** Process robots in a fixed order (by ID).
   Never iterate over `Map` or `Set` if insertion order might vary. Use arrays.
4. **No time-dependent logic.** Never use `Date.now()` or `performance.now()` in
   simulation. The tick counter is the only clock.
5. **Deterministic WASM execution.** WASM is deterministic by spec (aside from
   NaN bit patterns and floating-point). If robot code uses WASM floats, results
   may vary. Restrict robot WASM to integer operations, or accept the (small)
   risk of NaN non-determinism.
6. **Fixed processing order per tick.** Document and enforce the exact order:
   robots execute -> bullets move -> robots move -> collisions resolve -> scans
   execute -> events fire.
7. **No parallelism within a single round.** A single round must run on a single
   thread. Parallelism is achieved by running different rounds on different workers.

---

## 5. Game Mechanics Design

### 5.1 Robot Stats

| Stat              | Value           | Notes                                  |
|-------------------|-----------------|----------------------------------------|
| Starting HP       | 100             | Standard for combat games              |
| Max HP            | 100             | Cannot exceed starting HP (without cookies) |
| Max HP (with cookies) | 130         | Soft cap to prevent excessive turtling |
| Body speed        | 0-8 units/tick  | Accelerate at 1, decelerate at 2       |
| Body turn rate    | 10 - 0.75*|v| deg/tick | Slower turning at higher speed   |
| Gun turn rate     | 20 deg/tick     | Independent of body rotation           |
| Fire cooldown     | 1 + power/5 ticks | Higher power = longer cooldown       |
| Robot radius      | 18 units        | Collision hitbox                       |

### 5.2 Damage Model

**Bullet damage:**
```
damage = 4 * firepower
if firepower > 1:
    damage += 2 * (firepower - 1)
```

| Firepower | Damage | Bullets to Kill (from 100 HP) |
|-----------|--------|-------------------------------|
| 0.1       | 0.4    | 250                           |
| 1.0       | 4.0    | 25                            |
| 2.0       | 6.0    | 17                            |
| 3.0       | 8.0    | 13                            |

Firing costs energy equal to the firepower value. Hitting an enemy returns
3 * firepower energy to the shooter, rewarding accuracy.

**Collision damage:**
- Robot-robot collision: 0.6 damage to each robot.
- Wall collision: `max(0, abs(velocity) * 0.5 - 1)` damage.

**Mine damage:**
- Direct contact: 15 damage.
- Mines are one-shot -- they disappear after detonation.

### 5.3 Cookies / Health Pickups

| Property       | Value              |
|----------------|--------------------|
| Health restored | 20 HP             |
| Spawn interval | Every 200 ticks    |
| Max on field   | 3                  |
| Placement      | Random (seeded PRNG), minimum 100 units from any robot |
| Pickup radius  | 10 units           |
| Visibility     | Always visible (encourages map control) |

Cookies serve multiple purposes:
- Reward aggressive robots that control the map.
- Provide comeback mechanics for damaged robots.
- Create contested objectives that force engagement.

### 5.4 Arena Design

| Property    | Value           | Notes                              |
|-------------|-----------------|-------------------------------------|
| Shape       | Rectangle       | Simplest wall collision             |
| Size        | 800 x 600 units | ~22 robot-widths across             |
| Coordinate system | Center at (0,0) | x: -400 to 400, y: -300 to 300 |
| Walls       | Solid, damaging | Robots bounce and take damage       |

The arena is large enough that robots can maneuver but small enough that
encounters are frequent. With 8 robots, the average distance between any two
robots is approximately 300 units, meaning bullets take 15-27 ticks to travel
between them -- enough time for dodging but not so much that combat is rare.

### 5.5 Round End Conditions

A round ends when any of these conditions are met:

1. **Last robot standing:** Only one robot has HP > 0.
2. **Time limit:** 2,000 ticks have elapsed.
3. **All robots immobile:** All remaining robots have been stationary for 100
   consecutive ticks (anti-stalemate).

If time runs out:
- The robot with the highest HP wins.
- Ties broken by total damage dealt, then by random (seeded) coin flip.

### 5.6 Scoring Across Thousands of Rounds

For ranking robots across 10,000+ rounds with up to 8 players:

**Option 1: Point-Based (Recommended for simplicity)**

| Placement | Points (8 players) | Points (4 players) |
|-----------|-------------------|---------------------|
| 1st       | 10                | 10                  |
| 2nd       | 7                 | 6                   |
| 3rd       | 5                 | 3                   |
| 4th       | 3                 | 1                   |
| 5th       | 2                 | -                   |
| 6th       | 1                 | -                   |
| 7th-8th   | 0                 | -                   |

Total score = sum of points across all rounds. Simple, transparent, easy to
display on a leaderboard.

**Option 2: Multiplayer Elo**

Treat each round as a set of pairwise matchups between all players. For N players,
each round generates N*(N-1)/2 pairwise results. Update Elo ratings using the
multiplayer extension:

- Expected score for player i vs j: `E_ij = 1 / (1 + 10^((R_j - R_i) / 400))`
- K-factor scaled by (N-1) to account for multiple opponents.
- Starting rating: 1500.

Elo is better for matchmaking and skill assessment but harder to explain to
players. It also converges more slowly (needs ~100+ rounds for stable ratings).

**Recommendation:** Use point-based scoring for the main leaderboard. Optionally
compute Elo ratings behind the scenes for matchmaking or advanced analytics.

---

## 6. Performance for Batch Simulation

### 6.1 Performance Budget

**Target:** Simulate 10,000 rounds of 2,000 ticks each (20M total ticks) in under
10 seconds wall-clock time on a modern machine.

**Per-tick cost estimate:**

| Operation                     | Time Estimate | Count      | Total      |
|-------------------------------|---------------|------------|------------|
| Robot WASM execution (8 bots) | 5 us each     | 8          | 40 us      |
| Physics update (movement)     | 0.1 us/robot  | 8          | 0.8 us     |
| Bullet updates                | 0.05 us each  | 20 avg     | 1.0 us     |
| Collision detection           | 0.005 us/pair | 330        | 1.7 us     |
| Scan resolution               | 0.5 us/scan   | 2 avg      | 1.0 us     |
| State bookkeeping             | 1 us          | 1          | 1.0 us     |
| **Total per tick**            |               |            | **~45 us** |

At 45 microseconds per tick:
- 1 round (2,000 ticks) = 90 ms
- 10,000 rounds = 900 seconds (single-threaded) -- **too slow**

The bottleneck is WASM execution (40 us of the 45 us budget). Without WASM
(pure JS robot execution), the per-tick budget drops to ~5 us:
- 10,000 rounds = 100 seconds (single-threaded) -- still needs parallelism.

### 6.2 Optimization Strategies

**1. Parallelize across Web Workers.**

Each round is independent. Distribute rounds across workers:

| Workers | Rounds/worker | Wall time (45 us/tick) | Wall time (5 us/tick) |
|---------|---------------|------------------------|------------------------|
| 1       | 10,000        | 900s                   | 100s                   |
| 4       | 2,500         | 225s                   | 25s                    |
| 8       | 1,250         | 112s                   | 12.5s                  |
| 16      | 625           | 56s                    | 6.3s                   |

With 8 workers and optimized JS robots (no WASM), 10,000 rounds takes ~12.5
seconds. With WASM robots and 16 workers (on an 8-core machine with
hyperthreading), ~56 seconds. This suggests WASM fuel metering has a real
performance cost for batch mode.

**2. Optimize WASM execution cost.**

- Pre-compile WASM modules once, instantiate per round (not per tick).
- Reuse WASM memory across ticks within a round.
- Use low-overhead metering: count gas per basic block, not per instruction.
- Consider a "fast mode" for batch that gives robots more gas but limits wall-clock
  time per tick.

**3. Skip unnecessary computation.**

- Dead robots: skip their execution entirely.
- No-scan ticks: skip scan resolution.
- Bullet-free ticks: skip bullet collision checks.
- Early round termination: end round when only 1 robot remains.

**4. Use TypedArrays for state.**

Store all entity positions/velocities in flat `Float64Array` or `Int32Array`
buffers. This improves cache locality and avoids GC pressure from object
allocation.

```typescript
// Instead of: robots.map(r => ({ x: r.x, y: r.y, ... }))
// Use flat arrays:
const robotX = new Int32Array(8);
const robotY = new Int32Array(8);
const robotHP = new Int32Array(8);
const robotAngle = new Uint16Array(8);
const robotSpeed = new Int32Array(8);
```

**5. Profile and measure.**

Use `performance.now()` to measure tick times. Identify whether WASM execution,
collision detection, or state management is the actual bottleneck. Optimize based
on data, not assumptions.

### 6.3 Web Worker Architecture

```
Main Thread (UI)
    |
    |--- Worker 1: rounds 0-1249
    |--- Worker 2: rounds 1250-2499
    |--- Worker 3: rounds 2500-3749
    |--- Worker 4: rounds 3750-4999
    |--- Worker 5: rounds 5000-6249
    |--- Worker 6: rounds 6250-7499
    |--- Worker 7: rounds 7500-8749
    |--- Worker 8: rounds 8750-9999
    |
    v
Collect results, compute scores
```

Each worker:
1. Receives: robot WASM binaries + round seeds + game config.
2. Instantiates WASM modules once.
3. Runs N rounds sequentially.
4. Returns: array of round results (placements, scores, stats).

Communication uses `postMessage` with `Transferable` objects (ArrayBuffers)
to avoid copying overhead.

**Memory per worker:**
- Simulation state: ~10 KB (positions, velocities, HP, bullets, mines, cookies).
- WASM module (compiled): ~50-200 KB per robot (shared via `WebAssembly.Module`).
- WASM instance memory: 64 KB - 1 MB per robot (depends on robot complexity).
- Per worker total: ~1-10 MB for 8 robot instances.
- 8 workers: ~8-80 MB total. Easily fits in memory.

### 6.4 Batch Mode Without WASM

For maximum batch speed, consider supporting a "JavaScript-only" robot mode where
robot code is a plain JS function. This avoids WASM instantiation and metering
overhead entirely. Instruction budgets can be enforced via a tick-counting
interpreter or simply by limiting wall-clock time per `onTick` call.

For competitive/tournament mode, use WASM with full metering. For development
and testing, use JS mode for fast iteration.

---

## 7. State Serialization and Replay

### 7.1 Two Approaches to Replay

**Input Recording (Deterministic Replay):**
- Record only: round seed + robot code (or hashes) + any external inputs.
- Replay by re-running the simulation with the same inputs.
- Requires perfect determinism.
- Extremely compact.
- Cannot seek to arbitrary points without replaying from the start.

**State Snapshot Recording:**
- Record the full game state every tick (or every N ticks).
- Replay by reading state snapshots.
- Does not require determinism.
- Larger data, but supports seeking and partial replay.

**Hybrid approach (Recommended):**
- Record inputs for deterministic replay (primary).
- Record full state snapshots at keyframe intervals (e.g., every 100 ticks) for
  fast seeking.
- To seek to tick 750: load keyframe at tick 700, replay 50 ticks from there.

### 7.2 What to Record

**Per-round header (recorded once):**
```typescript
interface RoundHeader {
    roundNumber: number;        // 4 bytes
    seed: number;               // 4 bytes
    robotIds: string[];         // Robot code identifiers/hashes
    arenaWidth: number;         // 4 bytes
    arenaHeight: number;        // 4 bytes
    config: GameConfig;         // ~100 bytes
}
```

**Per-tick state snapshot:**
```typescript
interface TickState {
    tick: number;                // 2 bytes (0-2000)
    robots: {                   // Per robot (8 max):
        x: number;              //   4 bytes
        y: number;              //   4 bytes
        heading: number;        //   2 bytes
        gunHeading: number;     //   2 bytes
        velocity: number;       //   2 bytes
        hp: number;             //   2 bytes
        gunHeat: number;        //   2 bytes
        alive: boolean;         //   1 byte
    }[];                        //   = 19 bytes * 8 = 152 bytes
    bullets: {                  // Per bullet (variable, ~20 avg):
        x: number;              //   4 bytes
        y: number;              //   4 bytes
        heading: number;        //   2 bytes
        power: number;          //   1 byte
        owner: number;          //   1 byte
    }[];                        //   = 12 bytes * 20 = 240 bytes
    events: GameEvent[];        //   Variable, ~20 bytes avg
}
// Total per tick: ~414 bytes average
```

### 7.3 Data Size Estimates

**Full state recording (every tick):**

| Metric              | Value                         |
|---------------------|-------------------------------|
| Per tick            | ~414 bytes                    |
| Per round (2,000 ticks) | ~828 KB                  |
| 10,000 rounds       | ~8.28 GB (uncompressed)       |
| With compression    | ~1-2 GB (gzip typically 4-8x) |

This is too large for batch simulation. Full state recording should only be used
for individual replays, not batch runs.

**Input-only recording (deterministic replay):**

| Metric              | Value                     |
|---------------------|---------------------------|
| Per round           | ~200 bytes (seed + config)|
| 10,000 rounds       | ~2 MB                     |
| Plus results        | ~500 bytes/round          |
| Total               | ~7 MB                     |

This is extremely compact. For batch simulation, record only the round seed and
results. Full replay data is generated on-demand when a user wants to watch a
specific round.

**Keyframed hybrid (for viewable replays):**

| Metric              | Value                     |
|---------------------|---------------------------|
| Keyframe interval   | Every 100 ticks           |
| Keyframes per round | 20                        |
| Per keyframe        | ~200 bytes                |
| Events between keyframes | ~2 KB              |
| Per round total     | ~44 KB                    |
| Single replay       | ~44 KB (compressed ~10 KB)|

### 7.4 Binary Format vs JSON

**JSON:**
- Human-readable, easy to debug.
- ~3-5x larger than binary.
- Parsing is slow for large data (JSON.parse is single-threaded).
- Good for: configuration files, debug output, small replays.

**Binary (ArrayBuffer / DataView):**
- Compact, fast to read/write.
- Use `DataView` for structured binary data.
- Good for: replay files, batch results, worker communication.

**Recommended format for replay files:**

```
[4 bytes: magic number "RBTL"]
[4 bytes: version]
[4 bytes: round seed]
[2 bytes: tick count]
[2 bytes: robot count]
[N bytes: robot metadata]
[repeat for each tick:]
    [2 bytes: tick number]
    [2 bytes: event count]
    [N bytes: events (type + data)]
[4 bytes: checksum]
```

Using a custom binary format with DataView:

```typescript
function serializeTick(view: DataView, offset: number, state: TickState): number {
    view.setUint16(offset, state.tick); offset += 2;
    for (const robot of state.robots) {
        view.setInt32(offset, robot.x); offset += 4;
        view.setInt32(offset, robot.y); offset += 4;
        view.setUint16(offset, robot.heading); offset += 2;
        view.setUint16(offset, robot.gunHeading); offset += 2;
        view.setInt16(offset, robot.velocity); offset += 2;
        view.setInt16(offset, robot.hp); offset += 2;
        view.setUint8(offset, robot.alive ? 1 : 0); offset += 1;
    }
    // bullets...
    return offset;
}
```

### 7.5 Event-Based Recording (Recommended for Replays)

Instead of recording full state every tick, record only events (state changes):

```typescript
type GameEvent =
    | { type: 'robot_move'; id: number; x: number; y: number; heading: number }
    | { type: 'robot_fire'; id: number; power: number }
    | { type: 'bullet_hit'; bulletId: number; targetId: number; damage: number }
    | { type: 'robot_death'; id: number }
    | { type: 'mine_explode'; mineId: number; robotId: number }
    | { type: 'cookie_spawn'; x: number; y: number }
    | { type: 'cookie_pickup'; cookieId: number; robotId: number }
    | { type: 'scan_result'; robotId: number; found: boolean; targetId?: number }
    | { type: 'wall_hit'; robotId: number; damage: number };
```

Since robot movement is continuous and predictable (constant velocity between
acceleration changes), we only need to record velocity/heading changes, not every
position. The renderer interpolates positions between events.

Estimated event data per round: ~5-15 KB (compressed: ~1-4 KB). This is the
sweet spot between full state recording and input-only recording.

---

## 8. Summary of Recommendations

| Decision                  | Recommendation                                    |
|---------------------------|---------------------------------------------------|
| Simulation model          | Discrete tick-based, 2,000 ticks/round             |
| Robot execution           | Per-tick callback with WASM fuel metering           |
| Instruction budget        | 10,000 gas per tick per robot                       |
| Physics                   | Integer/fixed-point arithmetic, no floats           |
| Collision detection       | Brute-force circle-circle, ~330 checks/tick         |
| Bullet model              | Projectile with travel time (speed = 20 - 3*power)  |
| Scan model                | 10-degree arc ray from gun, returns nearest entity   |
| Determinism               | Integer math + seeded PRNG + fixed processing order  |
| PRNG                      | Mulberry32 (32-bit state, seedable)                  |
| Hitbox shape              | Circle (radius 18 units)                             |
| Arena                     | 800x600, centered coordinates                        |
| Scoring                   | Point-based placement scoring                        |
| Batch parallelism         | 8 Web Workers, each running independent rounds       |
| Replay format             | Event-based binary, ~5-15 KB per round               |
| Batch result storage      | Input-only (seed + results), ~7 MB for 10K rounds    |

### Implementation Priority

1. **Core tick loop** with integer physics (no WASM yet, use JS robot stubs).
2. **Collision detection** (circle-circle for all entity types).
3. **Bullet and scan mechanics.**
4. **Seeded PRNG and determinism verification** (run same round twice, compare).
5. **Simple JS robot API** (onTick callback, return actions).
6. **Web Worker batch runner.**
7. **Event-based replay recording.**
8. **WASM robot loading and fuel metering.**
9. **Real-time renderer with tick interpolation.**
