/** Walk along the expanded stone avenues & plazas between all 7 houses and 5 foreground stations. */
export const villageLoop: ReadonlyArray<readonly [number, number]> = [
  [-5.8, 9.8],  // 0: cottage-garden front step & Idea Post plaza (clear of cottage-garden)
  [-3.2, 10.6], // 1: south-west promenade (clear of Ballot Obelisk)
  [0.8, 11.4],  // 2: south-central foreground lawn (in front of Blueprint Gazebo)
  [6.8, 9.8],   // 3: cottage-timber & Build Outpost plaza (clear of cottage-timber)
  [10.6, 5.8],  // 4: sunny south-east courtyard in front of Scaffolding Lodge
  [7.6, 2.6],   // 5: east corridor south
  [7.6, 0.2],   // 6: cottage-stone front court
  [6.8, -3.2],  // 7: east corridor north
  [5.8, -6.0],  // 8: cottage-hearth front court
  [1.8, -6.0],  // 9: north plaza east
  [-2.6, -6.0], // 10: cottage-violet front court
  [-6.4, -5.6], // 11: north-west plaza corner
  [-6.8, -2.4], // 12: west corridor north
  [-6.8, 0.4],  // 13: cottage-lantern front court
  [-5.6, 2.8],  // 14: west-central plaza (clear of cottage-garden)
  [-0.4, 3.2],  // 15: central workshop grand staircase foot
  [-0.4, 5.8],  // 16: central stone avenue mid
  [-2.8, 8.2],  // 17: central-to-southwest connector
];

const doorPaths: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [[-5.8, 9.0], [-2.8, 7.8], [-0.4, 5.6], [2.8, 7.8], [6.4, 8.8]],
  [[0.8, 11.2], [-0.4, 8.4], [-0.4, 5.6], [-0.4, 2.6]],
  [[-3.2, 10.4], [0.8, 11.2], [4.4, 9.8]],
  [[-5.6, 2.2], [-0.4, 2.6], [3.2, 2.4], [7.4, 2.2]],
  [[7.4, 2.2], [7.6, 0.2], [6.8, -3.0], [5.6, -6.2]],
  [[5.6, -6.2], [1.8, -6.0], [-2.6, -6.4], [-6.2, -5.8]],
  [[-6.2, -5.8], [-6.8, -2.4], [-7.2, 0.2], [-5.6, 2.2]],
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
