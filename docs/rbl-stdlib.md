# RBL Standard Library Reference

## Language Basics

### Types

| Type    | Description                          | Literal examples        |
|---------|--------------------------------------|------------------------|
| `int`   | 32-bit signed integer                | `42`, `-1`, `0`        |
| `float` | 32-bit float                         | `3.14`, `-0.5`, `1.0`  |
| `angle` | Float in degrees (0-360), wraps      | `angle(90)`            |
| `bool`  | Boolean                              | `true`, `false`        |

Type conversions: `int(x)`, `float(x)`, `angle(x)`. No implicit coercion between int/float - you must write `42.0` for float, `angle(90)` for angle.

### Structure

```
robot "MyBot"

var myVar int = 0
var speed float = 50.0

func init() { }       // Called once at start
func tick() { }       // Called every tick

on scan(distance float, bearing angle) { }
on hit(damage float, bearing angle) { }
on wallHit(bearing angle) { }
```

### Control Flow

```
if condition { }
if condition { } else { }
for i := 0; i < 10; i = i + 1 { }
break
continue
```

### Variables

```
var x int = 0              // Global variable
x := 10                    // Short declaration (local)
x = x + 1                 // Assignment
x += 1                    // Compound assignment (+=, -=, *=, /=)
```

### Operators

Arithmetic: `+`, `-`, `*`, `/`, `%`
Comparison: `==`, `!=`, `<`, `>`, `<=`, `>=`
Logical: `&&`, `||`, `!`

Angle arithmetic: angle must be on the LEFT side. `angle * float` works, `float * angle` is a type error.

---

## Events

| Event         | Parameters                          | When                              |
|---------------|-------------------------------------|-----------------------------------|
| `scan`        | `distance float, bearing angle`     | Radar detects an enemy robot. Bearing is relative to your heading. |
| `scanned`     | `bearing angle`                     | Your robot is scanned by an enemy. Bearing is relative to your heading. |
| `hit`         | `damage float, bearing angle`       | Your robot takes bullet damage. Bearing is relative to your heading. |
| `wallHit`     | `bearing angle`                     | Your robot collides with a wall. Bearing is relative to your heading. |
| `robotHit`    | `bearing angle`                     | Your robot collides with another robot. Bearing is relative to your heading. |
| `bulletHit`   | `robotId int`                       | Your bullet hits an enemy         |
| `bulletMiss`  | *(none)*                            | Your bullet leaves the arena      |
| `robotDeath`  | `robotId int`                       | An enemy robot dies               |

All bearings are relative to your robot's heading: 0 = straight ahead, positive = clockwise, negative = counter-clockwise. Range: [-180, 180].

---

## Movement

| Function                      | Description                                                |
|-------------------------------|------------------------------------------------------------|
| `setSpeed(speed float)`       | Set desired speed (-120 to 120). Negative = reverse.       |
| `setHeading(hdg angle)`       | Turn toward heading. Sets turn rate via angle difference — call every tick to track a target. |
| `setTurnRate(rate float)`     | Set body turn rate in deg/tick (max 12).                   |
| `getX() float`                | Current X position.                                        |
| `getY() float`                | Current Y position.                                        |
| `getHeading() angle`          | Current body heading (0=north, clockwise).                 |
| `getSpeed() float`            | Current actual speed.                                      |

**Important:** `setHeading` does NOT turn instantly. It sets `intendedTurnRate = angleDiff(current, target)`, clamped to max turn rate per tick. You must call it every tick if tracking a moving target. The robot takes several ticks to complete large turns.

**Important:** Wall collisions set speed to 0. If you want to keep moving after a wall hit, call `setSpeed` on the next tick (e.g. in `tick()`, not just in the `wallHit` handler).

## Gun

| Function                        | Description                                              |
|---------------------------------|----------------------------------------------------------|
| `setGunTurnRate(rate float)`    | Set gun turn rate in deg/tick (max 25).                  |
| `setGunHeading(hdg angle)`      | Turn gun toward heading. Same caveats as `setHeading`.   |
| `getGunHeading() angle`         | Current absolute gun heading.                            |
| `getGunHeat() float`            | Gun heat. 0 = ready to fire.                             |
| `fire(power float)`             | Fire a bullet (power 1-5). Higher = more damage, slower bullet, more heat. |
| `getEnergy() float`             | Current energy (0-100). Firing costs energy.             |

Bullet speed: `35 - 3 * power`. Bullet damage: `4 * power` (+ 2 bonus on direct hit).

## Radar

| Function                          | Description                                            |
|-----------------------------------|--------------------------------------------------------|
| `setRadarTurnRate(rate float)`    | Set radar turn rate in deg/tick (max 45).              |
| `setRadarHeading(hdg angle)`      | Turn radar toward heading.                             |
| `getRadarHeading() angle`         | Current absolute radar heading.                        |
| `setScanWidth(width float)`       | Set scan arc width in degrees (max 45, default 10).    |

## Status

| Function              | Description                    |
|-----------------------|--------------------------------|
| `getHealth() float`   | Current health (0-100).        |
| `getTick() int`       | Current tick number.           |

## Arena

| Function              | Description                    |
|-----------------------|--------------------------------|
| `arenaWidth() float`  | Arena width (default 800).     |
| `arenaHeight() float` | Arena height (default 600).    |
| `robotCount() int`    | Number of robots in the match. |

## Utility

| Function                           | Description                                       |
|------------------------------------|---------------------------------------------------|
| `distanceTo(x float, y float) float` | Distance from your robot to the point (x, y).   |
| `bearingTo(x float, y float) angle`  | Bearing from your robot to (x, y), relative to heading. 0 = ahead, ±180 = behind. |
| `random(max int) int`              | Random integer in [0, max).                        |
| `randomFloat() float`              | Random float in [0, 1).                            |

## Cosmetic

| Function                              | Description                    |
|---------------------------------------|--------------------------------|
| `setColor(r int, g int, b int)`       | Set body color (0-255 RGB).    |
| `setGunColor(r int, g int, b int)`    | Set gun color.                 |
| `setRadarColor(r int, g int, b int)`  | Set radar color.               |

## Debug

| Function                  | Description                                         |
|---------------------------|-----------------------------------------------------|
| `debugInt(value int)`     | Emit an integer debug value (shown in status panel). |
| `debugFloat(value float)` | Emit a float debug value.                            |
| `debugAngle(value angle)` | Emit an angle debug value (shown with degree symbol).|

The `debug()` overload automatically routes to the correct function based on argument type.

## Math

| Function                                     | Description                          |
|----------------------------------------------|--------------------------------------|
| `sin(a angle) float`                         | Sine.                                |
| `cos(a angle) float`                         | Cosine.                              |
| `tan(a angle) float`                         | Tangent.                             |
| `atan2(y float, x float) angle`              | Arctangent of y/x, returns angle.    |
| `sqrt(x float) float`                        | Square root.                         |
| `abs(x float) float`                         | Absolute value.                      |
| `min(a float, b float) float`                | Minimum of two values.               |
| `max(a float, b float) float`                | Maximum of two values.               |
| `clamp(x float, lo float, hi float) float`   | Clamp x to [lo, hi].                |
| `floor(x float) int`                         | Round down to integer.               |
| `ceil(x float) int`                           | Round up to integer.                 |
| `round(x float) int`                          | Round to nearest integer.            |

---

## Physics Reference

| Parameter             | Default | Notes                                    |
|-----------------------|---------|------------------------------------------|
| Max speed             | 120     | Units per second. Negative = reverse.    |
| Acceleration          | 8.0     | Per tick.                                |
| Deceleration          | 8.0     | Per tick.                                |
| Max body turn rate    | 12      | Degrees per tick.                        |
| Max gun turn rate     | 25      | Degrees per tick.                        |
| Max radar turn rate   | 45      | Degrees per tick.                        |
| Default scan width    | 10      | Degrees.                                 |
| Start health          | 100     |                                          |
| Start energy          | 100     |                                          |
| Energy regen          | 0.1     | Per tick.                                |
| Fire cost             | `power * 1.0` energy |                              |
| Gun heat per shot     | 1.0     |                                          |
| Gun cooldown rate     | 0.15    | Per tick.                                |
| Wall damage           | `speed * 0.1` | Speed zeroed on impact.            |
| Ram damage            | `0.5 + speed * 0.02` | Only on initial contact.      |
| Arena size            | 800 x 800 |                                       |

## Coordinate System

- Origin (0, 0) is top-left
- X increases rightward, Y increases downward
- Heading 0 = north (up), increases clockwise
- Heading 90 = east, 180 = south, 270 = west
