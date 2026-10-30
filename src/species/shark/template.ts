import {
  ANAL_EDGE,
  CAUDAL_OUTLINE,
  DORSAL1_EDGE,
  DORSAL2_EDGE,
  GILL_LEN,
  GILL_X,
  LEFT_ORIGIN_PX,
  NOSE_X,
  PECTORAL_ISLAND,
  PECTORAL_LEN,
  PECTORAL_OUTLINE,
  PELVIC_ISLAND,
  PELVIC_OUTLINE,
  PEDUNCLE_X,
  PX_PER_UNIT,
  TEX_W,
  bodyBot,
  bodyTop,
  islandPoint,
  medianFinPolygon,
  shadeBoundaryY,
} from './layout';

/**
 * Natural blacktip reef shark colouring: grey-bronze back fading softly into a white belly, black
 * tips on the first dorsal, pectorals and lower tail lobe (a dusky edge on the upper lobe), five
 * gill slits and a gentle smile. Drawn in shark space for the left flank, then replayed
 * horizontally flipped for the right flank, which is exactly the bilateral (1 - u) mirror.
 * Units below are shark units (1 = body length).
 */

const BACK = '#7f7a72';
const BACK_LIGHT = '#a49e91';
const FLANK = '#cfcabf';
const BELLY = '#f7f5ef';
const WHITE = '#fbfbf6';
const BLACK = '#121212';
const LINE = '#46423c';

type Ctx = CanvasRenderingContext2D;

function polyPath(ctx: Ctx, poly: [number, number][], close = true) {
  ctx.beginPath();
  poly.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  if (close) ctx.closePath();
}

/** Body silhouette. `open` leaves the tail end unclosed (for outlines: the tail fin continues there). */
function bodyPath(ctx: Ctx, open = false) {
  const steps = 32;
  const grow = 1;
  ctx.beginPath();
  if (open) {
    // Belly from the peduncle forward, round the snout, back along the top: no line across the tail root.
    for (let i = steps; i >= 0; i--) {
      const x = NOSE_X - (i / steps) * (NOSE_X - PEDUNCLE_X);
      const mid = (bodyTop(x) + bodyBot(x)) / 2;
      const y = mid + (bodyBot(x) - mid) * grow;
      if (i === steps) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    for (let i = 0; i <= steps; i++) {
      const x = NOSE_X - (i / steps) * (NOSE_X - PEDUNCLE_X);
      const mid = (bodyTop(x) + bodyBot(x)) / 2;
      ctx.lineTo(x, mid + (bodyTop(x) - mid) * grow);
    }
    return;
  }
  for (let i = 0; i <= steps; i++) {
    const x = NOSE_X - (i / steps) * (NOSE_X - PEDUNCLE_X);
    const mid = (bodyTop(x) + bodyBot(x)) / 2;
    const y = mid + (bodyTop(x) - mid) * grow;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  for (let i = steps; i >= 0; i--) {
    const x = NOSE_X - (i / steps) * (NOSE_X - PEDUNCLE_X);
    const mid = (bodyTop(x) + bodyBot(x)) / 2;
    ctx.lineTo(x, mid + (bodyBot(x) - mid) * grow);
  }
  ctx.closePath();
}

/** Free edge of a median fin as an open path (the base stays hidden in the body). */
function medianEdgePath(ctx: Ctx, edge: [number, number][], dir: 1 | -1) {
  ctx.beginPath();
  edge.forEach(([x, h], i) => {
    const y = (dir > 0 ? bodyTop(x) - 0.012 : bodyBot(x) + 0.012) + dir * h;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
}

function islandPolygon(island: { x: number; y: number }, outline: [number, number][]): [number, number][] {
  return outline.map(([l, w]) => islandPoint(island, l, w));
}

function gillPath(ctx: Ctx, i: number) {
  const x0 = GILL_X[i];
  const top = bodyTop(x0);
  const bot = bodyBot(x0);
  const mid = (top + bot) / 2;
  const half = (top - bot) / 2;
  const k = GILL_LEN[i];
  const yTop = mid + half * 0.62 * k;
  const yBot = mid - half * 0.5 * k;
  ctx.beginPath();
  ctx.moveTo(x0 + 0.005, yTop);
  ctx.quadraticCurveTo(x0 - 0.007, (yTop + yBot) / 2, x0 + 0.004, yBot);
}

function smilePath(ctx: Ctx) {
  ctx.beginPath();
  ctx.moveTo(0.464, -0.027);
  ctx.quadraticCurveTo(0.43, -0.046, 0.404, -0.027);
  ctx.lineTo(0.399, -0.019);
}

function polyBounds(poly: [number, number][]) {
  let minY = Infinity, maxY = -Infinity;
  for (const [, y] of poly) {
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return { minY, maxY };
}

const DORSAL1_POLY = medianFinPolygon(DORSAL1_EDGE, 1);
/** Black tip of the first dorsal: everything above this height (fades in over 0.025). */
const DORSAL_TIP_Y = polyBounds(DORSAL1_POLY).maxY - 0.05;
/** Pectoral black tip starts at this distance along the span. */
const PECTORAL_TIP_AT = PECTORAL_LEN * 0.68;
const LOWER_TIP = { x: -0.44, y: -0.09, r: 0.056 };
const UPPER_TIP = { x: -0.5, y: 0.13, r: 0.05 };

function drawFlank(ctx: Ctx, coloring: boolean) {
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  if (coloring) {
    ctx.fillStyle = WHITE;
    ctx.fillRect(-0.6, -0.6, 1.2, 1.2);
  } else {
    // Countershading: thin vertical strips, each with its own back → belly gradient whose boundary
    // follows the flank (low at the snout, higher towards the tail). Covers fins and islands too.
    const top = 0.65;
    const bot = -0.65;
    const step = 0.012;
    for (let x = 0.6; x > -0.6; x -= step) {
      const b = shadeBoundaryY(x);
      const g = ctx.createLinearGradient(0, top, 0, bot);
      const at = (y: number) => Math.min(1, Math.max(0, (top - y) / (top - bot)));
      g.addColorStop(0, BACK);
      g.addColorStop(at(b + 0.085), BACK);
      g.addColorStop(at(b + 0.04), BACK_LIGHT);
      g.addColorStop(at(b + 0.005), FLANK);
      g.addColorStop(at(b - 0.035), BELLY);
      g.addColorStop(1, BELLY);
      ctx.fillStyle = g;
      ctx.fillRect(x - step - 0.003, bot, step + 0.006, top - bot);
    }

    // Black tip of the first dorsal.
    ctx.save();
    polyPath(ctx, DORSAL1_POLY);
    ctx.clip();
    let g = ctx.createLinearGradient(0, DORSAL_TIP_Y, 0, DORSAL_TIP_Y - 0.022);
    g.addColorStop(0, BLACK);
    g.addColorStop(1, 'rgba(18,18,18,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-0.3, DORSAL_TIP_Y - 0.022, 0.8, 0.5);
    ctx.restore();

    // Second dorsal and anal fin: a faint dusky tip.
    for (const [edge, dir] of [[DORSAL2_EDGE, 1], [ANAL_EDGE, -1]] as const) {
      ctx.save();
      polyPath(ctx, medianFinPolygon(edge as [number, number][], dir));
      ctx.clip();
      const ex = -0.2, ey = dir > 0 ? bodyTop(ex) + 0.04 : bodyBot(ex) - 0.045;
      const rg = ctx.createRadialGradient(ex, ey, 0.004, ex, ey, 0.045);
      rg.addColorStop(0, 'rgba(60,56,50,0.55)');
      rg.addColorStop(1, 'rgba(60,56,50,0)');
      ctx.fillStyle = rg;
      ctx.fillRect(ex - 0.06, ey - 0.06, 0.12, 0.12);
      ctx.restore();
    }

    // Tail: black lower lobe tip, dusky edge on the upper lobe.
    ctx.save();
    polyPath(ctx, CAUDAL_OUTLINE);
    ctx.clip();
    for (const [tip, solid, alpha] of [[LOWER_TIP, 0.5, 1], [UPPER_TIP, 0.2, 0.55]] as const) {
      const rg = ctx.createRadialGradient(tip.x, tip.y, tip.r * solid, tip.x, tip.y, tip.r);
      rg.addColorStop(0, `rgba(18,18,18,${alpha})`);
      rg.addColorStop(1, 'rgba(18,18,18,0)');
      ctx.fillStyle = rg;
      ctx.fillRect(tip.x - tip.r, tip.y - tip.r, tip.r * 2, tip.r * 2);
    }
    ctx.restore();

    // Paired fin islands: grey pectoral (pale towards the trailing edge) with a black tip; pale pelvic.
    const pec = islandPolygon(PECTORAL_ISLAND, PECTORAL_OUTLINE);
    ctx.save();
    polyPath(ctx, pec);
    ctx.clip();
    g = ctx.createLinearGradient(0, PECTORAL_ISLAND.y + 0.05, 0, PECTORAL_ISLAND.y - 0.03);
    g.addColorStop(0, BACK);
    g.addColorStop(1, FLANK);
    ctx.fillStyle = g;
    ctx.fillRect(-0.1, -0.6, 0.5, 0.4);
    const tx = PECTORAL_ISLAND.x - PECTORAL_TIP_AT;
    g = ctx.createLinearGradient(tx + 0.02, 0, tx - 0.01, 0);
    g.addColorStop(0, 'rgba(18,18,18,0)');
    g.addColorStop(1, BLACK);
    ctx.fillStyle = g;
    ctx.fillRect(-0.1, -0.6, tx + 0.02 + 0.1, 0.4);
    ctx.restore();

    ctx.save();
    polyPath(ctx, islandPolygon(PELVIC_ISLAND, PELVIC_OUTLINE));
    ctx.clip();
    ctx.fillStyle = BELLY;
    ctx.fillRect(-0.3, -0.6, 0.6, 0.4);
    ctx.restore();

    // Gill slits.
    ctx.strokeStyle = LINE;
    ctx.lineWidth = 0.0075;
    for (let i = 0; i < GILL_X.length; i++) {
      gillPath(ctx, i);
      ctx.stroke();
    }
    // A gentle smile.
    ctx.lineWidth = 0.006;
    smilePath(ctx);
    ctx.stroke();
    return;
  }

  // ── Colouring page: black line art only ──
  ctx.strokeStyle = BLACK;

  // Body outline.
  ctx.lineWidth = 0.011;
  bodyPath(ctx, true);
  ctx.stroke();

  // Fin free edges.
  medianEdgePath(ctx, DORSAL1_EDGE, 1);
  ctx.stroke();
  medianEdgePath(ctx, DORSAL2_EDGE, 1);
  ctx.stroke();
  medianEdgePath(ctx, ANAL_EDGE, -1);
  ctx.stroke();
  polyPath(ctx, CAUDAL_OUTLINE, false);
  ctx.stroke();

  // Countershading boundary, inside the body.
  ctx.save();
  bodyPath(ctx);
  ctx.clip();
  ctx.lineWidth = 0.008;
  ctx.beginPath();
  for (let i = 0; i <= 40; i++) {
    const x = 0.49 - (i / 40) * 0.8;
    if (i === 0) ctx.moveTo(x, shadeBoundaryY(x));
    else ctx.lineTo(x, shadeBoundaryY(x));
  }
  ctx.stroke();
  ctx.restore();

  // Fin-tip outlines: where the black tips start.
  ctx.lineWidth = 0.009;
  ctx.save();
  polyPath(ctx, DORSAL1_POLY);
  ctx.clip();
  ctx.beginPath();
  ctx.moveTo(-0.2, DORSAL_TIP_Y);
  ctx.lineTo(0.3, DORSAL_TIP_Y);
  ctx.stroke();
  ctx.restore();
  ctx.save();
  polyPath(ctx, CAUDAL_OUTLINE);
  ctx.clip();
  ctx.beginPath();
  ctx.arc(LOWER_TIP.x, LOWER_TIP.y, LOWER_TIP.r * 0.85, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // Paired fin islands with the pectoral tip line.
  ctx.lineWidth = 0.011;
  const pec = islandPolygon(PECTORAL_ISLAND, PECTORAL_OUTLINE);
  polyPath(ctx, pec);
  ctx.stroke();
  polyPath(ctx, islandPolygon(PELVIC_ISLAND, PELVIC_OUTLINE));
  ctx.stroke();
  ctx.save();
  polyPath(ctx, pec);
  ctx.clip();
  ctx.lineWidth = 0.009;
  const tx = PECTORAL_ISLAND.x - PECTORAL_TIP_AT;
  ctx.beginPath();
  ctx.moveTo(tx, PECTORAL_ISLAND.y - 0.08);
  ctx.lineTo(tx, PECTORAL_ISLAND.y + 0.08);
  ctx.stroke();
  ctx.restore();

  // Gill slits and the smile.
  ctx.lineWidth = 0.009;
  for (let i = 0; i < GILL_X.length; i++) {
    gillPath(ctx, i);
    ctx.stroke();
  }
  smilePath(ctx);
  ctx.stroke();
}

function drawBothFlanks(ctx: Ctx, coloring: boolean) {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const sx = W / TEX_W;
  const sy = H / (TEX_W / 2);
  ctx.save();
  // Left flank: shark (x, y) → canvas (256 - k x, 256 - k y).
  ctx.setTransform(-PX_PER_UNIT * sx, 0, 0, -PX_PER_UNIT * sy, LEFT_ORIGIN_PX[0] * sx, LEFT_ORIGIN_PX[1] * sy);
  drawFlank(ctx, coloring);
  // Right flank: the horizontal mirror of the whole canvas.
  ctx.setTransform(PX_PER_UNIT * sx, 0, 0, -PX_PER_UNIT * sy, (TEX_W - LEFT_ORIGIN_PX[0]) * sx, LEFT_ORIGIN_PX[1] * sy);
  drawFlank(ctx, coloring);
  ctx.restore();
}

export function drawSharkTemplate(ctx: Ctx) {
  drawBothFlanks(ctx, false);
}

/** White colouring-book page: body and fin outlines, gill slits, the belly line and the fin tips. */
export function drawSharkColoringPage(ctx: Ctx) {
  drawBothFlanks(ctx, true);
}
