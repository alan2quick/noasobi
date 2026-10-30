import {
  ARM,
  DISC_CX,
  DISC_CY,
  DISC_R,
  GONAD,
  LOBES,
  RINGS,
  TENTACLE_LANES,
  discPoint,
  gonadAzimuth,
  ringRho,
} from './layout';

type Ctx = CanvasRenderingContext2D;

const TAU = Math.PI * 2;

/** Horseshoe-shaped gonad ring, open towards the rim. `grow` fattens it (for halos). */
function horseshoe(ctx: Ctx, phi: number, grow = 0) {
  const [cx, cy] = discPoint(phi, GONAD.rho);
  const mid = GONAD.radius;
  const ro = mid + GONAD.thickness / 2 + grow;
  const ri = Math.max(2, mid - GONAD.thickness / 2 - grow);
  // The opening faces outwards (direction phi), so the ring runs the long way round.
  const a0 = phi + GONAD.gap;
  const a1 = phi - GONAD.gap + TAU;
  const capR = (ro - ri) / 2;
  const rm = (ro + ri) / 2;
  ctx.beginPath();
  ctx.arc(cx, cy, ro, a0, a1);
  ctx.arc(cx + rm * Math.cos(a1), cy + rm * Math.sin(a1), capR, a1, a1 + Math.PI);
  ctx.arc(cx, cy, ri, a1, a0, true);
  ctx.arc(cx + rm * Math.cos(a0), cy + rm * Math.sin(a0), capR, a0 + Math.PI, a0 + TAU);
  ctx.closePath();
}

/** Notches of the scalloped margin: cos(LOBES * phi) = -1. */
function notchAzimuth(k: number) {
  return (Math.PI * (2 * k + 1)) / LOBES;
}

/** Natural pale, translucent-looking moon jelly (Aurelia aurita), laid out to match layout.ts. */
export function drawJellyfishTemplate(ctx: Ctx) {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  ctx.save();
  // Base colour everywhere so mip-map bleeding at island edges stays jelly-coloured.
  ctx.fillStyle = '#cfe0f3';
  ctx.fillRect(0, 0, W, H);

  // --- Bell: milky blue with a faint pink core, a deeper violet-blue margin.
  const rim = ringRho(RINGS - 1);
  const g = ctx.createRadialGradient(DISC_CX, DISC_CY, 0, DISC_CX, DISC_CY, DISC_R);
  g.addColorStop(0, '#ecd9f1');
  g.addColorStop(0.35, '#dfe0f5');
  g.addColorStop(0.7, '#cfe0f6');
  g.addColorStop(rim / DISC_R, '#bcd5f4');
  g.addColorStop(1, '#a9bdf0');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(DISC_CX, DISC_CY, DISC_R, 0, TAU);
  ctx.fill();

  // Faint radial canals.
  ctx.lineCap = 'round';
  for (let k = 0; k < 32; k++) {
    const phi = (k / 32) * TAU;
    const [x0, y0] = discPoint(phi, 60);
    const [x1, y1] = discPoint(phi, rim - 8);
    ctx.strokeStyle = k % 2 ? 'rgba(255,255,255,0.16)' : 'rgba(150,170,225,0.22)';
    ctx.lineWidth = k % 2 ? 2 : 3;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }

  // Margin band: a soft mauve edge, scallop notches darker.
  ctx.lineWidth = 5;
  ctx.strokeStyle = 'rgba(158,140,224,0.55)';
  ctx.beginPath();
  ctx.arc(DISC_CX, DISC_CY, rim, 0, TAU);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(150,120,220,0.5)';
  ctx.lineWidth = 3;
  for (let k = 0; k < LOBES; k++) {
    const [x0, y0] = discPoint(notchAzimuth(k), rim - 4);
    const [x1, y1] = discPoint(notchAzimuth(k), DISC_R - 2);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(140,120,215,0.7)';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(DISC_CX, DISC_CY, DISC_R - 4, 0, TAU);
  ctx.stroke();

  // Four horseshoe gonad rings, pink to orchid.
  for (let k = 0; k < 4; k++) {
    const phi = gonadAzimuth(k);
    const [cx, cy] = discPoint(phi, GONAD.rho);
    horseshoe(ctx, phi, 7);
    ctx.fillStyle = 'rgba(235,160,205,0.28)';
    ctx.fill();
    horseshoe(ctx, phi);
    const gg = ctx.createRadialGradient(cx, cy, GONAD.radius * 0.5, cx, cy, GONAD.radius + GONAD.thickness);
    gg.addColorStop(0, '#f2a6cf');
    gg.addColorStop(1, '#cf72b4');
    ctx.fillStyle = gg;
    ctx.fill();
    ctx.strokeStyle = 'rgba(172,84,150,0.55)';
    ctx.lineWidth = 2;
    ctx.stroke();
    // A glint on the shoulder.
    ctx.strokeStyle = 'rgba(255,235,248,0.7)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, GONAD.radius + 1, phi + Math.PI * 0.75, phi + Math.PI * 1.1);
    ctx.stroke();
  }

  // Centre: where the oral arms join, a soft pink glow.
  const cg = ctx.createRadialGradient(DISC_CX, DISC_CY, 0, DISC_CX, DISC_CY, 46);
  cg.addColorStop(0, 'rgba(244,176,214,0.95)');
  cg.addColorStop(1, 'rgba(244,176,214,0)');
  ctx.fillStyle = cg;
  ctx.beginPath();
  ctx.arc(DISC_CX, DISC_CY, 46, 0, TAU);
  ctx.fill();

  // --- Oral arms: pink, deeper at the frilly edges, paler towards the tips.
  const aw = ARM.x1 - ARM.x0;
  const ah = ARM.y1 - ARM.y0;
  const ag = ctx.createLinearGradient(0, ARM.y0, 0, ARM.y1);
  ag.addColorStop(0, '#e98ec3');
  ag.addColorStop(0.55, '#f2b0d5');
  ag.addColorStop(1, '#f8d4e8');
  ctx.fillStyle = ag;
  ctx.fillRect(ARM.x0 - 3, ARM.y0 - 3, aw + 6, ah + 6);
  const eg = ctx.createLinearGradient(ARM.x0, 0, ARM.x1, 0);
  eg.addColorStop(0, 'rgba(205,90,160,0.55)');
  eg.addColorStop(0.2, 'rgba(205,90,160,0)');
  eg.addColorStop(0.8, 'rgba(205,90,160,0)');
  eg.addColorStop(1, 'rgba(205,90,160,0.55)');
  ctx.fillStyle = eg;
  ctx.fillRect(ARM.x0 - 3, ARM.y0 - 3, aw + 6, ah + 6);
  // The fold line and little frill wrinkles.
  ctx.strokeStyle = 'rgba(255,238,248,0.7)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(ARM.x0 + aw / 2, ARM.y0);
  ctx.lineTo(ARM.x0 + aw / 2, ARM.y1);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(200,100,160,0.4)';
  ctx.lineWidth = 2;
  for (let j = 0; j < 7; j++) {
    const y = ARM.y0 + (j + 0.5) * (ah / 7);
    ctx.beginPath();
    ctx.moveTo(ARM.x0 + 4, y);
    ctx.quadraticCurveTo(ARM.x0 + aw * 0.25, y + (j % 2 ? 8 : -8), ARM.x0 + aw * 0.5, y);
    ctx.quadraticCurveTo(ARM.x0 + aw * 0.75, y + (j % 2 ? -8 : 8), ARM.x1 - 4, y);
    ctx.stroke();
  }

  // --- Tentacles: lilac at the root, fading to near-white at the tips; a bright central thread.
  TENTACLE_LANES.forEach((lane, i) => {
    const lg = ctx.createLinearGradient(lane.x0, 0, lane.x1, 0);
    lg.addColorStop(0, i ? '#d6a8e0' : '#e4a6d6');
    lg.addColorStop(0.5, i ? '#e2c4ec' : '#ecc4e2');
    lg.addColorStop(1, '#f6e8f6');
    ctx.fillStyle = lg;
    ctx.fillRect(lane.x0 - 3, lane.y0 - 3, lane.x1 - lane.x0 + 6, lane.y1 - lane.y0 + 6);
    const mid = (lane.y0 + lane.y1) / 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(lane.x0, mid);
    ctx.lineTo(lane.x1, mid);
    ctx.stroke();
  });
  ctx.restore();
}

/** Uncoloured line art following the same layout: black outlines on white. */
export function drawJellyfishColoringPage(ctx: Ctx) {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#111111';
  ctx.lineWidth = 4;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const rim = ringRho(RINGS - 1);

  // Bell outline, the margin band with its scallop marks, and the little centre circle.
  ctx.beginPath();
  ctx.arc(DISC_CX, DISC_CY, DISC_R - 3, 0, TAU);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(DISC_CX, DISC_CY, rim, 0, TAU);
  ctx.stroke();
  for (let k = 0; k < LOBES; k++) {
    const [x0, y0] = discPoint(notchAzimuth(k), rim);
    const [x1, y1] = discPoint(notchAzimuth(k), DISC_R - 3);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(DISC_CX, DISC_CY, 26, 0, TAU);
  ctx.stroke();

  // Four gonad rings.
  for (let k = 0; k < 4; k++) {
    horseshoe(ctx, gonadAzimuth(k));
    ctx.stroke();
  }

  // Oral arm: outline with frill scallops along both edges, a fold line and wavy rungs.
  const aw = ARM.x1 - ARM.x0;
  const x0 = ARM.x0 + 3;
  const x1 = ARM.x1 - 3;
  const y0 = ARM.y0 + 3;
  const y1 = ARM.y1 - 3;
  const yAt = (j: number) => y0 + (j / 7) * (y1 - y0);
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y0);
  for (let j = 0; j < 7; j++) ctx.quadraticCurveTo(x1 + (j % 2 ? -12 : 0), yAt(j + 0.5), x1, yAt(j + 1));
  ctx.lineTo(x0, y1);
  for (let j = 6; j >= 0; j--) ctx.quadraticCurveTo(x0 + (j % 2 ? 12 : 0), yAt(j + 0.5), x0, yAt(j));
  ctx.closePath();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(ARM.x0 + aw / 2, y0);
  ctx.lineTo(ARM.x0 + aw / 2, y1);
  ctx.stroke();
  for (let j = 1; j < 7; j++) {
    const y = yAt(j);
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.quadraticCurveTo(ARM.x0 + aw * 0.25, y + (j % 2 ? 9 : -9), ARM.x0 + aw / 2, y);
    ctx.quadraticCurveTo(ARM.x0 + aw * 0.75, y + (j % 2 ? -9 : 9), x1, y);
    ctx.stroke();
  }

  // Tentacle lanes: a long outlined ribbon with a few cross lines.
  for (const lane of TENTACLE_LANES) {
    const lx0 = lane.x0 + 3;
    const lx1 = lane.x1 - 3;
    const ly0 = lane.y0 + 3;
    const ly1 = lane.y1 - 3;
    ctx.beginPath();
    ctx.rect(lx0, ly0, lx1 - lx0, ly1 - ly0);
    ctx.stroke();
    for (let i = 1; i < 6; i++) {
      const x = lx0 + (i / 6) * (lx1 - lx0);
      ctx.beginPath();
      ctx.moveTo(x, ly0);
      ctx.lineTo(x, ly1);
      ctx.stroke();
    }
  }
  ctx.restore();
}
