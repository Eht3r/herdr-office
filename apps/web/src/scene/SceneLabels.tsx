import { useFrame } from "@react-three/fiber";
import {
  createContext,
  type ReactNode,
  useContext,
  useId,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
} from "react";
import { type Group, Vector3 } from "three";
import type { Point3 } from "../layout/campusLayout.ts";

interface Label {
  id: string;
  anchor: Group;
  content: ReactNode;
  order: number;
  element?: HTMLDivElement;
}

export class SceneLabelRegistry {
  private readonly labels = new Map<string, Label>();
  private current: Label[] = [];
  private readonly listeners = new Set<() => void>();

  snapshot = () => this.current;

  subscribe = (notify: () => void) => {
    this.listeners.add(notify);
    return () => {
      this.listeners.delete(notify);
    };
  };

  set(label: Label): void {
    label.element = this.labels.get(label.id)?.element;
    this.labels.set(label.id, label);
    this.publish();
  }

  remove(id: string): void {
    if (this.labels.delete(id)) this.publish();
  }

  private publish(): void {
    this.current = [...this.labels.values()];
    for (const notify of this.listeners) notify();
  }
}

export const SceneLabelContext = createContext<SceneLabelRegistry | null>(null);

export function SceneLabel({
  position,
  order,
  children,
}: {
  position: Point3;
  order: number;
  children: ReactNode;
}) {
  const id = useId();
  const registry = useContext(SceneLabelContext);
  const anchor = useRef<Group>(null);

  useLayoutEffect(() => {
    if (anchor.current)
      registry?.set({ id, anchor: anchor.current, content: children, order });
  }, [id, registry, children, order]);
  useLayoutEffect(() => () => registry?.remove(id), [id, registry]);

  return <group ref={anchor} position={position} />;
}

export interface ScreenRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const LABEL_GAP = 4;

export function centeredRect(
  x: number,
  y: number,
  width: number,
  height: number,
): ScreenRect {
  return {
    left: x - width / 2 - LABEL_GAP,
    top: y - height / 2 - LABEL_GAP,
    right: x + width / 2 + LABEL_GAP,
    bottom: y + height / 2 + LABEL_GAP,
  };
}

export function overlaps(a: ScreenRect, b: ScreenRect): boolean {
  return (
    a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
  );
}

export function ProjectLabels({ registry }: { registry: SceneLabelRegistry }) {
  const projected = useRef(new Vector3());
  useFrame(({ camera, size }) => {
    camera.updateMatrixWorld();
    const point = projected.current;
    // Higher order first, so a crowded spot keeps its most important label.
    const labels = [...registry.snapshot()].sort((a, b) => b.order - a.order);
    const placed: ScreenRect[] = [];
    for (const label of labels) {
      const element = label.element;
      if (!element) continue;
      label.anchor.getWorldPosition(point).project(camera);
      const x = ((point.x + 1) * size.width) / 2;
      const y = ((1 - point.y) * size.height) / 2;
      const rect = centeredRect(
        x,
        y,
        element.offsetWidth,
        element.offsetHeight,
      );
      const shown =
        Math.abs(point.x) <= 1.1 &&
        Math.abs(point.y) <= 1.1 &&
        Math.abs(point.z) <= 1 &&
        !placed.some((other) => overlaps(rect, other));
      element.style.visibility = shown ? "visible" : "hidden";
      if (shown) {
        placed.push(rect);
        element.style.transform = `translate3d(${x}px,${y}px,0) translate(-50%,-50%)`;
      }
    }
  });
  return null;
}

export function SceneLabelOverlay({
  registry,
}: {
  registry: SceneLabelRegistry;
}) {
  const labels = useSyncExternalStore(registry.subscribe, registry.snapshot);
  return (
    <div className="scene-labels">
      {labels.map((label) => (
        <div
          className="projected-label"
          key={label.id}
          style={{ zIndex: label.order }}
          ref={(element) => {
            const { id } = label;
            const current = registry
              .snapshot()
              .find((entry) => entry.id === id);
            if (current) current.element = element ?? undefined;
          }}
        >
          {label.content}
        </div>
      ))}
    </div>
  );
}
