import { createFileRoute } from "@tanstack/react-router";

import { SettledThreadsPanel } from "../components/settings/SettingsPanels";

export const Route = createFileRoute("/settings/settled")({
  component: SettledThreadsPanel,
});
