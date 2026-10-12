# Li Zhaoyang Homepage

Static English resume homepage for GitHub Pages.

## Interactive showcases

- Tabletop: six transfers across inspection, sorting, re-grasping, and a three-part stack. The loaded AUBO model supplies the kinematics for the grasp and placement poses.
- Mobile robot: a 32-second fetch-and-deliver mission with docking, grasping, lifting, stowing, obstacle detouring, and placement at a second station.
- Engineering lab: five Canvas animations for registration, completion, LiDAR/SLAM, YOLO-style detection, and industrial inspection. Tabs, playback controls, and timeline scrubbing work with a keyboard.

Robotics and geometry scenes use scripted motion or synthetic data. YOLO and inspection use real reference photographs with illustrative annotations; image credits and licenses are in `assets/engineering/CREDITS.md`. They are illustrative demonstrations, not live inference, benchmark results, or hardware controllers. SplAttN and glass inspection descriptions are based on the local CV. Animations start paused when reduced motion is requested and stop advancing while hidden.

Preview from the repository root with `python -m http.server 8766`, then open `http://localhost:8766`. Robotics assets use the existing Brotli service worker and Three.js CDN imports; use HTTP rather than opening the HTML directly.

Browser regression checks are in `tests/showcase-checks.js`. Run its exported `checkEngineering()` and `checkTabletop()` on the homepage, and `checkMobile()` on `/scout-aubo/index.html`, after the models load. The checks exercise all six tabletop waypoint sequences, cargo clearance, grasp continuity, release, loop reset, and animation controls. They restart the demonstrations when finished.
