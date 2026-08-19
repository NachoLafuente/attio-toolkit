/**
 * Deterministic force-directed layout, computed here rather than in the browser.
 *
 * Running the simulation at generation time buys three things: the output SVG
 * needs no JavaScript to draw itself, the same schema always produces the same
 * picture (so a diagram in a proposal does not reshuffle when you regenerate
 * it), and a diff of two schemas can be laid out identically for comparison.
 *
 * Spring-electric model: edges pull, every pair of nodes pushes, boxes are then
 * separated so cards never overlap. No dependencies, seeded RNG.
 */

const CARD_WIDTH = 210;
const HEADER_HEIGHT = 34;
const ROW_HEIGHT = 19;
const CARD_PADDING = 10;
const GUTTER = 34;

/**
 * @param {object} graph  Output of buildGraph().
 * @param {object} [opts]
 * @param {number} [opts.maxRows]     Attribute rows rendered per card.
 * @param {number} [opts.iterations]  Simulation steps.
 * @param {number} [opts.seed]
 */
export function layoutGraph(graph, opts = {}) {
  const { maxRows = 8, iterations = 420, seed = 1 } = opts;

  const nodes = graph.nodes.map((n) => {
    const rows = visibleRows(n, maxRows);
    return {
      ...n,
      rows,
      width: CARD_WIDTH,
      height:
        HEADER_HEIGHT +
        (rows.length ? rows.length * ROW_HEIGHT + CARD_PADDING : CARD_PADDING),
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
    };
  });

  if (nodes.length === 0) {
    return { nodes, edges: [], width: 0, height: 0 };
  }

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges = graph.edges
    .map((e) => ({ ...e, source: byId.get(e.from), target: byId.get(e.to) }))
    .filter((e) => e.source && e.target);

  // Lay out each connected group on its own, then pack the groups together.
  // Running one simulation over everything lets repulsion fling unconnected
  // objects into the corners, which is what produces a diagram that is mostly
  // empty space.
  const groups = components(nodes, edges);
  for (const group of groups) {
    const groupEdges = edges.filter(
      (e) => group.includes(e.source) && group.includes(e.target),
    );
    seedPositions(group, seed);
    simulate(group, groupEdges, iterations);
    separate(group);
    group.box = extent(group);
  }

  packComponents(groups);

  const bounds = normalise(nodes);

  return {
    nodes,
    edges: edges.map((e) => ({ ...e, path: edgeGeometry(e.source, e.target) })),
    ...bounds,
    metrics: { CARD_WIDTH, HEADER_HEIGHT, ROW_HEIGHT, CARD_PADDING },
  };
}

/**
 * Custom fields are the signal. System attributes are identical on every
 * workspace and would fill the card with noise, so they are counted but not
 * listed.
 */
function visibleRows(node, maxRows) {
  if (node.kind !== "object" || !node.attributes) return [];
  const custom = node.attributes.filter((a) => !a.isSystem);
  const rows = custom.slice(0, maxRows).map((a) => ({
    slug: a.slug,
    type: a.type,
    isRequired: a.isRequired,
    isUnique: a.isUnique,
    isMultiselect: a.isMultiselect,
  }));
  const hidden = custom.length - rows.length;
  if (hidden > 0) rows.push({ slug: `+${hidden} more`, type: null, more: true });
  return rows;
}

/** Deterministic PRNG (mulberry32) so layouts are reproducible. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Start on a circle rather than at random, which converges faster and flatter. */
function seedPositions(nodes, seed) {
  const rand = rng(seed);
  const radius = 120 + nodes.length * 26;
  nodes.forEach((n, i) => {
    const angle = (i / nodes.length) * Math.PI * 2 + rand() * 0.12;
    n.x = Math.cos(angle) * radius;
    n.y = Math.sin(angle) * radius;
  });
}

function simulate(nodes, edges, iterations) {
  const k = 260; // preferred edge length
  const repulsion = 190000;

  for (let step = 0; step < iterations; step++) {
    const cooling = 1 - step / iterations;

    for (const n of nodes) {
      n.vx = 0;
      n.vy = 0;
    }

    // Repulsion between every pair.
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) {
          // Coincident nodes: nudge apart deterministically.
          dx = (i - j) || 1;
          dy = 1;
          d2 = 2;
        }
        const force = repulsion / d2;
        const d = Math.sqrt(d2);
        const fx = (dx / d) * force;
        const fy = (dy / d) * force;
        a.vx += fx;
        a.vy += fy;
        b.vx -= fx;
        b.vy -= fy;
      }
    }

    // Attraction along edges.
    for (const e of edges) {
      const dx = e.target.x - e.source.x;
      const dy = e.target.y - e.source.y;
      const d = Math.hypot(dx, dy) || 1;
      const force = (d - k) * 0.06;
      const fx = (dx / d) * force;
      const fy = (dy / d) * force;
      e.source.vx += fx;
      e.source.vy += fy;
      e.target.vx -= fx;
      e.target.vy -= fy;
    }

    // Weak pull to the origin keeps disconnected nodes from drifting away.
    for (const n of nodes) {
      n.vx -= n.x * 0.006;
      n.vy -= n.y * 0.006;
    }

    const maxStep = 24 * cooling + 1;
    for (const n of nodes) {
      const speed = Math.hypot(n.vx, n.vy) || 1;
      const scale = Math.min(speed, maxStep) / speed;
      n.x += n.vx * scale;
      n.y += n.vy * scale;
    }
  }
}

/** Push overlapping cards apart. The simulation treats nodes as points. */
function separate(nodes, passes = 60) {
  for (let p = 0; p < passes; p++) {
    let moved = false;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        const minX = (a.width + b.width) / 2 + GUTTER;
        const minY = (a.height + b.height) / 2 + GUTTER;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const overlapX = minX - Math.abs(dx);
        const overlapY = minY - Math.abs(dy);
        if (overlapX <= 0 || overlapY <= 0) continue;

        moved = true;
        // Resolve along the axis needing the smaller correction.
        if (overlapX < overlapY) {
          const shift = (overlapX / 2) * (dx < 0 ? -1 : 1);
          a.x -= shift;
          b.x += shift;
        } else {
          const shift = (overlapY / 2) * (dy < 0 ? -1 : 1);
          a.y -= shift;
          b.y += shift;
        }
      }
    }
    if (!moved) break;
  }
}

/** Connected groups of nodes, largest first. */
function components(nodes, edges) {
  const adjacency = new Map(nodes.map((n) => [n, []]));
  for (const e of edges) {
    adjacency.get(e.source)?.push(e.target);
    adjacency.get(e.target)?.push(e.source);
  }

  const seen = new Set();
  const groups = [];

  for (const start of nodes) {
    if (seen.has(start)) continue;
    const group = [];
    const queue = [start];
    seen.add(start);
    while (queue.length) {
      const n = queue.pop();
      group.push(n);
      for (const next of adjacency.get(n) || []) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    groups.push(group);
  }

  // Biggest cluster first so it anchors the top-left of the drawing.
  return groups.sort((a, b) => b.length - a.length);
}

function extent(nodes) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x - n.width / 2);
    minY = Math.min(minY, n.y - n.height / 2);
    maxX = Math.max(maxX, n.x + n.width / 2);
    maxY = Math.max(maxY, n.y + n.height / 2);
  }
  return { minX, minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Shelf-pack the component boxes into rows, targeting a landscape aspect ratio
 * so the result fits a screen rather than running off the bottom of one.
 */
function packComponents(groups, aspect = 1.6) {
  if (groups.length <= 1) return;

  const totalArea = groups.reduce((sum, g) => sum + g.box.width * g.box.height, 0);
  const widest = Math.max(...groups.map((g) => g.box.width));
  const targetWidth = Math.max(Math.sqrt(totalArea * aspect), widest);

  let shelfX = 0;
  let shelfY = 0;
  let shelfHeight = 0;

  for (const group of groups) {
    const { box } = group;
    if (shelfX > 0 && shelfX + box.width > targetWidth) {
      shelfX = 0;
      shelfY += shelfHeight + GUTTER * 2;
      shelfHeight = 0;
    }

    const dx = shelfX - box.minX;
    const dy = shelfY - box.minY;
    for (const n of group) {
      n.x += dx;
      n.y += dy;
    }

    shelfX += box.width + GUTTER * 2;
    shelfHeight = Math.max(shelfHeight, box.height);
  }
}

/** Translate so the drawing starts at a small margin, and report the extent. */
function normalise(nodes, margin = 40) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const n of nodes) {
    minX = Math.min(minX, n.x - n.width / 2);
    minY = Math.min(minY, n.y - n.height / 2);
    maxX = Math.max(maxX, n.x + n.width / 2);
    maxY = Math.max(maxY, n.y + n.height / 2);
  }

  for (const n of nodes) {
    n.x = Math.round(n.x - minX + margin);
    n.y = Math.round(n.y - minY + margin);
  }

  return {
    width: Math.round(maxX - minX + margin * 2),
    height: Math.round(maxY - minY + margin * 2),
  };
}

/**
 * Anchor an edge on the card borders rather than the centres, so lines stop at
 * the box edge and the crow's foot markers sit where they belong.
 */
function edgeGeometry(a, b) {
  const start = borderPoint(a, b.x, b.y);
  const end = borderPoint(b, a.x, a.y);

  // Curve sideways so parallel edges between the same pair stay distinguishable.
  const mx = (start.x + end.x) / 2;
  const my = (start.y + end.y) / 2;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.hypot(dx, dy) || 1;
  const bend = Math.min(len * 0.12, 34);
  const cx = mx + (-dy / len) * bend;
  const cy = my + (dx / len) * bend;

  return {
    start,
    end,
    control: { x: Math.round(cx), y: Math.round(cy) },
    d: `M ${start.x} ${start.y} Q ${Math.round(cx)} ${Math.round(cy)} ${end.x} ${end.y}`,
  };
}

/** Where the line from a card's centre toward (tx, ty) crosses its border. */
function borderPoint(node, tx, ty) {
  const dx = tx - node.x;
  const dy = ty - node.y;
  const hw = node.width / 2;
  const hh = node.height / 2;

  if (dx === 0 && dy === 0) return { x: Math.round(node.x), y: Math.round(node.y) };

  const scale = Math.min(
    dx === 0 ? Infinity : hw / Math.abs(dx),
    dy === 0 ? Infinity : hh / Math.abs(dy),
  );

  return {
    x: Math.round(node.x + dx * scale),
    y: Math.round(node.y + dy * scale),
  };
}
