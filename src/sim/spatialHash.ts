/**
 * Allocation-free uniform-grid spatial hash (counting-sort layout), rebuilt from scratch every
 * frame. Cells map into a fixed power-of-two bucket table, so the world can be unbounded.
 * `query` returns candidate indices from every bucket overlapping the query box; callers do the
 * exact distance test. Hash collisions only add extra candidates, never miss any, and buckets
 * shared by several cells are visited once, so no index is reported twice.
 */
export class SpatialHash {
  readonly cellSize: number;
  readonly flat: boolean;
  private readonly inv: number;
  private readonly mask: number;
  private readonly start: Int32Array;
  private readonly fill: Int32Array;
  private entries: Int32Array;
  private bucketOf: Int32Array;
  private visited = new Int32Array(64);
  count = 0;

  /**
   * @param cellSize  cell edge, ideally ≈ the usual query radius
   * @param flat      ignore y (2D hashing on xz), e.g. for plants on the seabed
   * @param tableBits bucket table size as a power of two
   */
  constructor(cellSize: number, flat = false, capacity = 256, tableBits = 10) {
    this.cellSize = cellSize;
    this.flat = flat;
    this.inv = 1 / cellSize;
    this.mask = (1 << tableBits) - 1;
    this.start = new Int32Array(this.mask + 2);
    this.fill = new Int32Array(this.mask + 1);
    this.entries = new Int32Array(capacity);
    this.bucketOf = new Int32Array(capacity);
  }

  private bucket(ix: number, iy: number, iz: number): number {
    const h = Math.imul(ix, 73856093) ^ Math.imul(iy, 19349663) ^ Math.imul(iz, 83492791);
    return h & this.mask;
  }

  /** Rebuilds from position arrays (first n items). */
  build(xs: ArrayLike<number>, ys: ArrayLike<number>, zs: ArrayLike<number>, n: number) {
    if (n > this.entries.length) {
      let cap = this.entries.length;
      while (cap < n) cap *= 2;
      this.entries = new Int32Array(cap);
      this.bucketOf = new Int32Array(cap);
    }
    const { start, fill, inv, bucketOf } = this;
    start.fill(0);
    for (let i = 0; i < n; i++) {
      const b = this.bucket(Math.floor(xs[i] * inv), this.flat ? 0 : Math.floor(ys[i] * inv), Math.floor(zs[i] * inv));
      bucketOf[i] = b;
      start[b + 1]++;
    }
    for (let b = 1; b < start.length; b++) start[b] += start[b - 1];
    fill.set(start.subarray(0, fill.length));
    for (let i = 0; i < n; i++) this.entries[fill[bucketOf[i]]++] = i;
    this.count = n;
  }

  /** Writes candidate indices near (x, y, z) within r into `out`; returns how many were written. */
  query(x: number, y: number, z: number, r: number, out: Int32Array): number {
    const inv = this.inv;
    const x0 = Math.floor((x - r) * inv), x1 = Math.floor((x + r) * inv);
    const z0 = Math.floor((z - r) * inv), z1 = Math.floor((z + r) * inv);
    const y0 = this.flat ? 0 : Math.floor((y - r) * inv);
    const y1 = this.flat ? 0 : Math.floor((y + r) * inv);
    const cells = (x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1);
    if (cells > this.visited.length) this.visited = new Int32Array(cells * 2);
    const visited = this.visited;
    let nVisited = 0;
    let n = 0;
    for (let ix = x0; ix <= x1; ix++) {
      for (let iy = y0; iy <= y1; iy++) {
        for (let iz = z0; iz <= z1; iz++) {
          const b = this.bucket(ix, iy, iz);
          let seen = false;
          for (let k = 0; k < nVisited; k++) {
            if (visited[k] === b) {
              seen = true;
              break;
            }
          }
          if (seen) continue;
          visited[nVisited++] = b;
          const end = this.start[b + 1];
          for (let e = this.start[b]; e < end; e++) {
            if (n >= out.length) return n;
            out[n++] = this.entries[e];
          }
        }
      }
    }
    return n;
  }
}
