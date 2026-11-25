import { createContext } from "react";

export const SceneNight = createContext(false);
export const ActiveDesks = createContext<ReadonlySet<string> | null>(null);
