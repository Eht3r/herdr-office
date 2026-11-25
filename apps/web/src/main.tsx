import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./office.css";

const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);
