# Writing a Bot: From Zero to Competitive

This tutorial walks you through building a robot for Robot Battle, starting from
the absolute basics and working up to a fully competitive fighting bot. By the
end, you will understand movement, radar, shooting, events, and the tactical
patterns that separate a sitting duck from a serious contender.

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Your First Bot](#2-your-first-bot)
3. [Understanding the Arena](#3-understanding-the-arena)
4. [Movement](#4-movement)
5. [Radar and Scanning](#5-radar-and-scanning)
6. [Shooting](#6-shooting)
7. [Responding to Events](#7-responding-to-events)
8. [Putting It Together](#8-putting-it-together)
9. [Advanced Topics](#9-advanced-topics)
10. [Tips and Tricks](#10-tips-and-tricks)

---

## 1. Introduction

Robot Battle is an arena combat game. You write a robot in **RBL** (Robot Battle
Language), a small statically-typed language. Your code gets compiled to
WebAssembly and dropped into an 800x800 arena alongside other robots. Each robot
runs independently -- you cannot see the other robot's code, and you cannot
communicate with allies. You can only sense the world through your radar, react
to events, and issue commands to your body, gun, and radar.

The game runs in **ticks**. Every tick, the simulation engine:

1. Delivers any pending events (scans, hits, wall collisions) to your event handlers.
2. Calls your `tick()` function.
3. Applies your movement, turning, and firing commands.
4. Advances physics (moves bullets, checks collisions, cools the gun).

A round lasts up to 2000 ticks, or until only one robot remains alive.

Robots start with 100 health and 100 energy. Health goes down when you take
damage. Energy is spent to fire bullets and regenerates slowly (0.1 per tick).
Last robot standing wins the round.

---

## 2. Your First Bot

Every RBL program starts with a `robot` declaration and must define at least a
`tick()` function. Here is the absolute minimum:

```rbl
robot "MyFirstBot"

func tick() {
    // This runs every tick. Right now, we do nothing.
}
```

This compiles, but the robot just sits there motionless -- a perfect target.
Let us give it some personality. Add an `init()` function for one-time setup
and make the bot move:

```rbl
robot "MyFirstBot"

func init() {
    setColor(200, 60, 60)
    setGunColor(150, 40, 40)
    setRadarColor(255, 100, 100)
}

func tick() {
    setSpeed(50.0)
    setTurnRate(5.0)
}
```

**What is happening here:**

- `init()` runs once when the battle starts. We use it to set our robot's
  colors. This is optional but makes it easier to tell bots apart.
- `tick()` runs every simulation tick. We set a desired speed of 50 and a
  constant turn rate of 5 degrees per tick. The result: the bot drives in
  circles.

### The Tick Loop

The `tick()` function is the heart of your bot. Think of it as your main loop.
Every tick you get to:

- Read the world: `getX()`, `getY()`, `getHeading()`, `getHealth()`, etc.
- Issue commands: `setSpeed()`, `setHeading()`, `fire()`, etc.
- Update your own variables to track state between ticks.

Commands do not take effect instantly. You set *intentions*, and the physics
engine applies them after your tick returns, subject to acceleration limits
and turn rate caps.

### Types You Need to Know

RBL has four primitive types:

| Type    | Description                        | Example            |
|---------|------------------------------------|--------------------|
| `int`   | 32-bit signed integer              | `42`, `-1`, `0`    |
| `float` | 32-bit floating point              | `3.14`, `50.0`     |
| `angle` | Degrees (wraps at 0-360)           | `angle(90)`        |
| `bool`  | Boolean                            | `true`, `false`    |

There is no implicit coercion. If a function expects a `float`, you must pass
`50.0`, not `50`. Use `int()`, `float()`, and `angle()` to convert between
types when needed.

---

## 3. Understanding the Arena

Before writing movement code, you need to understand the coordinate system.

```
    (0,0) ────── X increases ──────► (800,0)
      │
      │
      Y increases
      │
      │
      ▼
    (0,800)                         (800,800)
```

- **Origin** is the top-left corner at (0, 0).
- **X** increases to the right.
- **Y** increases downward.
- The default arena is **800 by 800** units.

### Heading Convention

Headings use compass-style degrees:

- **0** = North (up, toward decreasing Y)
- **90** = East (right, toward increasing X)
- **180** = South (down, toward increasing Y)
- **270** = West (left, toward decreasing X)

Headings increase **clockwise**. The `angle` type wraps automatically, so
`angle(370)` is the same as `angle(10)`.

### Bearings

Many functions and events give you a **bearing** -- an angle *relative to your
robot's current heading*:

- **0** = straight ahead
- **Positive** = clockwise (to your right)
- **Negative** = counter-clockwise (to your left)
- Range: **-180 to +180**

For example, if your heading is 90 (facing east) and an enemy is due south,
the bearing to that enemy would be +90 (90 degrees clockwise from where
you are facing).

To convert a bearing to an absolute heading:

```rbl
absoluteHeading := getHeading() + bearing
```

This is a pattern you will use constantly.

---

## 4. Movement

### Setting Speed

```rbl
setSpeed(70.0)   // Drive forward at 70
setSpeed(-40.0)  // Reverse at 40
setSpeed(0.0)    // Stop
```

Speed ranges from -120 to 120. But your robot does not jump to the target speed
instantly. It **accelerates** at 8 units per tick and **decelerates** at 8 units
per tick. So going from 0 to 80 takes 10 ticks. Plan your maneuvers
accordingly.

### Setting Heading

There are two ways to control your robot's direction.

**Option 1: `setHeading(target)`** -- Point the robot toward an absolute heading.
The robot turns toward it at up to 12 degrees per tick. You must call this
*every tick* if tracking a moving target, because it sets the intended turn
rate based on the difference between your current heading and the target.

```rbl
setHeading(angle(90))  // Turn to face east
```

**Option 2: `setTurnRate(rate)`** -- Set a constant turn rate in degrees per tick.
Positive turns clockwise, negative turns counter-clockwise. Maximum is 12.

```rbl
setTurnRate(8.0)   // Spin clockwise at 8 deg/tick
setTurnRate(-8.0)  // Spin counter-clockwise
```

Note: the maximum body turn rate is 12 degrees per tick regardless of speed.

### Driving Toward a Point

A very common pattern is to drive toward a specific coordinate. The `bearingTo`
function gives you the relative angle to any point:

```rbl
func tick() {
    targetX := 400.0
    targetY := 400.0

    // Get bearing to target (relative to our heading)
    bearing := bearingTo(targetX, targetY)

    // Turn toward it
    setHeading(getHeading() + bearing)

    // Full speed ahead
    setSpeed(70.0)
}
```

`bearingTo(x, y)` returns an `angle` type that is negative if the point is to
your left and positive if it is to your right. Adding it to `getHeading()` gives
you the absolute heading toward that point. Calling `setHeading` with that
value will steer you there tick by tick.

You can also check how far away a point is:

```rbl
dist := distanceTo(400.0, 400.0)
if dist < 30.0 {
    setSpeed(0.0)  // We arrived, stop
}
```

---

## 5. Radar and Scanning

Your radar is how you find enemies. Without scanning, you are shooting blind.

### How Radar Works

The radar sits on top of your robot and rotates independently of the body.
Each tick, it sweeps an arc defined by:

- Its current heading (`getRadarHeading()`)
- Its scan width (`setScanWidth()`, default 10 degrees, max 45)

If any enemy robot falls within that arc during a tick, the `on scan` event
fires with the distance and bearing to that enemy.

### Controlling the Radar

Like the body and gun, you can control the radar in two ways:

```rbl
setRadarTurnRate(15.0)        // Spin radar clockwise at 15 deg/tick
setRadarHeading(angle(180))   // Point radar south
```

The radar is fast -- it can turn up to 25 degrees per tick. This means it can
sweep the full 360 degrees in about 15 ticks.

### A Simple Radar Sweep

The most basic radar strategy is to spin it continuously:

```rbl
func tick() {
    // Spin radar at max speed for maximum coverage
    setRadarTurnRate(22.0)

    // Point the gun wherever the radar is looking
    setGunHeading(getRadarHeading())
}

on scan(distTo float, bearing angle) {
    // We found someone! Fire!
    if getGunHeat() == 0.0 {
        fire(2.0)
    }
}
```

This gives you broad coverage but poor accuracy. The radar sweeps past enemies
quickly, so you only get a brief snapshot of their position. For better
targeting, you need a radar lock (covered in section 8).

### Scan Width Tradeoffs

- **Wide scan (18-45 degrees):** Easier to find enemies, but less precise
  bearing data. Good for searching.
- **Narrow scan (5-12 degrees):** Harder to sweep, but when you do detect
  someone, you know their bearing more precisely. Good for tracking a known
  target.

```rbl
setScanWidth(18.0)  // Wide: search mode
setScanWidth(10.0)  // Narrow: tracking mode
```

---

## 6. Shooting

### Gun Basics

Your gun rotates independently of the body (but not independently of the
radar -- each has its own heading). The gun heading is absolute, just like
the body heading.

```rbl
setGunHeading(angle(90))      // Point gun east
setGunTurnRate(10.0)          // Rotate gun clockwise
gunAngle := getGunHeading()   // Read current gun heading
```

The gun can turn up to 15 degrees per tick -- slower than the radar but faster
than the body.

### Gun Heat

You cannot fire continuously. Each shot adds heat to the gun based on the
formula `1.0 + power / 5`. A power-1 shot adds 1.2 heat; a power-3 shot adds
1.6 heat. The gun cools at **0.15 per tick**. That means after a power-1 shot,
you must wait about 8 ticks before firing again.

Always check heat before firing:

```rbl
if getGunHeat() == 0.0 {
    fire(2.0)
}
```

Calling `fire()` when the gun is hot does nothing -- it silently fails.

### Fire Power Tradeoffs

`fire(power)` takes a value from 1.0 to 5.0. The power level affects three
things:

| Power | Bullet Speed       | Bullet Damage                     | Energy Cost |
|-------|--------------------|------------------------------------|-------------|
| 1.0   | 35 - 3(1) = **32** | 4(1) + max(0, 0) * 2 = **4**     | 1.0         |
| 2.0   | 35 - 3(2) = **29** | 4(2) + max(0, 1) * 2 = **10**    | 2.0         |
| 3.0   | 35 - 3(3) = **26** | 4(3) + max(0, 2) * 2 = **16**    | 3.0         |
| 4.0   | 35 - 3(4) = **23** | 4(4) + max(0, 3) * 2 = **22**    | 4.0         |
| 5.0   | 35 - 3(5) = **20** | 4(5) + max(0, 4) * 2 = **28**    | 5.0         |

The formulas:
- **Bullet speed:** `35 - 3 * power`
- **Bullet damage:** `4 * power + max(0, power - 1) * 2`
- **Energy cost:** `power * 1.0`

Higher power does more damage but the bullet travels slower (easier to dodge)
and costs more energy. At a distance, low-power fast bullets are more likely to
hit. Up close, high-power shots are devastating.

### Targeting Basics

The simplest targeting strategy: point the gun at the enemy's last known
position and fire.

```rbl
var enemyBearing angle = angle(0)

on scan(distTo float, bearing angle) {
    enemyBearing = bearing

    if getGunHeat() == 0.0 {
        // Convert bearing to absolute and aim gun there
        enemyAbsAngle := getHeading() + bearing
        setGunHeading(enemyAbsAngle)
        fire(2.0)
    }
}
```

This is head-on targeting -- you aim directly at where the enemy *is*, not where
they *will be*. It works against stationary or slow targets but misses fast
movers. Predictive targeting is an advanced topic, but even head-on targeting
wins many fights.

---

## 7. Responding to Events

Events are delivered *before* your `tick()` function runs each tick. They let
you react to things that happened in the world. Here are all eight events with
practical examples.

### scan

```rbl
on scan(distTo float, bearing angle) {
    // Radar detected an enemy
    // distTo: how far away they are
    // bearing: relative angle from our heading
}
```

This is your primary sensor. Every time your radar arc touches an enemy, this
fires. Save the distance and bearing to track the enemy:

```rbl
var enemyDist float = 0.0
var enemyBearing angle = angle(0)
var ticksSinceScan int = 999

on scan(distTo float, bearing angle) {
    enemyDist = distTo
    enemyBearing = bearing
    ticksSinceScan = 0
}
```

### scanned

```rbl
on scanned(bearing angle) {
    // An enemy's radar scanned us
    // bearing: direction the scanner is, relative to our heading
}
```

This tells you someone is looking at you. You know an enemy is in that
direction, even if your own radar has not found them yet. You could use it
to point your radar toward them.

### hit

```rbl
on hit(damage float, bearing angle) {
    // We took bullet damage
    // damage: how much health we lost
    // bearing: direction the bullet came from
}
```

Getting hit means someone knows where you are. A common response is to change
direction:

```rbl
on hit(damage float, bearing angle) {
    // Reverse direction to dodge follow-up shots
    setSpeed(getSpeed() * -1.0)

    // The enemy is roughly in that direction
    enemyBearing = bearing
    ticksSinceScan = 0
}
```

### wallHit

```rbl
on wallHit(bearing angle) {
    // We collided with a wall
    // bearing: direction of the wall relative to our heading
}
```

Wall collisions deal damage proportional to speed (`speed * 0.1`) and **set
your speed to zero**. You need to call `setSpeed` again on the next tick to
get moving:

```rbl
on wallHit(bearing angle) {
    // Turn away from the wall and get moving again
    setHeading(getHeading() + bearing + angle(180))
    setSpeed(50.0)
}
```

### robotHit

```rbl
on robotHit(bearing angle) {
    // We collided with another robot
    // bearing: direction of the other robot
}
```

Robot collisions deal a small amount of damage (`0.5 + relativeSpeed * 0.02`,
where relative speed is the sum of both robots' absolute speeds). A common
response is to steer away:

```rbl
on robotHit(bearing angle) {
    setHeading(getHeading() + bearing + angle(180))
    setSpeed(60.0)
}
```

### bulletHit

```rbl
on bulletHit(robotId int) {
    // Our bullet hit an enemy
    // robotId: the ID of the robot we hit
}
```

Good news -- your shot landed. You could use this to confirm that your
targeting is on track, or to switch to a different target if that enemy is
likely dead.

### bulletMiss

```rbl
on bulletMiss() {
    // Our bullet left the arena without hitting anything
}
```

Your shot missed. If this happens a lot, your targeting needs work. You might
want to adjust power or lead the target differently.

### robotDeath

```rbl
on robotDeath(robotId int) {
    // An enemy robot just died
    // robotId: the ID of the dead robot
}
```

In a multi-robot battle, this lets you know when to switch targets:

```rbl
var enemiesAlive int = 0

func init() {
    enemiesAlive = robotCount() - 1
}

on robotDeath(robotId int) {
    enemiesAlive = enemiesAlive - 1
}
```

---

## 8. Putting It Together

Now let us build a real fighting bot from scratch. We will call it **TrackerBot**.
It has two phases:

1. **Search:** Spin the radar to find an enemy.
2. **Track:** Lock the radar on the enemy, aim the gun, and fire while strafing.

### Step 1: Structure and State

```rbl
robot "TrackerBot"

var phase int = 0

// Enemy tracking
var enemyBearing angle = angle(0)
var enemyDist float = 0.0
var ticksSinceScan int = 999

// Radar lock oscillation
var radarOscDir float = 1.0

// Movement
var strafeDir float = 1.0
```

We track the enemy's last known bearing and distance, how long since we last
scanned them, and some helper variables for the radar lock and strafing.

### Step 2: Initialization

```rbl
func init() {
    setColor(60, 130, 220)
    setGunColor(40, 90, 160)
    setRadarColor(100, 180, 255)

    // Start with wide scan for searching
    setScanWidth(16.0)
}
```

### Step 3: The Tick Function -- Search Phase

```rbl
func tick() {
    ticksSinceScan = ticksSinceScan + 1

    if phase == 0 {
        // SEARCH: spin radar, drift toward center
        setScanWidth(16.0)
        setRadarTurnRate(22.0)

        // Cruise toward center to avoid walls
        cx := arenaWidth() * 0.5
        cy := arenaHeight() * 0.5
        setHeading(getHeading() + bearingTo(cx, cy))
        setSpeed(40.0)

        // Gun follows radar
        setGunHeading(getRadarHeading())
    }
```

In search mode, we spin the radar quickly (22 degrees per tick) with a wide
arc to maximize our chance of spotting someone. Meanwhile, we drift toward the
center of the arena so we do not get stuck in a corner.

### Step 4: The Tick Function -- Track Phase

```rbl
    if phase == 1 {
        // TRACK: lock radar on enemy, aim gun, strafe
        setScanWidth(12.0)

        // Compute enemy's absolute angle
        enemyAbsAngle := getHeading() + enemyBearing

        // Radar lock: oscillate tightly around enemy bearing
        radarTarget := enemyAbsAngle + angle(6.0) * radarOscDir
        setRadarHeading(radarTarget)
        radarOscDir = radarOscDir * -1.0

        // Gun: aim at the enemy
        setGunHeading(enemyAbsAngle)

        // Movement: strafe perpendicular to the enemy
        strafeAngle := enemyAbsAngle + angle(90) * strafeDir
        setHeading(strafeAngle)
        setSpeed(60.0)

        // Fire with distance-scaled power
        if getGunHeat() == 0.0 {
            if enemyDist < 150.0 {
                fire(3.5)
            } else {
                if enemyDist < 350.0 {
                    fire(2.0)
                } else {
                    fire(1.0)
                }
            }
        }

        // If we lose the scan, go back to searching
        if ticksSinceScan > 25 {
            phase = 0
        }
    }
```

This is where the real fighting happens. Let us break it down:

**Radar lock oscillation:** Instead of spinning the radar freely, we point it at
the enemy and oscillate back and forth by 6 degrees each tick. This keeps the
enemy within our scan arc tick after tick, giving us continuous updates. The key
line:

```rbl
radarTarget := enemyAbsAngle + angle(6.0) * radarOscDir
setRadarHeading(radarTarget)
radarOscDir = radarOscDir * -1.0
```

Each tick, the radar aims slightly to one side of the enemy, then the other.
As long as the enemy is within those 6 degrees, we keep scanning them.

**Gun aiming:** We point the gun at the enemy's current position. This is
head-on targeting, the simplest approach.

**Strafing:** We move perpendicular to the enemy (90 degrees off from the
bearing). This makes us harder to hit while keeping a consistent distance.

**Distance-based firepower:** Close range gets high power for maximum damage.
Long range gets low power for faster bullets that are more likely to hit.

### Step 5: Wall Avoidance

Add this at the end of `tick()`, after the phase logic:

```rbl
    // Wall avoidance
    wallMargin := 55.0
    if getX() < wallMargin || getX() > arenaWidth() - wallMargin {
        cx := arenaWidth() * 0.5
        cy := arenaHeight() * 0.5
        setHeading(getHeading() + bearingTo(cx, cy))
        setSpeed(50.0)
    }
    if getY() < wallMargin || getY() > arenaHeight() - wallMargin {
        cx := arenaWidth() * 0.5
        cy := arenaHeight() * 0.5
        setHeading(getHeading() + bearingTo(cx, cy))
        setSpeed(50.0)
    }
}
```

When we get within 55 units of any wall, we steer toward the center. This
overrides the phase movement, which is intentional -- hitting a wall costs
health and kills your speed.

### Step 6: Event Handlers

```rbl
on scan(distTo float, bearing angle) {
    enemyBearing = bearing
    enemyDist = distTo
    ticksSinceScan = 0

    if phase == 0 {
        phase = 1
    }
}

on hit(damage float, bearing angle) {
    // The enemy is roughly where the bullet came from
    enemyBearing = bearing
    ticksSinceScan = 0

    // Reverse strafe direction to dodge
    strafeDir = strafeDir * -1.0

    if phase == 0 {
        phase = 1
    }
}

on wallHit(bearing angle) {
    // Reverse strafe direction
    strafeDir = strafeDir * -1.0
    setSpeed(50.0)
}
```

The `on scan` handler is the phase transition -- as soon as we detect someone,
we switch from search to track. When we get hit, we reverse our strafe direction
to dodge follow-up shots, and we update the enemy bearing from the bullet's
direction.

### The Complete Bot

Here is TrackerBot in full:

```rbl
robot "TrackerBot"

var phase int = 0
var enemyBearing angle = angle(0)
var enemyDist float = 0.0
var ticksSinceScan int = 999
var radarOscDir float = 1.0
var strafeDir float = 1.0

func init() {
    setColor(60, 130, 220)
    setGunColor(40, 90, 160)
    setRadarColor(100, 180, 255)
    setScanWidth(16.0)
}

func tick() {
    ticksSinceScan = ticksSinceScan + 1

    if phase == 0 {
        setScanWidth(16.0)
        setRadarTurnRate(22.0)
        cx := arenaWidth() * 0.5
        cy := arenaHeight() * 0.5
        setHeading(getHeading() + bearingTo(cx, cy))
        setSpeed(40.0)
        setGunHeading(getRadarHeading())
    }

    if phase == 1 {
        setScanWidth(12.0)
        enemyAbsAngle := getHeading() + enemyBearing

        radarTarget := enemyAbsAngle + angle(6.0) * radarOscDir
        setRadarHeading(radarTarget)
        radarOscDir = radarOscDir * -1.0

        setGunHeading(enemyAbsAngle)

        strafeAngle := enemyAbsAngle + angle(90) * strafeDir
        setHeading(strafeAngle)
        setSpeed(60.0)

        if getGunHeat() == 0.0 {
            if enemyDist < 150.0 {
                fire(3.5)
            } else {
                if enemyDist < 350.0 {
                    fire(2.0)
                } else {
                    fire(1.0)
                }
            }
        }

        if ticksSinceScan > 25 {
            phase = 0
        }
    }

    wallMargin := 55.0
    if getX() < wallMargin || getX() > arenaWidth() - wallMargin || getY() < wallMargin || getY() > arenaHeight() - wallMargin {
        cx := arenaWidth() * 0.5
        cy := arenaHeight() * 0.5
        setHeading(getHeading() + bearingTo(cx, cy))
        setSpeed(50.0)
    }
}

on scan(distTo float, bearing angle) {
    enemyBearing = bearing
    enemyDist = distTo
    ticksSinceScan = 0
    if phase == 0 {
        phase = 1
    }
}

on hit(damage float, bearing angle) {
    enemyBearing = bearing
    ticksSinceScan = 0
    strafeDir = strafeDir * -1.0
    if phase == 0 {
        phase = 1
    }
}

on wallHit(bearing angle) {
    strafeDir = strafeDir * -1.0
    setSpeed(50.0)
}
```

This bot is competitive. It searches efficiently, locks onto enemies, fires
with appropriate power, strafes to dodge, and avoids walls. There is still room
to improve, but this is a solid foundation.

---

## 9. Advanced Topics

### Mine and Cookie Awareness

The arena periodically spawns **mines** (30 damage on contact) and **cookies**
(heal 20 HP on contact). Four functions let you sense them:

```rbl
cookieDist := nearestCookieDist()    // -1.0 if no cookies in the arena
cookieBear := nearestCookieBearing() // bearing to nearest cookie

mineDist := nearestMineDist()        // -1.0 if no mines
mineBear := nearestMineBearing()     // bearing to nearest mine
```

A survival-oriented bot might seek cookies when health is low:

```rbl
if getHealth() < 70.0 && nearestCookieDist() > 0.0 {
    setHeading(getHeading() + nearestCookieBearing())
    setSpeed(80.0)
}
```

And avoid mines at close range:

```rbl
mineDist := nearestMineDist()
if mineDist > 0.0 && mineDist < 60.0 {
    awayAngle := getHeading() + nearestMineBearing() + angle(180)
    setHeading(awayAngle)
    setSpeed(70.0)
}
```

### Wall Avoidance Patterns

The simplest approach (used above) steers toward the center when near a wall.
A more nuanced version adjusts the margin based on speed:

```rbl
wallMargin := 40.0 + abs(getSpeed()) * 0.3
```

Another approach is to check whether your *projected* position a few ticks
from now will be inside the wall margin, and steer away preemptively using
trigonometry:

```rbl
projX := getX() + sin(getHeading()) * getSpeed() * 5.0
projY := getY() - cos(getHeading()) * getSpeed() * 5.0
if projX < wallMargin || projX > arenaWidth() - wallMargin || projY < wallMargin || projY > arenaHeight() - wallMargin {
    // Steer toward center
    setHeading(getHeading() + bearingTo(arenaWidth() * 0.5, arenaHeight() * 0.5))
}
```

### Radar Lock Oscillation Technique

The radar oscillation pattern from TrackerBot deserves deeper explanation. The
idea is to alternate the radar aim to each side of the enemy:

```rbl
radarTarget := enemyAbsAngle + angle(6.0) * radarOscDir
setRadarHeading(radarTarget)
radarOscDir = radarOscDir * -1.0
```

Tick 1: radar aims 6 degrees clockwise of enemy. Tick 2: radar aims 6 degrees
counter-clockwise. As long as the enemy does not move faster than 6 degrees
of arc per tick (relative to us), the radar keeps sweeping across them,
generating a scan event almost every tick.

The oscillation width (6 degrees here) is a tuning parameter. Wider tolerates
faster-moving targets but produces less precise bearing data. Narrower gives
precise data but risks losing the lock if the enemy is agile. A value between
4 and 8 degrees works well for most situations.

If you lose the lock (no scan for many ticks), widen the scan and increase the
oscillation, or fall back to a full sweep.

### Speed-Based Dodging

Simple strafing (moving perpendicular to the enemy) is good but predictable.
More advanced dodging changes speed randomly:

```rbl
// In tick(), during tracking phase:
if getTick() % 20 == 0 {
    if random(2) == 0 {
        strafeDir = strafeDir * -1.0
    }
}
setSpeed(40.0 + float(random(40)))
```

Randomly reversing strafe direction and varying speed makes it much harder
for enemies to predict your position.

### Structs for Tracking State

For complex bots, you can define structs to organize enemy data:

```rbl
type EnemyInfo struct {
    bearing angle
    dist float
    lastSeen int
}

var enemy EnemyInfo = EnemyInfo{
    bearing: angle(0),
    dist: 0.0,
    lastSeen: 999
}
```

Access fields with dot notation:

```rbl
on scan(distTo float, bearing angle) {
    enemy.bearing = bearing
    enemy.dist = distTo
    enemy.lastSeen = getTick()
}
```

This becomes especially useful when tracking multiple pieces of state or
building helper functions that operate on structured data.

---

## 10. Tips and Tricks

### Common Mistakes

**Forgetting type annotations on globals.** Global variables need explicit
types. Local variables declared with `:=` infer their type.

```rbl
var speed float = 50.0       // Correct: global with type
speed := 50.0                // Only works inside a function
```

**Passing `int` where `float` is expected.** This will not compile:

```rbl
setSpeed(50)    // Error: int is not float
setSpeed(50.0)  // Correct
```

**Not calling `setSpeed` after a wall hit.** Wall collisions zero your speed.
If your movement logic is in `tick()` and sets speed every tick, this is
handled automatically. But if you only set speed in `init()`, you will be stuck
after hitting a wall.

**Firing when the gun is hot.** Always check `getGunHeat() == 0.0` before
calling `fire()`. Firing with a hot gun is a wasted call.

**Using `setHeading` only once.** `setHeading` does not turn you instantly. It
sets a turn rate based on the angle difference. If you call it once and never
again, the robot turns partway and stops updating. Always call it every tick
when tracking a heading.

**Angle arithmetic with `float` on the wrong side.** When multiplying angles,
the `angle` must be on the left:

```rbl
angle(90) * 0.5   // Correct: angle * float = angle
0.5 * angle(90)   // Error: float * angle is not allowed
```

### Performance Considerations

Each robot gets a fuel budget of 10,000 gas per tick. Normal operations consume
very little fuel, but extremely long loops or heavy computation could exhaust
it. In practice, you will not hit this limit unless you are running hundreds
of loop iterations per tick.

### Strategic Tips

- **Stay near the center.** Corner and wall positions limit your movement
  options and make you predictable.
- **Keep moving.** A stationary robot is a dead robot. Even small amounts of
  movement make you much harder to hit.
- **Use low power at long range.** A power-1 bullet at speed 32 is much more
  likely to hit a distant target than a power-5 bullet at speed 20.
- **Save energy for fights.** Energy regenerates at 0.1 per tick. Constant
  high-power shots will drain you. If you run out of energy, you cannot fire.
- **React to hits.** When you take damage, change direction. The enemy has your
  position dialed in -- staying on the same course guarantees more hits.
- **Watch the tick counter.** Rounds last 2000 ticks. If you are ahead on
  health, playing defensively (dodging, avoiding contact) can run out the clock.
- **Test against different styles.** A bot that beats SpinBot might lose to
  WallBot. Test against multiple opponents to find weaknesses in your strategy.

### Debugging

Use the `debug` functions to display values in the status panel during a match:

```rbl
debugInt(phase)
debugFloat(enemyDist)
debugAngle(getHeading())
```

These are invaluable for understanding what your bot is actually doing versus
what you think it should be doing. Add debug calls early and remove them when
you are satisfied the logic is correct.

---

## Where to Go From Here

You now know everything you need to build a strong bot. Here are some ideas
for further exploration:

- **Predictive targeting:** Instead of aiming where the enemy is, calculate
  where they will be when your bullet arrives. Factor in bullet travel time
  (`distance / bulletSpeed`) and the enemy's apparent movement direction.
- **Pattern matching:** Track how the enemy moves over many ticks and look for
  repetitive patterns. Many bots use simple oscillation or circular movement
  that can be predicted.
- **Multi-phase strategies:** Add a retreat phase when health is low, a
  kamikaze phase when the enemy is almost dead, or a cookie-hunting phase
  to heal up.
- **Adaptive firepower:** Track your hit rate using `bulletHit` and
  `bulletMiss` events. If you are missing a lot, switch to lower power. If
  your accuracy is high, crank it up.

For full details on the language, see the [Language Reference](../reference/language.md). For a complete list of API functions and physics values, see the [Standard Library Reference](../reference/stdlib.md).

Good luck in the arena.
