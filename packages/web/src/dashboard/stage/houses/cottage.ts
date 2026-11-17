import type { StageDraft } from "../draft";

export type CottageVariant = "violet" | "timber" | "lantern" | "garden" | "stone" | "hearth";

/** Violet cottage. Front door faces +z. Variant adds the trait that tells this copy apart. */
export function fillCottage(d: StageDraft, variant: CottageVariant = "violet") {
  const {
    u, pushStone, pushRoof, pushFramedWindow, timberSpecs, stoneLightSpecs, stoneMidSpecs, stoneDarkSpecs,
    scaffSpecs, roofDarkSpecs, mossSpecs, lanternSpecs, applyFinish,
  } = d;

  if (variant === "timber") {
    applyFinish({
      plaster: 0xe4c49a,
      plasterRoughness: 0.84,
      beam: 0x4a2914,
      beamRoughness: 0.9,
      timber: 0xc47a3a,
      timberRoughness: 0.82,
      roof: 0x7a3d4a,
      roofLight: 0xa45a62,
      roofRoughness: 0.62,
      roofMetalness: 0.02,
    });
  } else if (variant === "lantern") {
    applyFinish({
      plaster: 0xe6e0f4,
      plasterRoughness: 0.64,
      beam: 0x5c4030,
      roof: 0x6a4ec4,
      roofLight: 0x9a78e4,
      roofRoughness: 0.28,
      roofMetalness: 0.16,
      glass: 0xffe2a4,
      glassEmissive: 0xffc45a,
      glassIntensity: 1.55,
      lanternIntensity: 1.35,
    });
  } else if (variant === "garden") {
    applyFinish({
      plaster: 0xe4efe0,
      plasterRoughness: 0.86,
      stone: 0xa89878,
      stoneDark: 0x6e624c,
      beam: 0x5c4030,
      beamRoughness: 0.86,
      roof: 0x5a4a78,
      roofLight: 0x7d6aa4,
      roofRoughness: 0.74,
      roofMetalness: 0,
    });
  } else if (variant === "stone") {
    applyFinish({
      plaster: 0xc8c4bc,
      plasterRoughness: 0.94,
      stone: 0x9a958c,
      stoneDark: 0x6a6660,
      stoneRoughness: 0.96,
      beam: 0x5a4638,
      beamRoughness: 0.88,
      roof: 0x6a6284,
      roofLight: 0x8a82a4,
      roofRoughness: 0.82,
      roofMetalness: 0.1,
      glassIntensity: 0.85,
    });
  } else if (variant === "hearth") {
    applyFinish({
      plaster: 0xd8c0aa,
      plasterRoughness: 0.88,
      stone: 0x8a6858,
      stoneDark: 0x5c4036,
      stoneRoughness: 0.9,
      beam: 0x4a2c1c,
      roof: 0x6b3844,
      roofLight: 0x8a5048,
      roofRoughness: 0.5,
      roofMetalness: 0.06,
      glass: 0xffc07a,
      glassEmissive: 0xff6a1a,
      glassIntensity: 1.5,
    });
  } else {
    applyFinish({
      plaster: 0xf4ecdf,
      plasterRoughness: 0.7,
      beam: 0x6a3b22,
      beamRoughness: 0.76,
      timber: 0xd39a58,
      roof: 0x5c3d9e,
      roofLight: 0x8d6ad8,
      roofRoughness: 0.32,
      roofMetalness: 0.2,
      glassIntensity: 1.25,
    });
  }

  // Plaster walls on a thicker stone plinth. Timber stays on corners, the floor belt, and studs.
  for (let gy = 2; gy <= 11; gy++) {
    const y = gy * u;
    for (let gx = -7; gx <= 3; gx++) {
      for (let gz = -6; gz <= 3; gz++) {
        const isOuter = gx === -7 || gx === 3 || gz === -6 || gz === 3;
        if (!isOuter) continue;
        const x = gx * u;
        const z = gz * u;
        const isFrontDoor = gz === 3 && (gx === -3 || gx === -2) && gy >= 2 && gy <= 4;
        const isFrontWin =
          gz === 3 &&
          (((gy >= 3 && gy <= 5) && (gx === -6 || gx === -5 || gx === 0 || gx === 1)) ||
            ((gy >= 8 && gy <= 10) && (gx === -6 || gx === -5 || gx === 0 || gx === 1)));
        const isBackWin =
          gz === -6 &&
          (((gy >= 3 && gy <= 5) && (gx === -5 || gx === -4 || gx === -2 || gx === -1)) ||
            ((gy >= 8 && gy <= 10) && (gx === -3 || gx === -2)));
        const isSideWin =
          ((gx === -7 && (gz === -2 || gz === 1)) || (gx === 3 && gz === -4)) &&
          (gy === 4 || gy === 5 || gy === 8 || gy === 9);
        const isCorner = (gx === -7 || gx === 3) && (gz === -6 || gz === 3);
        const isStud =
          gy >= 8 &&
          gy <= 10 &&
          (((gz === 3 || gz === -6) && gx % 2 === 0) || ((gx === -7 || gx === 3) && gz % 2 === 0));
        const isBand = gy === 7 || gy === 11;

        if (isFrontDoor) continue;
        if (isFrontWin) {
          pushFramedWindow(x, y, z, 0, 1, gy === 3 || gy === 8);
        } else if (isBackWin) {
          pushFramedWindow(x, y, z, 0, -1, gy === 3 || gy === 8);
        } else if (isSideWin) {
          pushFramedWindow(x, y, z, gx === -7 ? -1 : 1, 0, gy === 4 || gy === 8);
        } else if (isCorner || isBand || isStud) {
          timberSpecs.push({ x, y, z });
        } else if (gy === 2) {
          stoneDarkSpecs.push({ x, y, z, sx: 1.18, sy: 1.05, sz: 1.18 });
        } else {
          stoneLightSpecs.push({ x, y, z });
        }
      }
    }
  }

  // Purple door, awning, paired lanterns.
  roofDarkSpecs.push({ x: -1.25, y: 1.55, z: 1.72, sx: 1.15, sy: 2.2, sz: 0.28 });
  roofDarkSpecs.push({ x: -1.25, y: 2.62, z: 2.05, sx: 2.6, sy: 0.22, sz: 1.25 });
  timberSpecs.push(
    { x: -1.85, y: 1.55, z: 1.62, sx: 0.22, sy: 2.3, sz: 0.22 },
    { x: -0.65, y: 1.55, z: 1.62, sx: 0.22, sy: 2.3, sz: 0.22 },
  );
  lanternSpecs.push(
    { x: -1.95, y: 1.25, z: 2.05, sx: 0.26, sy: 0.36, sz: 0.26 },
    { x: -0.55, y: 1.25, z: 2.05, sx: 0.26, sy: 0.36, sz: 0.26 },
  );
  stoneMidSpecs.push(
    { x: -1.95, y: 0.72, z: 2.05, sx: 0.22, sy: 1.15, sz: 0.22 },
    { x: -0.55, y: 0.72, z: 2.05, sx: 0.22, sy: 1.15, sz: 0.22 },
  );

  // Two stair flights on the front: an upper run, a landing, then a lower run to the path.
  for (let s = 0; s < 4; s++) {
    const y = 0.96 - s * 0.16;
    const z = 2.35 + s * 0.48;
    pushStone(-1.25, y, z, 2.35, 0.42, 0.62);
    timberSpecs.push(
      { x: -2.45, y: y + 0.55, z, sx: 0.16, sy: 0.85, sz: 0.16 },
      { x: -0.05, y: y + 0.55, z, sx: 0.16, sy: 0.85, sz: 0.16 },
    );
  }
  timberSpecs.push(
    { x: -2.45, y: 1.35, z: 3.05, sx: 0.14, sy: 0.14, sz: 2.0 },
    { x: -0.05, y: 1.35, z: 3.05, sx: 0.14, sy: 0.14, sz: 2.0 },
  );
  pushStone(-1.25, 0.34, 4.35, 2.8, 0.4, 1.35);
  stoneLightSpecs.push({ x: -1.25, y: 0.52, z: 4.35, sx: 2.45, sy: 0.14, sz: 1.05 });
  for (let s = 0; s < 3; s++) {
    const y = 0.28 - s * 0.1;
    const z = 5.15 + s * 0.48;
    pushStone(-1.25, y, z, 2.55, 0.36, 0.62);
    timberSpecs.push(
      { x: -2.55, y: y + 0.48, z, sx: 0.16, sy: 0.7, sz: 0.16 },
      { x: 0.05, y: y + 0.48, z, sx: 0.16, sy: 0.7, sz: 0.16 },
    );
  }
  timberSpecs.push(
    { x: -2.55, y: 0.72, z: 5.6, sx: 0.14, sy: 0.14, sz: 1.5 },
    { x: 0.05, y: 0.72, z: 5.6, sx: 0.14, sy: 0.14, sz: 1.5 },
  );

  // Paired shutters and flower boxes on the front windows.
  for (const [cx, y] of [
    [-2.75, 2.05],
    [-2.75, 4.5],
    [0.25, 2.05],
    [0.25, 4.5],
  ] as const) {
    roofDarkSpecs.push(
      { x: cx - 0.78, y, z: 1.68, sx: 0.2, sy: 1.2, sz: 0.16 },
      { x: cx + 0.78, y, z: 1.68, sx: 0.2, sy: 1.2, sz: 0.16 },
    );
  }
  for (const cx of [-2.75, 0.25]) {
    timberSpecs.push({ x: cx, y: 1.22, z: 1.82, sx: 1.45, sy: 0.28, sz: 0.42 });
    mossSpecs.push({ x: cx, y: 1.4, z: 1.9, sx: 1.2, sy: 0.18, sz: 0.28 });
    d.blossomPinkSpecs.push(
      { x: cx - 0.28, y: 1.58, z: 1.96, sx: 0.22, sy: 0.2, sz: 0.22 },
      { x: cx + 0.28, y: 1.56, z: 1.96, sx: 0.2, sy: 0.18, sz: 0.2 },
    );
    d.blossomGoldSpecs.push({ x: cx, y: 1.58, z: 2.0, sx: 0.18, sy: 0.18, sz: 0.18 });
    d.blossomWhiteSpecs.push({ x: cx + 0.12, y: 1.54, z: 1.9, sx: 0.16, sy: 0.16, sz: 0.16 });
  }

  // Solid gable: every column sits on the slope, with an eave past the walls.
  const ridgeGx = -2;
  for (let gx = -9; gx <= 5; gx++) {
    const step = Math.abs(gx - ridgeGx);
    if (step > 7) continue;
    const y = 8.35 - step * 0.38;
    for (let gz = -8; gz <= 5; gz++) {
      const x = gx * u;
      const z = gz * u;
      const isAttic = gz === 4 && (gx === -3 || gx === -1);
      if (isAttic) {
        pushFramedWindow(x, y, z + 0.08, 0, 1, false);
        continue;
      }
      pushRoof(x, y, z, 1.14, 0.5, 1.14);
    }
  }
  for (let gz = -8; gz <= 5; gz++) {
    const z = gz * u;
    const eaveY = 8.35 - 7 * 0.38 - 0.12;
    timberSpecs.push(
      { x: -4.5, y: eaveY, z, sx: 0.32, sy: 0.28, sz: 0.9 },
      { x: 2.5, y: eaveY, z, sx: 0.32, sy: 0.28, sz: 0.9 },
    );
  }

  // Chimney stands on the ridge. Smoke starts at the cap.
  stoneMidSpecs.push({ x: -1.0, y: 9.25, z: -0.45, sx: 0.72, sy: 3.4, sz: 0.72 });
  stoneLightSpecs.push({ x: -1.0, y: 10.15, z: -0.45, sx: 0.98, sy: 0.42, sz: 0.98 });
  d.smokeSpecs.push(
    { x: -0.82, y: 10.42, z: -0.28, sx: 0.38, sy: 0.3, sz: 0.38 },
    { x: -0.62, y: 10.68, z: -0.08, sx: 0.48, sy: 0.32, sz: 0.48 },
  );

  // Side woodshed under a purple awning, with a log stack and a barrel.
  timberSpecs.push(
    { x: 2.15, y: 1.05, z: -0.55, sx: 0.28, sy: 2.5, sz: 0.28 },
    { x: 3.25, y: 1.05, z: -0.55, sx: 0.28, sy: 2.5, sz: 0.28 },
    { x: 2.15, y: 0.85, z: 0.55, sx: 0.26, sy: 2.0, sz: 0.26 },
    { x: 3.25, y: 0.85, z: 0.55, sx: 0.26, sy: 2.0, sz: 0.26 },
  );
  roofDarkSpecs.push(
    { x: 2.7, y: 2.15, z: 0.05, sx: 2.5, sy: 0.24, sz: 2.15 },
    { x: 2.7, y: 1.72, z: 0.55, sx: 2.5, sy: 0.22, sz: 1.15 },
  );
  timberSpecs.push(
    { x: 2.45, y: 0.42, z: 0.05, sx: 1.15, sy: 0.48, sz: 0.62 },
    { x: 2.55, y: 0.72, z: 0.02, sx: 0.95, sy: 0.28, sz: 0.48 },
  );
  scaffSpecs.push({ x: 3.15, y: 0.42, z: 0.15, sx: 0.85, sy: 0.78, sz: 0.85 });

  if (variant === "timber") {
    timberSpecs.push(
      { x: -1.0, y: 3.55, z: 1.72, sx: 4.6, sy: 0.16, sz: 0.18 },
      { x: -1.0, y: 4.15, z: 1.72, sx: 4.6, sy: 0.16, sz: 0.18 },
      { x: 3.55, y: 0.55, z: -0.2, sx: 0.7, sy: 0.7, sz: 1.3 },
      { x: 3.7, y: 0.95, z: -0.15, sx: 0.5, sy: 0.4, sz: 1.05 },
    );
    for (const x of [-2.7, -1.6, -0.4, 0.7]) {
      timberSpecs.push({ x, y: 2.15, z: 1.68, sx: 0.16, sy: 2.6, sz: 0.14 });
    }
    scaffSpecs.push({ x: -1.0, y: 2.55, z: 1.74, sx: 3.6, sy: 0.12, sz: 0.12 });
  } else if (variant === "lantern") {
    for (const [x, z] of [[-3.4, 2.3], [0.9, 2.3], [-3.4, -2.6], [0.9, -2.6]] as const) {
      stoneMidSpecs.push({ x, y: 0.7, z, sx: 0.22, sy: 1.5, sz: 0.22 });
      lanternSpecs.push({ x, y: 1.55, z, sx: 0.32, sy: 0.36, sz: 0.32 });
      stoneDarkSpecs.push({ x, y: 1.82, z, sx: 0.42, sy: 0.12, sz: 0.42 });
    }
    for (const x of [-2.6, -1.25, 0.15]) {
      lanternSpecs.push({ x, y: 5.35, z: 1.92, sx: 0.28, sy: 0.32, sz: 0.22 });
    }
    scaffSpecs.push({ x: -1.15, y: 5.15, z: 1.78, sx: 3.4, sy: 0.1, sz: 0.12 });
  } else if (variant === "garden") {
    for (const x of [-3.2, -1.0, 1.1]) {
      timberSpecs.push({ x, y: 2.55, z: -3.15, sx: 1.2, sy: 0.24, sz: 0.36 });
      mossSpecs.push({ x, y: 2.72, z: -3.22, sx: 1.0, sy: 0.16, sz: 0.24 });
      d.blossomPinkSpecs.push({ x: x - 0.2, y: 2.88, z: -3.28, sx: 0.2, sy: 0.18, sz: 0.2 });
      d.blossomGoldSpecs.push({ x: x + 0.22, y: 2.86, z: -3.28, sx: 0.18, sy: 0.16, sz: 0.18 });
    }
    for (const x of [-3.45, 1.45]) {
      mossSpecs.push({ x, y: 2.4, z: 1.72, sx: 0.22, sy: 2.8, sz: 0.16 });
      d.blossomPinkSpecs.push({ x, y: 3.5, z: 1.82, sx: 0.28, sy: 0.24, sz: 0.22 });
      d.blossomWhiteSpecs.push({ x: x + 0.12, y: 2.1, z: 1.8, sx: 0.2, sy: 0.18, sz: 0.18 });
    }
    mossSpecs.push({ x: -1.25, y: 3.3, z: 1.85, sx: 0.2, sy: 1.4, sz: 0.16 });
  } else if (variant === "stone") {
    pushStone(-1.25, 2.85, 2.15, 2.4, 0.35, 0.45);
    pushStone(-1.25, 3.15, 2.35, 1.5, 0.28, 0.4);
    stoneDarkSpecs.push(
      { x: -2.15, y: 1.7, z: 2.05, sx: 0.35, sy: 2.4, sz: 0.35 },
      { x: -0.35, y: 1.7, z: 2.05, sx: 0.35, sy: 2.4, sz: 0.35 },
    );
    stoneMidSpecs.push({ x: -1.05, y: 5.65, z: 1.82, sx: 4.4, sy: 0.28, sz: 0.32 });
    stoneDarkSpecs.push({ x: -1.05, y: 5.88, z: 1.9, sx: 4.6, sy: 0.14, sz: 0.22 });
  } else if (variant === "hearth") {
    stoneMidSpecs.push(
      { x: -3.3, y: 0.7, z: 2.15, sx: 1.15, sy: 1.2, sz: 1.05 },
      { x: -3.3, y: 1.45, z: 2.15, sx: 0.7, sy: 0.7, sz: 0.7 },
    );
    stoneLightSpecs.push({ x: -3.3, y: 1.85, z: 2.15, sx: 0.9, sy: 0.18, sz: 0.9 });
    stoneDarkSpecs.push(
      { x: -2.55, y: 1.55, z: 1.68, sx: 0.28, sy: 1.5, sz: 0.16 },
      { x: -2.7, y: 2.15, z: 1.66, sx: 0.7, sy: 0.22, sz: 0.14 },
    );
    d.warmGlassSpecs.push({ x: -3.3, y: 0.72, z: 2.55, sx: 0.42, sy: 0.36, sz: 0.16 });
    d.smokeSpecs.push(
      { x: -3.15, y: 2.15, z: 2.3, sx: 0.32, sy: 0.26, sz: 0.32 },
      { x: -3.0, y: 2.42, z: 2.45, sx: 0.4, sy: 0.28, sz: 0.4 },
    );
  }
}
