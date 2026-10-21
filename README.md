# Roadster Drive

An unofficial, fan-made browser game for experiencing the next-generation Tesla Roadster revealed on 15 October 2026. Hang upside down on the suction fans, fire the cold-gas thrusters, then fly, flip and land. There's also a drag strip, a 230+ mph salt-flat run and a coastal circuit.

It is plain HTML, CSS and JavaScript modules with [three.js](https://threejs.org) loaded from a CDN. There is no build step.

> Not affiliated with or endorsed by Tesla, Inc. or SpaceX. The car is an original procedural model based on public reveal coverage. It uses no logos or third-party assets.

## Run it

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

Any static file server works. Opening `index.html` straight from disk won't work, because browsers block ES modules on `file://`. To play on a phone, serve the folder over your LAN or enable GitHub Pages for the branch.

## The car

You pick a trim in the menu. Each one changes the physics, the visible hardware and the controls.

| | Performance | Thrust | Rocket |
| --- | --- | --- | --- |
| Announced 0–60 mph | under 1.6 s | under 0.9 s | under 0.59 s |
| Sim 0–60 mph | 1.46 s | 0.85 s | 0.55 s |
| Seats | 2 | 2 | 1 |
| Thrusters | none | rear cold-gas | 10: rear, lift, and attitude control |
| In the air | ballistic | rear thrust | lift, hover, rolls and flips |

All trims have the multi-mode suction-fan system, which gives about 1.1 g of suction even when stopped. That is what lets the car hang upside down on the reveal ramp, drive the loop slowly, and corner at close to 2 g. Announced top speed is "exceeding 230 mph"; the sim limits the car at 235 mph.

The car model follows the reveal coverage:

- an angular wedge body
- Ano White paint and gold-tinted "visor" glass
- hidden headlights and a full-width tail light
- butterfly doors, which open in the menu showroom
- an active rear wing that deploys at speed, under braking and in the air
- a suction-fan exhaust in the diffuser
- a yoke with two small driver displays and a center screen
- visible cold-gas nozzles for each trim

## Experiences

| Mode | What you do |
| --- | --- |
| **Proving Ground** | The reveal, recreated. Climb the inverted ramp, hang upside down, launch in a cloud of compressed gas, roll upright and land. Also includes a suction-fan loop, a kicker over a lineup of five vehicles, a 30 m landing tower, X target pads, six sky rings and a gas recharge pad. There are 11 challenges, trick scoring (flips, rolls, spins, airtime, perfect landings), and a rocket launching in the distance every few minutes. |
| **Drag Strip** | Stage, watch the Christmas tree, launch. Records reaction time, 60 ft, 0–60, 0–100, ⅛ and ¼ mile ET, and trap speed. Leaving early is a red light. |
| **Top Speed** | 9 km of salt flat. Find the limiter, then stop before the barrier. |
| **Coast Circuit** | Three timed laps of a 6.7 km island circuit with a lap record. |
| **Free Cruise** | No clock. Shows trip, energy and efficiency. |

Crash a landing and you get a *Rapid Unscheduled Disassembly*, then the car respawns at the last safe spot.

## Controls

| Action | Keyboard | Gamepad | Touch |
| --- | --- | --- | --- |
| Accelerate / pitch nose down (air) | `W` / `↑` | RT / left stick | GO |
| Brake / pitch nose up (air) | `S` / `↓` | LT / left stick | BRAKE |
| Steer / yaw (air) | `A` `D` / `←` `→` | left stick | ◀ ▶ or Tilt steer |
| Roll (air) | `Q` `E` | LB / RB | ↺ ↻ |
| Lift thrusters (Rocket) | `Space` | A | LIFT |
| Rear thrusters | `Shift` (`Space` on Thrust) | B | THRUST |
| Reset car | `F` | Back | ⟲ |
| Camera (chase, driver seat, hood, TV) | `C` | Y | 📷 |
| Autopilot ride-along | `T` | X | AP |
| Reverse / drive (when stopped) | `R` | D-pad up | — |
| Pause | `Esc` / `P` | Start | ⏸ |

Tips:

- **Rocket flight assist:** hold `Space` with no pitch or roll input and the car levels itself like a drone. Off the reveal ramp, just hold `Space` to roll upright and land softly.
- **Launch Mode:** hold brake and full throttle at a standstill, then release.
- **Lineup jump:** hit the kicker at 90 mph or more. Below about 60 mph you won't clear the vehicles.
- **Gas:** the COPV gauge drains while the thrusters fire. It recharges slowly on the ground, or instantly on the blue recharge pad.

## How real is it?

`js/car.js` holds the dynamics:

- motor torque and power limits
- tyre grip on a friction circle, loaded by gravity, suction fans and aero downforce
- drag and rolling resistance
- one-pedal regen
- battery and range
- slope forces on ramps
- on curved ramps, a rail model that checks whether centripetal force, gravity and fan suction keep the car pressed to the surface
- in the air, 3D rigid-body flight with quaternion attitude, RCS torques and landing and crash rules

Tesla hasn't published mass, power or pack size, so those are estimates tuned to the announced 0–60 times.

Sources for the reveal details: [Electrek](https://electrek.co/2026/10/15/tesla-unveils-cyberfied-new-roadster-kickflip/), [TechCrunch](https://techcrunch.com/2026/10/15/tesla-reveals-spacex-powered-roadster-that-flies-and-falls-with-style/), [CNBC](https://www.cnbc.com/2026/10/15/tesla-roadster-reveal-what-to-know-about-the-delayed-ev.html), [MotiveGrid](https://motivegrid.com/insights/tesla-roadster-2026-reveal).

## Project layout

```
index.html          UI shell (menu, trim picker, HUD, touch controls, modals)
css/style.css       Styling
js/main.js          Game loop, state machine, events, collisions, effects wiring
js/car.js           Trims and dynamics: ground, curved-ramp rail, flight, landings, crashes
js/math3.js         Small quaternion helpers for the physics
js/arena.js         Proving Ground layout, ramp and platform heights, visuals, rocket launch
js/track.js         Track centerlines: arc length, curvature, nearest-point queries
js/world.js         Sky, lighting, terrain, roads and scenery per venue
js/roadsterModel.js Procedural 3D car (lofted faceted body, doors, wing, nozzles)
js/fx.js            Particles: cold-gas jets, vapor, dust, tyre smoke, sparks, rocket exhaust
js/modes.js         Proving Ground challenges, drag strip, top speed, circuit, cruise, showroom
js/autopilot.js     Pure-pursuit driver for the ride-along
js/camera.js        Chase, driver-seat, hood and TV cameras
js/audio.js         Synthesized motor, fans, gas jets, wind, tyres and rocket rumble
js/hud.js           Speedometer, power bar, battery, COPV gauge, altitude, g-meter, minimap
js/input.js         Keyboard, gamepad, touch and tilt input
```
