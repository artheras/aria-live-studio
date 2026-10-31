import { DashboardPage } from "./dashboard/Dashboard";
import { HistoryPage } from "./history/History";
import { OverlayPage } from "./overlay/Overlay";

export function App({ path = window.location.pathname }: { path?: string }) {
  const p = path.replace(/\/+$/, "") || "/";
  if (p === "/overlay") return <OverlayPage />;
  if (p === "/history") return <HistoryPage />;
  return <DashboardPage />;
}
