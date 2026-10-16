import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PopupApp } from "../../features/popup/popup-app";
import "../../styles/app.css";

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <PopupApp />
    </StrictMode>,
  );
}
