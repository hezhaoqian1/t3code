import { createFileRoute } from "@tanstack/react-router";

import { ConnectorsPage } from "../components/connectors/ConnectorPage";

export const Route = createFileRoute("/connectors")({
  component: ConnectorsPage,
});
