import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HelmetProvider } from "react-helmet-async";
import "@/i18n";
import { App } from "@/App";
import "@/styles/index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      refetchOnWindowFocus: false,
    },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <HelmetProvider>
      <QueryClientProvider client={queryClient}>
        {/*
          The whole app is served under https://ref.gs1.ch/voc/ (see
          staticwebapp.config.json and api/src/functions/resolve.js, which
          both route the human-facing resolver paths — e.g. /voc/rail/geo —
          to this SPA). react-router-dom prepends this basename to every
          <Link>/useNavigate() href it generates and strips it before
          matching the <Route path="..."> definitions in App.tsx, so
          those stay written relative to the app root ("/", "/:domainSlug",
          etc.) and never need to know about the prefix themselves.
        */}
        <BrowserRouter basename="/voc">
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </HelmetProvider>
  </React.StrictMode>
);
