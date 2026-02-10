# Standard Library Reference

This document covers every API function available to RBL robot programs. Functions are grouped by category. All functions are imported into WASM from the `env` module and are available without qualification. For language syntax and type rules, see the [Language Reference](../reference/language.md).

All "set" functions record intents -- they do not take effect until the simulation engine processes them after `tick()` returns. All "get" functions return the current state as of the start of the current tick.

## Movement

| Function | Parameters | Return | Description |
|---|---|---|---|
| `setSpeed` | `speed float` | void | Set the desired speed. Clamped to [-120, 120]. Negative values move in reverse. The robot accelerates or decelerates toward this speed at the configured rate (default 8.0 per tick). |
| `setHeading` | `heading angle` | void | Turn the robot body toward the given absolute heading. Internally sets the turn rate to the shortest angular difference between the current heading and the target, clamped to the max turn rate. Must be called every tick to continuously track a target. |
| `setTurnRate` | `rate float` | void | Set the body turn rate directly in degrees per tick. Clamped to [-12, 12]. Positive = clockwise, negative = counter-clockwise. |
| `getX` | *(none)* | `float` | Returns the robot's current X position in arena coordinates. |
| `getY` | *(none)* | `float` | Returns the robot's current Y position in arena coordinates. |
| `getHeading` | *(none)* | `angle` | Returns the robot's current body heading. 0 = north (up), increases clockwise. Range: [0, 360). |
| `getSpeed` | *(none)* | `float` | Returns the robot's current actual speed. |

**Important notes:**

- `setHeading` does not turn instantly. It computes the shortest angular difference and sets the turn rate accordingly, clamped to the max turn rate per tick (default 12 deg/tick). Large turns take multiple ticks to complete.
- `setTurnRate` and `setHeading` both write to the same intent register. Calling both in the same tick means the last call wins.
- Wall collisions set speed to 0. To keep moving after a wall hit, call `setSpeed` again on the next tick.
- Movement is applied after `tick()` returns. The position you read with `getX`/`getY` during tick reflects the state before this tick's movement.

## Gun

| Function | Parameters | Return | Description |
|---|---|---|---|
| `setGunTurnRate` | `rate float` | void | Set gun rotation rate in degrees per tick. Clamped to [-15, 15]. |
| `setGunHeading` | `heading angle` | void | Turn the gun toward the given absolute heading. Same mechanics as `setHeading`: computes angle diff, clamps to max gun turn rate. |
| `getGunHeading` | *(none)* | `angle` | Returns the current absolute gun heading. |
| `getGunHeat` | *(none)* | `float` | Returns current gun heat. The gun can fire only when heat is 0.0. |
| `fire` | `power float` | void | Fire a bullet with the given power. Power is clamped to [1, 5]. The gun must be cool (heat == 0) and the robot must have sufficient energy. |
| `getEnergy` | *(none)* | `float` | Returns the robot's current energy level. |

**Fire mechanics:**

- Energy cost: `power * 1.0` (configurable via `fireCostFactor`).
- Gun heat after firing: `1.0 + power / 5`.
- Gun cooldown rate: 0.15 heat per tick.
- Bullet speed: `35 - 3 * power`. A power-1 bullet travels at 32 units/tick; a power-5 bullet at 20 units/tick.
- Bullet damage: `4 * power + max(0, power - 1) * 2`. A power-1 bullet deals 4 damage; a power-5 bullet deals 28 damage.
- When a bullet hits a target, the shooter receives `3 * power` energy back.
- The bullet spawns at the gun tip (robot position + robotRadius in the gun heading direction).
- `setGunTurnRate` and `setGunHeading` both write to the same intent register. The last call in a tick wins.

## Radar

| Function | Parameters | Return | Description |
|---|---|---|---|
| `setRadarTurnRate` | `rate float` | void | Set radar rotation rate in degrees per tick. Clamped to [-25, 25]. |
| `setRadarHeading` | `heading angle` | void | Turn radar toward the given absolute heading. Same mechanics as `setHeading`. |
| `getRadarHeading` | *(none)* | `angle` | Returns the current absolute radar heading. |
| `setScanWidth` | `degrees float` | void | Set the scan arc width in degrees. Clamped to [1, 45]. Default is 10. |

**Radar mechanics:**

- The radar detects enemies within its sweep arc each tick. The sweep arc is defined by the radar's previous heading and current heading, expanded by half the scan width on each side.
- When an enemy is detected, the `scan` event fires with the distance and relative bearing to the target. The detected robot receives a `scanned` event.
- Scan range is infinite by default (covers the entire arena).
- `setRadarTurnRate` and `setRadarHeading` both write to the same intent register. The last call in a tick wins.

## Status

| Function | Parameters | Return | Description |
|---|---|---|---|
| `getHealth` | *(none)* | `float` | Returns the robot's current health. Starts at 100. The robot dies when health reaches 0. |
| `getTick` | *(none)* | `int` | Returns the current tick number within the round. Starts at 1 and increments each tick. |

## Arena

| Function | Parameters | Return | Description |
|---|---|---|---|
| `arenaWidth` | *(none)* | `float` | Returns the arena width in pixels. Default is 800. |
| `arenaHeight` | *(none)* | `float` | Returns the arena height in pixels. Default is 800. |
| `robotCount` | *(none)* | `int` | Returns the total number of robots in the match (including dead robots). |

## Mine and Cookie Awareness

| Function | Parameters | Return | Description |
|---|---|---|---|
| `nearestMineDist` | *(none)* | `float` | Returns the distance to the nearest mine, or -1.0 if no mines exist in the arena. |
| `nearestMineBearing` | *(none)* | `angle` | Returns the relative bearing to the nearest mine (relative to robot heading). Returns 0 if no mines exist. |
| `nearestCookieDist` | *(none)* | `float` | Returns the distance to the nearest cookie, or -1.0 if no cookies exist in the arena. |
| `nearestCookieBearing` | *(none)* | `angle` | Returns the relative bearing to the nearest cookie (relative to robot heading). Returns 0 if no cookies exist. |

**Mines and cookies:**

- Mines deal 30 damage on contact with a robot. They can also be destroyed by bullets.
- Cookies restore 20 health on contact with a robot (capped at max health of 100). They can also be destroyed by bullets.
- Mines spawn every 200 ticks (up to 4 in the arena). Cookies spawn every 150 ticks (up to 3 in the arena).
- Spawns are placed at random positions at least 40 units from any alive robot.

## Utility

| Function | Parameters | Return | Description |
|---|---|---|---|
| `distanceTo` | `x float, y float` | `float` | Returns the Euclidean distance from the robot's current position to the point (x, y). |
| `bearingTo` | `x float, y float` | `angle` | Returns the relative bearing from the robot to the point (x, y). 0 = straight ahead, positive = clockwise, negative = counter-clockwise. Range: [-180, 180]. |
| `random` | `max int` | `int` | Returns a random integer in [0, max). Uses a seeded PRNG for deterministic replays. |
| `randomFloat` | *(none)* | `float` | Returns a random float in [0.0, 1.0). Uses a seeded PRNG for deterministic replays. |

## Math

All trigonometric functions operate in degrees, not radians.

| Function | Parameters | Return | Description |
|---|---|---|---|
| `sin` | `a angle` | `float` | Sine of the angle. Internally converts degrees to radians. |
| `cos` | `a angle` | `float` | Cosine of the angle. |
| `tan` | `a angle` | `float` | Tangent of the angle. |
| `atan2` | `y float, x float` | `angle` | Arctangent of y/x, returns result in degrees. |
| `sqrt` | `x float` | `float` | Square root. |
| `abs` | `x float` | `float` | Absolute value. |
| `min` | `a float, b float` | `float` | Returns the smaller of two values. |
| `max` | `a float, b float` | `float` | Returns the larger of two values. |
| `clamp` | `x float, lo float, hi float` | `float` | Clamps x to the range [lo, hi]. Equivalent to `min(max(x, lo), hi)`. |
| `floor` | `x float` | `int` | Rounds down to the nearest integer. |
| `ceil` | `x float` | `int` | Rounds up to the nearest integer. |
| `round` | `x float` | `int` | Rounds to the nearest integer. |

## Cosmetic

| Function | Parameters | Return | Description |
|---|---|---|---|
| `setColor` | `r int, g int, b int` | void | Set the robot body color. Each component is 0-255. |
| `setGunColor` | `r int, g int, b int` | void | Set the gun color. |
| `setRadarColor` | `r int, g int, b int` | void | Set the radar color. |

These functions are no-ops in the simulation engine but may be used by the renderer.

## Debug

| Function | Parameters | Return | Description |
|---|---|---|---|
| `debugInt` | `value int` | void | Emit an integer debug value. Captured by the debug log collector. |
| `debugFloat` | `value float` | void | Emit a float debug value. |
| `debugAngle` | `value angle` | void | Emit an angle debug value. |

The overloaded `debug(value)` function is also available. The compiler dispatches to the correct typed variant based on the argument type: `int` calls `debugInt`, `float` calls `debugFloat`, `angle` calls `debugAngle`.

## Physics Reference

### Movement

| Parameter | Default Value | Description |
|---|---|---|
| Max speed | 120 | Maximum absolute speed. Negative = reverse. |
| Acceleration | 8.0 | Speed increase per tick toward target speed. |
| Deceleration | 8.0 | Speed decrease per tick toward target speed. |
| Max body turn rate | 12 | Maximum degrees per tick for body rotation. |
| Turn rate speed factor | 0.05 | Turn rate decreases with speed (not currently applied in engine). |

### Gun

| Parameter | Default Value | Description |
|---|---|---|
| Max gun turn rate | 15 | Maximum degrees per tick for gun rotation. |
| Gun heat per shot | 1.0 | Base gun heat (formula: `1.0 + power / 5`). |
| Gun cooldown rate | 0.15 | Heat removed per tick. |
| Min fire power | 1 | Minimum fire power. |
| Max fire power | 5 | Maximum fire power. |
| Fire cost factor | 1.0 | Energy cost = `power * fireCostFactor`. |

### Radar

| Parameter | Default Value | Description |
|---|---|---|
| Max radar turn rate | 25 | Maximum degrees per tick for radar rotation. |
| Default scan width | 10 | Scan arc width in degrees at start. |
| Max scan width | 45 | Maximum scan arc width. |
| Scan range | Infinity | Maximum detection distance. |

### Bullets

| Parameter | Default Value | Description |
|---|---|---|
| Bullet speed base | 35 | Base bullet speed. |
| Bullet speed power factor | 3 | Speed = `base - factor * power`. |
| Bullet damage base | 4 | Base damage multiplier. Damage = `4 * power`. |
| Bullet damage bonus | 2 | Bonus damage = `max(0, power - 1) * 2`. |
| Bullet radius | 3 | Collision radius for bullets. |

### Damage

| Parameter | Default Value | Description |
|---|---|---|
| Wall damage speed factor | 0.1 | Wall damage = `abs(speed) * 0.1`. |
| Ram damage base | 0.5 | Base collision damage. |
| Ram damage speed factor | 0.02 | Collision damage = `0.5 + relativeSpeed * 0.02`. |
| Mine damage | 30 | Damage dealt by mine detonation. |
| Cookie health | 20 | Health restored by cookie pickup. |

### Health and Energy

| Parameter | Default Value | Description |
|---|---|---|
| Start health | 100 | Starting health for each round. |
| Max health | 100 | Maximum health. |
| Start energy | 100 | Starting energy for each round. |
| Max energy | 100 | Maximum energy. |
| Energy regen rate | 0.1 | Energy regenerated per tick. |

### Sizes

| Parameter | Default Value | Description |
|---|---|---|
| Robot radius | 10 | Collision radius for robots. |
| Bullet radius | 3 | Collision radius for bullets. |
| Mine radius | 8 | Collision radius for mines. |
| Cookie radius | 10 | Collision radius for cookies. |

### Arena and Spawns

| Parameter | Default Value | Description |
|---|---|---|
| Arena width | 800 | Arena width in pixels. |
| Arena height | 800 | Arena height in pixels. |
| Ticks per round | 2000 | Maximum ticks before time-limit round end. |
| Mine spawn interval | 200 | Ticks between mine spawns. |
| Mine max count | 4 | Maximum mines in the arena. |
| Cookie spawn interval | 150 | Ticks between cookie spawns. |
| Cookie max count | 3 | Maximum cookies in the arena. |
| Min spawn distance from robot | 40 | Minimum distance from any robot for mine/cookie spawns. |
| Min robot spacing | 80 | Minimum distance between robots at round start. |
| Fuel per tick | 10000 | Gas budget per tick (WASM instruction limit). |

## Coordinate System

- Origin (0, 0) is the top-left corner of the arena.
- X increases to the right.
- Y increases downward.
- Heading 0 = north (up), increasing clockwise: 90 = east, 180 = south, 270 = west.
- All bearings returned by API functions (bearingTo, scan bearing, etc.) are relative to the robot's current heading. 0 = straight ahead, positive = clockwise, negative = counter-clockwise. Range: [-180, 180].
