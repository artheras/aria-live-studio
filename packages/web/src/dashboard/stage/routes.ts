/** Walk from the front stalls up to each door, then around the hall. Stays on grass and off the houses. */
export const villageLoop: ReadonlyArray<readonly [number, number]> = [
  [0.2, 10.2],
  [-2.4, 8.6],
  [-4.0, 7.2],
  [-1.4, 7.6],
  [0.4, 6.4],
  [2.8, 7.2],
  [0.4, 4.6],
  [-4.8, 1.4],
  [-5.6, 0.2],
  [0.2, 1.8],
  [5.4, 0.5],
  [1.2, -2.2],
  [-2.2, -5.4],
  [0.6, -3.2],
  [4.4, -5.2],
  [1.4, 1.6],
  [0.3, 8.4],
];

const doorPaths: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [[-4.6, 9.6], [-2.2, 9.2], [0.2, 10.2], [3.4, 9.4]],
  [[0.4, 8.8], [0.4, 6.4], [0.3, 4.4], [0.2, 2.2]],
  [[0.4, 6.4], [-2.2, 6.8], [-4.2, 7.0]],
  [[0.4, 6.4], [2.6, 6.8], [4.6, 7.2]],
  [[0.3, 4.4], [-2.6, 2.2], [-5.4, 0.3]],
  [[0.3, 4.4], [2.8, 2.2], [5.2, 0.4]],
  [[0.2, 2.2], [-1.2, -1.4], [-2.2, -5.2]],
  [[0.2, 2.2], [2.0, -1.6], [4.4, -5.0]],
];

export function routeStones(step = 1.05): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const path of doorPaths) {
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i]!;
      const b = path[i + 1]!;
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const len = Math.hypot(dx, dz);
      const n = Math.max(1, Math.round(len / step));
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        out.push([a[0] + dx * t, a[1] + dz * t]);
      }
    }
  }
  return out;
}
