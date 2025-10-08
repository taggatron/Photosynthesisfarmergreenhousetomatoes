# Greenhouse Growth Simulator (GCSE)

An interactive, mobile-friendly simulation where students configure three SVG greenhouses by toggling heaters and lights, then run a 6-month growth simulation to harvest tomato mass.

## Features
- Three SVG-rendered greenhouses with animated plants, heaters, and lights
- Per-greenhouse toggles for heater and lights
- 6 months simulated in ~12 seconds with progress display
- Growth model blends temperature, day length, soil quality, and seasonal variation
- Works on phones and tablets; large tap targets and responsive layout

## How to run
Just open `index.html` in a browser. No build tools needed.

Optional: Serve locally to avoid any file URL restrictions.

### On macOS (zsh)
```zsh
python3 -m http.server 8000
# Then open http://localhost:8000/ in your browser
```

## How the model works (simplified)
- Baseline growth: 1.0
- Heater: +30% (enzyme activity closer to optimum temperature)
- Lights: +35% (more photosynthesis time)
- Soil factor: random 0.85–1.15 per greenhouse
- Seasonal modulation: sine-based small monthly variation
- Mass output: ~120–2200 g, non-linear scaling with a little noise

This is intentionally simple and pedagogical rather than agronomically exact.

## Classroom ideas
- Ask students to predict which setup yields the highest mass
- Compare results with/without heaters and lights
- Discuss limiting factors: temperature and light intensity/day length
- Extension: talk about cost-benefit of heaters/lights vs. yield

## Accessibility
- Buttons and toggles have labels and large targets
- Progress updates use aria-live regions

## Attributions
All code and art are original and free to use for educational purposes.
