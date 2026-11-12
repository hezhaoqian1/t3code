import { createFileRoute } from "@tanstack/react-router";

// The view lives in the `_chat` layout (see ThreadRouteView) so a draft's
// promotion to `/$threadId` keeps the same ChatView mounted.
export const Route = createFileRoute("/_chat/$threadId")({
  component: () => null,
});
