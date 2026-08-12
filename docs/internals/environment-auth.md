# Environment Authentication

The server is bound to `127.0.0.1`, but every environment API and WebSocket RPC still requires
authentication. Loopback is a network boundary, not an authorization substitute.

## Bootstrap

Desktop starts the server with a one-time bootstrap envelope containing the Desktop bootstrap
credential. The renderer can exchange that credential for either:

- a port-scoped, HTTP-only browser session cookie; or
- a bearer or DPoP access token.

Issued sessions are limited to the local runtime scopes:

- `orchestration:read`
- `orchestration:operate`
- `terminal:operate`
- `review:write`

Pairing links, authorized-client inventory, relay scopes, and access-management grants are not
mounted by the local server.

## HTTP

The mounted auth group contains only:

- `GET /api/auth/session`
- `POST /api/auth/browser-session`
- `POST /oauth/token`
- `POST /api/auth/websocket-ticket`

Credential responses use `Cache-Control: no-store`. Browser cookies are scoped to the active
loopback server port so concurrent development servers do not overwrite each other's sessions.

## WebSocket

The renderer requests a short-lived WebSocket ticket from its authenticated HTTP session and sends
that ticket when upgrading `/ws`. RPC authorization then checks the required local scope for every
method in `LocalWsRpcGroup`.

## Origins

CORS never uses a wildcard. The server allows the Electron custom origins and, in development, the
single configured Vite origin after verifying that its hostname is loopback. Wildcard, LAN, and
non-loopback IPv6 origins receive no CORS grant.
