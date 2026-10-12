// Browser integration checks against the actual loaded models; no mock kinematics.
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const nextFrame = () => new Promise(requestAnimationFrame);

export async function checkEngineering() {
  const tabs = [...document.querySelectorAll('.engineering-tabs [role="tab"]')];
  assert(tabs.length === 5, 'Expected five engineering studies');
  assert(!document.querySelector('#coding'), 'Coding section must be removed');
  for (const tab of tabs) {
    tab.click();
    assert(document.querySelectorAll('[role="tab"][aria-selected="true"]').length === 1, 'Only one tab is active');
    for (const progress of [0, 500, 1000]) {
      const range = document.querySelector('[data-lab-progress]');
      range.value = progress; range.dispatchEvent(new Event('input'));
      assert(document.querySelector('[data-lab-percent]').textContent === `${progress / 10}%`, 'Scrubber updates progress');
      assert(document.querySelector('[data-lab-play]').textContent === 'Play', 'Scrubbing pauses autoplay');
    }
  }
  tabs[0].click();
  tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  assert(tabs[1].getAttribute('aria-selected') === 'true', 'Arrow navigation works');
  tabs[0].click();
  assert(document.documentElement.scrollWidth <= innerWidth, 'No page overflow');
  return 'Five studies: selection, scrubbing, pause, keyboard navigation, layout passed';
}

export async function checkTabletop() {
  const d = window.exposeTabletopDemo();
  assert(d.robot.real, 'Wait for the real AUBO model to load');
  document.querySelector('#aubo-demo').scrollIntoView({ behavior: 'instant', block: 'center' });
  const button = document.querySelector('[data-robot-pause]');
  const wasPlaying = button.textContent === 'Pause';
  if (wasPlaying) button.click();
  let checked = 0;
  try {
    for (let task = 0; task < 6; task++) {
      if (task === 3) Object.values(d.objects.cubes).forEach((cube, index) => {
        cube.mesh.position.copy(d.objects.trayDrop);
        cube.mesh.position.x += [-.045, .045, 0][index];
        cube.mesh.position.y += [-.025, -.025, .045][index];
        cube.mesh.position.z = .0625 + .055 / 2 + .03;
      });
      d.active.autoIndex = task; d.active.running = false; d.active.nextStartAt = -1;
      await nextFrame(); await nextFrame();
      assert(d.active.sequence.length === 12, 'Every transfer has twelve phases');
      for (const step of d.active.sequence) {
        for (const [key, value] of Object.entries(step.realPose)) {
          const joint = d.robot.real.joints[key];
          joint.quaternion.copy(joint.userData.baseQuaternion).multiply(joint.quaternion.clone().setFromAxisAngle(joint.userData.jointAxis, value));
        }
        d.robot.root.updateWorldMatrix(true, true);
        const actual = d.robot.real.sites.eef.getWorldPosition(step.target.clone());
        assert(actual.distanceTo(step.target) < .005, `Task ${task + 1}: ${step.status} misses target`);
        checked++;
      }
      assert(d.active.sequence.filter(s => s.attach).length === 1, 'One grasp per transfer');
      assert(d.active.sequence.filter(s => s.release).length === 1, 'One release per transfer');
      if (task >= 3) assert(Math.abs(d.active.dropPosition.z - (.09 + (task - 3) * .055)) < .001, 'Stack increments by one cube height');
    }
  } finally {
    d.restart();
    if (wasPlaying) button.click();
  }
  return `${checked} tabletop waypoints: position error below 5 mm in scene coordinates`;
}

export function checkMobile() {
  const { mission, missionTcp: tcp, scoutGroup: robot } = window.exposeDemo();
  assert(mission, 'Wait for the mobile mission to load');
  const stages = new Set();
  for (let i = 0; i < 320; i++) {
    const t = i / 10, state = mission.update(t); stages.add(state.status);
    if (t >= 10.8 && t < 26.7) assert(mission.part.position.y > .5, 'Held cargo stays above the floor and chassis');
    if (t >= 6 && t < 15) assert(Math.abs(robot.position.x + 1.4) < .001, 'Base stops at pickup');
    if (t >= 22) assert(Math.abs(robot.position.x - 1.4) < .001, 'Base stops at delivery');
  }
  for (const [t, x] of [[10.7, -.8], [26.7, 2]]) {
    mission.update(t);
    const position = tcp.getWorldPosition(mission.part.position.clone());
    assert(Math.hypot(position.x - x, position.y - .575, position.z + .48) < .005, 'Grasp and release meet the part');
  }
  mission.update(31.9); assert(mission.part.position.x === 2, 'Part stays at delivery after release');
  mission.update(32); assert(mission.part.position.x === -.8, 'Next cycle resets the pickup part');
  assert(stages.size === 12, 'Twelve mission phases');
  window.exposeDemo().restart();
  return '320 mission samples: stages, clearance, docking, grasp, release, and reset passed';
}
