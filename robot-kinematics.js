// Position IK for illustrative task choreography. Uses each loaded model's own
// transforms, not a separate approximation. Not a hardware motion controller.
export function solvePosition({ joints, values, apply, position, target, iterations = 90 }) {
  const result = { ...values };
  const epsilon = .002;
  for (let iteration = 0; iteration < iterations; iteration++) {
    apply(result);
    if (position().distanceTo(target) < .0008) break;
    for (const key of joints) {
      apply(result);
      const origin = position();
      result[key] += epsilon; apply(result);
      const derivative = position().sub(origin).multiplyScalar(1 / epsilon);
      result[key] -= epsilon;
      const error = target.clone().sub(origin);
      const delta = derivative.dot(error) / (derivative.lengthSq() + .015);
      result[key] += Math.max(-.12, Math.min(.12, delta * .7));
    }
  }
  apply(result);
  return result;
}
