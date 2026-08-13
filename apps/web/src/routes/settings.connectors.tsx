import { createFileRoute } from "@tanstack/react-router";

import { ConnectorSettingsPanel } from "../components/settings/ConnectorSettings";

function SettingsConnectorsRoute() {
  return <ConnectorSettingsPanel />;
}

export const Route = createFileRoute("/settings/connectors")({
  component: SettingsConnectorsRoute,
});
