import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { BrandPreview } from "./ui/brand/BrandPreview";
import "./index.css";

const isBrandPreview = window.location.hash === "#brand";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {isBrandPreview ? <BrandPreview /> : <App />}
  </React.StrictMode>
);
