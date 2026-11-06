import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { AgentProvider } from "./shared/hooks/useAgentAPI";
import "./index.css";

const container = document.getElementById("root");
if (!container) throw new Error("Root element #root not found.");

createRoot(container).render(
  <StrictMode>
    <AgentProvider>
      <App />
    </AgentProvider>
  </StrictMode>,
);
