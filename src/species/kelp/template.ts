import {
  BLADES,
  BLADE_HW,
  BLADE_T,
  BLADE_U_END,
  BLADE_U_START,
  BLADDER_U_GAP,
  BLADDER_U_LEN,
  HOLDFAST_V1,
  STIPE_U0,
  STIPE_U1,
  bladeRow,
} from './layout';

/** Natural olive / golden-brown giant kelp colouring, laid out to match layout.ts. */
export function drawKelpTemplate(ctx: CanvasRenderingContext2D) {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const X = (u: number) => u * W;
  const Y = (v: number) => (1 - v) * H;
  let seed = 99;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };

  ctx.save();
  // Base colour everywhere so mip-map bleeding at UV seams stays kelp-coloured.
  ctx.fillStyle = '#6e5f22';
  ctx.fillRect(0, 0, W, H);

  // --- Stipe strip: darker, rounded shading (front in the middle), faint growth rings.
  const sx0 = X(STIPE_U0);
  const sx1 = X(STIPE_U1);
  const sg = ctx.createLinearGradient(sx0, 0, sx1, 0);
  sg.addColorStop(0, '#3e3412');
  sg.addColorStop(0.5, '#62541d');
  sg.addColorStop(1, '#3e3412');
  ctx.fillStyle = sg;
  ctx.fillRect(sx0 - 4, 0, sx1 - sx0 + 8, H);
  ctx.strokeStyle = 'rgba(40, 30, 8, 0.35)';
  ctx.lineWidth = 1.5;
  for (let y = 6; y < Y(HOLDFAST_V1); y += 14 + rand() * 10) {
    ctx.beginPath();
    ctx.moveTo(sx0, y);
    ctx.lineTo(sx1, y + (rand() - 0.5) * 3);
    ctx.stroke();
  }
  // Holdfast: knobbly dark root mass at the bottom of the strip.
  const hy = Y(HOLDFAST_V1);
  ctx.fillStyle = '#3a2a12';
  ctx.fillRect(sx0 - 4, hy, sx1 - sx0 + 8, H - hy);
  for (let i = 0; i < 24; i++) {
    ctx.fillStyle = rand() > 0.5 ? '#4d3a18' : '#2c200c';
    ctx.beginPath();
    ctx.arc(sx0 + rand() * (sx1 - sx0), hy + rand() * (H - hy), 2 + rand() * 4, 0, Math.PI * 2);
    ctx.fill();
  }

  // --- Blades and bladders.
  for (const b of BLADES) {
    const row = bladeRow(b);
    const pts = BLADE_T.map((t, i) => ({
      x: X(row.uAt(BLADE_U_START + (BLADE_U_END - BLADE_U_START) * t)),
      hw: row.vHalf * BLADE_HW[i] * H,
    }));
    const cy = Y(row.vMid);
    // Piecewise linear, exactly like the mesh edges, so painted margins land on the margins.
    const outline = (shrink: number, pad: number) => {
      ctx.beginPath();
      ctx.moveTo(pts[0].x - b.side * pad, cy);
      for (let i = 0; i < pts.length; i++) ctx.lineTo(pts[i].x, cy - (pts[i].hw * shrink + pad));
      ctx.lineTo(pts[pts.length - 1].x + b.side * pad, cy);
      for (let i = pts.length - 1; i >= 0; i--) ctx.lineTo(pts[i].x, cy + pts[i].hw * shrink + pad);
      ctx.closePath();
    };

    // Short stem from the stipe to the bladder and on to the blade.
    ctx.strokeStyle = '#4f4316';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(X(row.uAt(-0.004)), cy);
    ctx.lineTo(pts[1].x, cy);
    ctx.stroke();

    // Light, slightly translucent blade margin, then the darker golden-brown body.
    ctx.fillStyle = '#b39a45';
    outline(1, 3);
    ctx.fill();
    const g = ctx.createLinearGradient(pts[0].x, 0, pts[pts.length - 1].x, 0);
    g.addColorStop(0, '#6e5a1a');
    g.addColorStop(0.35, '#8a7225');
    g.addColorStop(1, '#9c8530');
    ctx.fillStyle = g;
    outline(0.74, 0);
    ctx.fill();

    // Subtle veins: a midrib and fine diagonal wrinkles toward the margins.
    ctx.strokeStyle = 'rgba(205, 180, 95, 0.45)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, cy);
    ctx.lineTo(pts[pts.length - 1].x, cy);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(60, 45, 10, 0.28)';
    ctx.lineWidth = 1;
    const len = pts[pts.length - 1].x - pts[0].x;
    for (let k = 1; k < 16; k++) {
      const x = pts[0].x + (len * k) / 16;
      const t = k / 16;
      // Interpolate half-width along the blade.
      let i = 1;
      while (i < BLADE_T.length - 1 && BLADE_T[i] < t) i++;
      const f = (t - BLADE_T[i - 1]) / (BLADE_T[i] - BLADE_T[i - 1]);
      const hw = (pts[i - 1].hw + (pts[i].hw - pts[i - 1].hw) * f) * 0.85;
      const lean = b.side * hw * 0.8;
      ctx.beginPath();
      ctx.moveTo(x, cy);
      ctx.lineTo(x + lean, cy - hw);
      ctx.moveTo(x, cy);
      ctx.lineTo(x + lean, cy + hw);
      ctx.stroke();
    }

    // Gas bladder: dark rounded float with a soft highlight.
    const bx = X(row.uAt(BLADDER_U_GAP + BLADDER_U_LEN / 2));
    const brx = (BLADDER_U_LEN / 2) * W + 2;
    const bry = row.vHalf * H * 0.95;
    ctx.fillStyle = '#4a3a10';
    ctx.beginPath();
    ctx.ellipse(bx, cy, brx, bry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(190, 160, 70, 0.55)';
    ctx.beginPath();
    ctx.ellipse(bx - brx * 0.25, cy - bry * 0.35, brx * 0.35, bry * 0.25, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * Colouring-book page: white kelp with black outlines on the blades, bladders and holdfast knobs,
 * a midrib on each blade and outlined stems, laid out exactly like the natural template.
 */
export function drawKelpColoringPage(ctx: CanvasRenderingContext2D) {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const X = (u: number) => u * W;
  const Y = (v: number) => (1 - v) * H;
  const PAPER = '#fbfbf6';
  const INK = '#121212';
  let seed = 99;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, W, H);

  // Stipe: outline its front face (the middle half of the strip) and mark the holdfast top.
  const sx0 = X(STIPE_U0);
  const sx1 = X(STIPE_U1);
  const q = (sx1 - sx0) / 4;
  const hy = Y(HOLDFAST_V1);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(sx0 + q, 0);
  ctx.lineTo(sx0 + q, hy);
  ctx.moveTo(sx1 - q, 0);
  ctx.lineTo(sx1 - q, hy);
  ctx.moveTo(sx0 - 4, hy);
  ctx.lineTo(sx1 + 4, hy);
  ctx.stroke();
  // Holdfast knobs as little outlined circles.
  ctx.lineWidth = 2;
  for (let i = 0; i < 10; i++) {
    ctx.beginPath();
    ctx.arc(sx0 + rand() * (sx1 - sx0), hy + 6 + rand() * (H - hy - 10), 3 + rand() * 3, 0, Math.PI * 2);
    ctx.stroke();
  }

  for (const b of BLADES) {
    const row = bladeRow(b);
    const pts = BLADE_T.map((t, i) => ({
      x: X(row.uAt(BLADE_U_START + (BLADE_U_END - BLADE_U_START) * t)),
      hw: row.vHalf * BLADE_HW[i] * H,
    }));
    const cy = Y(row.vMid);

    // Stem from the stipe to the blade: an outlined white band.
    ctx.beginPath();
    ctx.moveTo(X(row.uAt(-0.004)), cy);
    ctx.lineTo(pts[1].x, cy);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 8;
    ctx.stroke();
    ctx.strokeStyle = PAPER;
    ctx.lineWidth = 4;
    ctx.stroke();

    // Blade outline (inset slightly so the line stays on the blade, not in the seam padding).
    ctx.beginPath();
    ctx.moveTo(pts[0].x, cy);
    for (let i = 0; i < pts.length; i++) ctx.lineTo(pts[i].x, cy - pts[i].hw * 0.94);
    ctx.lineTo(pts[pts.length - 1].x, cy);
    for (let i = pts.length - 1; i >= 0; i--) ctx.lineTo(pts[i].x, cy + pts[i].hw * 0.94);
    ctx.closePath();
    ctx.fillStyle = PAPER;
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
    ctx.stroke();

    // Midrib.
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(pts[1].x, cy);
    ctx.lineTo(pts[pts.length - 2].x, cy);
    ctx.stroke();

    // Gas bladder.
    const bx = X(row.uAt(BLADDER_U_GAP + BLADDER_U_LEN / 2));
    const brx = (BLADDER_U_LEN / 2) * W;
    const bry = row.vHalf * H * 0.85;
    ctx.beginPath();
    ctx.ellipse(bx, cy, brx, bry, 0, 0, Math.PI * 2);
    ctx.fillStyle = PAPER;
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }
  ctx.restore();
}
