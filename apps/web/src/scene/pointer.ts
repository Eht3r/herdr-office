/** Pixels the pointer may travel and still count as a click, not a map drag. */
export const CLICK_SLOP_PX = 5;

/** react-three-fiber reports how far the pointer moved between down and up. */
export function wasDrag(event: { delta: number }): boolean {
  return event.delta > CLICK_SLOP_PX;
}
