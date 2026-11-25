export interface GridPoint {
  x: number;
  z: number;
}

export interface PathGrid {
  width: number;
  depth: number;
  blocked: (point: GridPoint) => boolean;
}

interface Candidate {
  id: number;
  distance: number;
  score: number;
}

const offsets = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
] as const;

class Frontier {
  private readonly queue: Candidate[] = [];

  push(candidate: Candidate): void {
    const queue = this.queue;
    let index = queue.length;
    queue.push(candidate);
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (queue[parent].score <= candidate.score) break;
      queue[index] = queue[parent];
      index = parent;
    }
    queue[index] = candidate;
  }

  pop(): Candidate | undefined {
    const queue = this.queue;
    const first = queue[0];
    const tail = queue.pop();
    if (!tail || !queue.length) return first;
    let index = 0;
    while (index * 2 + 1 < queue.length) {
      const left = index * 2 + 1;
      const right = left + 1;
      const child =
        right < queue.length && queue[right].score < queue[left].score
          ? right
          : left;
      if (queue[child].score >= tail.score) break;
      queue[index] = queue[child];
      index = child;
    }
    queue[index] = tail;
    return first;
  }
}

export function findPath(
  grid: PathGrid,
  start: GridPoint,
  goal: GridPoint,
): GridPoint[] | null {
  const { width, depth } = grid;
  const contains = ({ x, z }: GridPoint) =>
    Number.isInteger(x) &&
    Number.isInteger(z) &&
    x >= 0 &&
    z >= 0 &&
    x < width &&
    z < depth;
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(depth) ||
    !Number.isSafeInteger(width * depth) ||
    !contains(start) ||
    !contains(goal) ||
    grid.blocked(start) ||
    grid.blocked(goal)
  )
    return null;

  const indexOf = ({ x, z }: GridPoint) => z * width + x;
  const pointAt = (id: number): GridPoint => ({
    x: id % width,
    z: Math.floor(id / width),
  });
  const estimate = ({ x, z }: GridPoint) =>
    Math.abs(x - goal.x) + Math.abs(z - goal.z);
  const first = indexOf(start);
  const last = indexOf(goal);
  const lengths = new Map([[first, 0]]);
  const parents = new Map<number, number>();
  const frontier = new Frontier();
  frontier.push({ id: first, distance: 0, score: estimate(start) });

  for (let next = frontier.pop(); next; next = frontier.pop()) {
    const { id, distance } = next;
    if (lengths.get(id) !== distance) continue;
    if (id === last) {
      const result = [goal];
      for (
        let parent = parents.get(id);
        parent !== undefined;
        parent = parents.get(parent)
      ) {
        result.push(pointAt(parent));
      }
      return result.reverse();
    }

    const { x, z } = pointAt(id);
    for (const [dx, dz] of offsets) {
      const neighbor = { x: x + dx, z: z + dz };
      if (!contains(neighbor) || grid.blocked(neighbor)) continue;
      const index = indexOf(neighbor);
      const length = distance + 1;
      if (length >= (lengths.get(index) ?? Infinity)) continue;
      lengths.set(index, length);
      parents.set(index, id);
      frontier.push({
        id: index,
        distance: length,
        score: length + estimate(neighbor),
      });
    }
  }
  return null;
}
