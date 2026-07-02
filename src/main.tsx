import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { BrandPreview } from "./ui/brand/BrandPreview";
import { DashboardDemo } from "./ui/pages/DashboardPage.demo";
import "./index.css";

const hash = window.location.hash;

function Root() {
  if (hash === "#brand") return <BrandPreview />;
  if (hash === "#dashboard") return <DashboardDemo />;
  return <App />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
