import type { StageDraft } from "../draft";

/** Central hall. Built around the origin so the stage can place it on the island. */
export function fillWorkshop(d: StageDraft) {
  const { pushStone, pushRoof, pushFramedWindow, timberSpecs, stoneMidSpecs, stoneLightSpecs, scaffSpecs, roofDarkSpecs, lanternSpecs, applyFinish } = d;
  applyFinish({
    plaster: 0xc4b8a8,
    plasterRoughness: 0.86,
    stone: 0xa89888,
    stoneDark: 0x6e6258,
    stoneRoughness: 0.9,
    timber: 0xa86b3c,
    timberRoughness: 0.78,
    beam: 0x6b4224,
    beamRoughness: 0.84,
    roof: 0x4a3d78,
    roofLight: 0x6a58a0,
    roofRoughness: 0.46,
    roofMetalness: 0.08,
    lanternIntensity: 0.7,
  });

  for (let ix = -4; ix <= 4; ix++) {
    for (let iz = -4; iz <= 3; iz++) {
      pushStone(ix * 0.58, 0.32, iz * 0.55);
    }
  }

  for (let gy = 1; gy <= 5; gy++) {
    const y = 0.55 + gy * 0.42;
    for (let ix = -4; ix <= 4; ix++) {
      const x = ix * 0.58;
      const isWindow = gy >= 2 && gy <= 4 && (ix === -1 || ix === 0 || ix === 1);
      if (isWindow) {
        pushFramedWindow(x, y, -2.15, 0, -1, gy === 2);
        continue;
      }
      stoneLightSpecs.push({ x, y, z: -2.15 });
    }
    timberSpecs.push(
      { x: -2.55, y, z: -2.15, sx: 0.32, sy: 1, sz: 0.32 },
      { x: 2.55, y, z: -2.15, sx: 0.32, sy: 1, sz: 0.32 },
    );
  }

  timberSpecs.push(
    { x: -2.55, y: 1.35, z: 1.35, sx: 0.34, sy: 3.2, sz: 0.34 },
    { x: 2.55, y: 1.35, z: 1.35, sx: 0.34, sy: 3.2, sz: 0.34 },
  );
  for (let ix = -5; ix <= 5; ix++) {
    const edge = Math.abs(ix) === 5;
    pushRoof(ix * 0.55, edge ? 2.55 : 3.15, -0.35, 1.15, 0.55, 4.6);
  }
  roofDarkSpecs.push({ x: 0, y: 3.55, z: -0.35, sx: 2.2, sy: 0.28, sz: 4.8 });
  pushFramedWindow(0, 2.35, 1.55, 0, 1, true);

  scaffSpecs.push(
    { x: -1.15, y: 0.85, z: -0.35, sx: 1.5, sy: 0.16, sz: 0.7 },
    { x: 1.2, y: 0.72, z: 0.15, sx: 0.85, sy: 0.7, sz: 0.85 },
    { x: 1.45, y: 1.05, z: -0.15, sx: 0.6, sy: 0.42, sz: 0.6 },
  );
  timberSpecs.push(
    { x: -1.45, y: 0.62, z: -0.35, sx: 0.14, sy: 0.55, sz: 0.14 },
    { x: -0.85, y: 0.62, z: -0.35, sx: 0.14, sy: 0.55, sz: 0.14 },
    { x: 3.15, y: 1.85, z: 0.2, sx: 0.24, sy: 3.2, sz: 0.24 },
    { x: 3.15, y: 3.35, z: 1.15, sx: 0.2, sy: 0.2, sz: 2.2 },
    { x: 3.15, y: 2.45, z: 2.05, sx: 0.12, sy: 1.8, sz: 0.12 },
  );
  scaffSpecs.push({ x: 3.15, y: 1.55, z: 2.05, sx: 0.6, sy: 0.5, sz: 0.6 });
  lanternSpecs.push(
    { x: -2.2, y: 1.55, z: 1.45, sx: 0.24, sy: 0.32, sz: 0.24 },
    { x: 2.2, y: 1.55, z: 1.45, sx: 0.24, sy: 0.32, sz: 0.24 },
  );
  stoneMidSpecs.push({ x: 0, y: 0.42, z: 2.05, sx: 2.2, sy: 0.28, sz: 0.8 });
}
