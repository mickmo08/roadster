# Roadster Drive

A browser game for experiencing an electric hypercar roadster the way you would in real life: staging at a drag strip, launching, chasing 250 mph on a salt flat, carving an island circuit, or just cruising with the roof off.

It is plain HTML, CSS and JavaScript modules with [three.js](https://threejs.org) loaded from a CDN. There is no build step.

## Run it

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

Any static file server works. Opening `index.html` straight from disk won't work, because browsers block ES modules on `file://`.

## Experiences

| Mode | What you do |
| --- | --- |
| **Drag Strip** | Stage at the line, watch the Christmas tree, launch. Records reaction time, 60 ft, 0–60, 0–100, ⅛ and ¼ mile ET, and trap speed. Leaving early is a red light. |
| **Top Speed** | 9 km of salt flat with mile markers. Find the 250 mph limiter, then stop before the barrier. |
| **Coast Circuit** | Three timed laps of a 6.7 km island circuit with sweepers, braking zones and a hairpin. Saves your lap record. |
| **Free Cruise** | No clock. Shows trip, energy and efficiency. Autopilot cruises at a relaxed 80 mph. |

Options: paint colour, day / sunset / night (night turns on working headlights), mph or km/h, the rumored cold-gas **thruster pack**, sound and shadows. Settings and personal bests are saved in `localStorage`.

## Controls

| Action | Keyboard | Gamepad | Touch |
| --- | --- | --- | --- |
| Accelerate | `W` / `↑` | RT | GO pedal |
| Brake | `S` / `↓` | LT | BRAKE pedal |
| Steer | `A` `D` / `←` `→` | Left stick | ◀ ▶ or **Tilt steer** |
| Thrusters | `Space` / `Shift` | A | BOOST |
| Camera (chase, driver seat, hood, trackside TV) | `C` | Y | 📷 |
| Autopilot ride-along | `T` | X | AP |
| Reverse / drive (when stopped) | `R` | B | — |
| Pause | `Esc` / `P` | Start | ⏸ |
| Mute | `M` | — | — |

**Launch Mode:** hold brake and full throttle together at a standstill. When "LAUNCH MODE READY" appears, release the brake. Without it the torque ramps in and you lose roughly a tenth.

## How real is it?

The physics (`js/car.js`) is tuned against the targets announced at the 2017 reveal: 0–60 mph in 1.9 s, ¼ mile in 8.8 s, 250+ mph, 620 mi range, 10,000 Nm of wheel torque and a 200 kWh pack. Mass, drag area and peak power are estimates chosen to land on the 0–60 and ¼-mile figures. With a launch, the sim runs 0–60 in about 1.86 s and the ¼ mile in about 8.7 s at roughly 166 mph.

The model includes:

- a torque limit, then a power limit, and a 250 mph limiter
- tyre grip on a friction circle, so cornering takes grip away from acceleration and braking, and pushing too hard makes the car understeer
- aerodynamic drag and rolling resistance
- one-pedal regenerative braking that puts energy back in the battery
- battery drain and a range estimate based on how you are driving
- weight transfer that pitches and rolls the body

The car model is an original, procedurally generated 2+2 roadster with a glass roof. It uses no third-party assets or logos.

## Project layout

```
index.html          UI shell (menu, HUD, touch controls, modals)
css/style.css       Styling
js/main.js          Game loop, state machine, collisions
js/car.js           Vehicle dynamics and energy model (the spec sheet lives here)
js/track.js         Track centerlines: arc length, curvature, nearest-point queries
js/world.js         Sky, lighting, terrain, road meshes and scenery per venue
js/roadsterModel.js Procedural 3D car
js/modes.js         Drag strip, top speed, circuit and cruise rules and timing
js/autopilot.js     Pure-pursuit driver used for the menu and ride-along
js/camera.js        Chase, driver-seat, hood and trackside cameras
js/audio.js         Synthesized motor whine, wind, road, tyre and thruster sounds
js/hud.js           Speedometer, power and regen bar, battery, g-meter, minimap
js/input.js         Keyboard, gamepad, touch and tilt input
```
