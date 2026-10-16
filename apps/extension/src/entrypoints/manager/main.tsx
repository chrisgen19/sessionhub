import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ManagerApp } from "../../features/manager/manager-app";
import "../../styles/app.css";

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <ManagerApp />
    </StrictMode>,
  );
}
