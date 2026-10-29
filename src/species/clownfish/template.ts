import {
  ANAL_EDGE,
  DORSAL_EDGE,
  LEFT_ORIGIN_PX,
  NOSE_X,
  PECTORAL_ISLAND,
  PECTORAL_OUTLINE,
  PELVIC_ISLAND,
  PELVIC_OUTLINE,
  PEDUNCLE_X,
  PX_PER_UNIT,
  TEX_W,
  bodyBot,
  bodyTop,
  caudalPoint,
  islandPoint,
} from './layout';

/**
 * Natural A. ocellaris colouring: vivid orange, three white bars edged in thin black (head bar
 * behind the eye, middle bar with a forward wedge running up into the dorsal notch, tail bar on
 * the peduncle) and black-margined fins. Drawn in fish space for the left flank, then the same
 * drawing is replayed horizontally flipped for the right flank, which is exactly the bilateral
 * (1 - u) mirror. Units below are fish units (1 = body length).
 */

const ORANGE_TOP = '#f2600c';
const ORANGE_MID = '#ff7a16';
const ORANGE_BELLY = '#ff9a3c';
const WHITE = '#fbfbf6';
const BLACK = '#121212';

type Ctx = CanvasRenderingContext2D;

function bodyPath(ctx: Ctx, grow = 1.03) {
  const steps = 28;
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const x = NOSE_X - (i / steps) * (NOSE_X - PEDUNCLE_X);
    const mid = (bodyTop(x) + bodyBot(x)) / 2;
    const y = mid + (bodyTop(x) - mid) * grow;
    if (i === 0) ctx.moveTo(x + 0.01, y);
    else ctx.lineTo(x, y);
  }
  // Run a bit into the caudal root so the tail bar meets the fin cleanly.
  ctx.lineTo(PEDUNCLE_X - 0.015, bodyTop(PEDUNCLE_X) * grow);
  ctx.lineTo(PEDUNCLE_X - 0.015, bodyBot(PEDUNCLE_X) * grow);
  for (let i = steps; i >= 0; i--) {
    const x = NOSE_X - (i / steps) * (NOSE_X - PEDUNCLE_X);
    const mid = (bodyTop(x) + bodyBot(x)) / 2;
    ctx.lineTo(i === 0 ? x + 0.01 : x, mid + (bodyBot(x) - mid) * grow);
  }
  ctx.closePath();
}

function medianFinPath(ctx: Ctx, edge: [number, number][], dir: 1 | -1) {
  ctx.beginPath();
  edge.forEach(([x, h], i) => {
    const y = dir > 0 ? bodyTop(x) + h : bodyBot(x) - h;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
}

function caudalEdgePath(ctx: Ctx) {
  const pt: [number, number] = [0, 0];
  ctx.beginPath();
  // Top edge root → corner, trailing edge, bottom edge corner → root.
  const cols = 10;
  for (let i = 0; i <= cols; i++) {
    caudalPoint(i / cols, 1, pt);
    if (i === 0) ctx.moveTo(pt[0], pt[1]);
    else ctx.lineTo(pt[0], pt[1]);
  }
  for (let r = 1; r <= 16; r++) {
    caudalPoint(1, 1 - (r / 16) * 2, pt);
    ctx.lineTo(pt[0], pt[1]);
  }
  for (let i = cols - 1; i >= 0; i--) {
    caudalPoint(i / cols, -1, pt);
    ctx.lineTo(pt[0], pt[1]);
  }
}

function islandPath(ctx: Ctx, island: { x: number; y: number }, outline: [number, number][]) {
  ctx.beginPath();
  const [hx, hy] = islandPoint(island, 0, 0);
  ctx.moveTo(hx, hy);
  for (const [l, w] of outline) {
    const [x, y] = islandPoint(island, l, w);
    ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function band(ctx: Ctx, front: [number, number][], back: [number, number][]) {
  // front/back: [top, middle..., bottom], smoothed with quadratic curves through the midpoints.
  const pts = [...front, ...back.slice().reverse()];
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < front.length - 1; i++) {
    const [cx, cy] = front[i];
    const [nx, ny] = front[i + 1];
    const end = i === front.length - 2 ? [nx, ny] : [(cx + nx) / 2, (cy + ny) / 2];
    ctx.quadraticCurveTo(cx, cy, end[0], end[1]);
  }
  const rev = back.slice().reverse();
  ctx.lineTo(rev[0][0], rev[0][1]);
  for (let i = 1; i < rev.length - 1; i++) {
    const [cx, cy] = rev[i];
    const [nx, ny] = rev[i + 1];
    const end = i === rev.length - 2 ? [nx, ny] : [(cx + nx) / 2, (cy + ny) / 2];
    ctx.quadraticCurveTo(cx, cy, end[0], end[1]);
  }
  ctx.closePath();
  ctx.fillStyle = WHITE;
  ctx.fill();
  ctx.strokeStyle = BLACK;
  ctx.lineWidth = 0.018;
  ctx.stroke();
}

function drawFlank(ctx: Ctx) {
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // Base colour: darker orange on the back, lighter belly. Covers all fins and islands too.
  const g = ctx.createLinearGradient(0, 0.2, 0, -0.2);
  g.addColorStop(0, ORANGE_TOP);
  g.addColorStop(0.5, ORANGE_MID);
  g.addColorStop(1, ORANGE_BELLY);
  ctx.fillStyle = g;
  ctx.fillRect(-0.6, -0.6, 1.2, 1.2);

  // Head bar: a crescent right behind the eye, over the gill cover, nape to throat.
  ctx.save();
  bodyPath(ctx);
  ctx.clip();
  band(
    ctx,
    [[0.312, 0.21], [0.35, 0.05], [0.348, -0.06], [0.322, -0.18]],
    [[0.236, 0.21], [0.276, 0.04], [0.278, -0.07], [0.258, -0.18]],
  );
  // Tail bar across the caudal peduncle.
  band(
    ctx,
    [[-0.182, 0.2], [-0.196, 0.0], [-0.182, -0.2]],
    [[-0.246, 0.2], [-0.258, 0.0], [-0.246, -0.2]],
  );
  ctx.restore();

  // Middle bar with its forward-pointing wedge; continues up into the dorsal fin notch.
  ctx.save();
  ctx.beginPath();
  bodyPathInto(ctx);
  dorsalPathInto(ctx);
  ctx.clip();
  band(
    ctx,
    [[0.088, 0.32], [0.095, 0.08], [0.172, -0.005], [0.1, -0.08], [0.082, -0.2]],
    [[-0.002, 0.32], [0.022, 0.07], [0.03, -0.02], [0.016, -0.09], [0.0, -0.2]],
  );
  ctx.restore();

  // Black fin margins: stroke only the free edges; half the stroke lands inside the fin.
  ctx.strokeStyle = BLACK;
  ctx.lineWidth = 0.028;
  medianFinPath(ctx, DORSAL_EDGE, 1);
  ctx.stroke();
  medianFinPath(ctx, ANAL_EDGE, -1);
  ctx.stroke();
  ctx.lineWidth = 0.032;
  caudalEdgePath(ctx);
  ctx.stroke();

  // Paired fin islands: orange pectoral with a thin dark rim, black-edged pelvic.
  ctx.fillStyle = ORANGE_MID;
  islandPath(ctx, PECTORAL_ISLAND, PECTORAL_OUTLINE);
  ctx.fill();
  ctx.lineWidth = 0.016;
  ctx.stroke();
  islandPath(ctx, PELVIC_ISLAND, PELVIC_OUTLINE);
  ctx.fill();
  ctx.lineWidth = 0.03;
  ctx.stroke();
}

/** Body outline added to the current path (no beginPath), for union clips. */
function bodyPathInto(ctx: Ctx) {
  const steps = 28;
  const grow = 1.03;
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

/** Dorsal fin area added to the current path, same (counter-clockwise) winding as the body. */
function dorsalPathInto(ctx: Ctx) {
  DORSAL_EDGE.forEach(([x, h], i) => {
    if (i === 0) ctx.moveTo(x, bodyTop(x) + h + 0.01);
    else ctx.lineTo(x, bodyTop(x) + h + 0.01);
  });
  for (let i = DORSAL_EDGE.length - 1; i >= 0; i--) {
    const x = DORSAL_EDGE[i][0];
    ctx.lineTo(x, bodyTop(x) - 0.03);
  }
  ctx.closePath();
}

export function drawClownfishTemplate(ctx: Ctx) {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const sx = W / TEX_W;
  const sy = H / (TEX_W / 2);
  ctx.save();
  // Left flank: fish (x, y) → canvas (256 - k x, 256 - k y).
  ctx.setTransform(-PX_PER_UNIT * sx, 0, 0, -PX_PER_UNIT * sy, LEFT_ORIGIN_PX[0] * sx, LEFT_ORIGIN_PX[1] * sy);
  drawFlank(ctx);
  // Right flank: the horizontal mirror of the whole canvas.
  ctx.setTransform(PX_PER_UNIT * sx, 0, 0, -PX_PER_UNIT * sy, (TEX_W - LEFT_ORIGIN_PX[0]) * sx, LEFT_ORIGIN_PX[1] * sy);
  drawFlank(ctx);
  ctx.restore();
}
