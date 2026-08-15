# Spike 2 notes: SSE through the Vite dev proxy — works, no special config

Date: 2026-08-15 · `hono@4.13.2` + `@hono/node-server@2.1.1` (now root runtime deps per
DEP-001) proxied by `vite@8.2.1`. Verified programmatically by `verify.ts` (exit 0): it boots
the Hono SSE server and a real Vite dev server in-process, then reads
`http://127.0.0.1:4994/api/events` through the proxy with streaming fetch.

## Required proxy config

Nothing beyond the ordinary `/api` proxy entry. No SSE-specific flags exist or are needed —
Vite's http-proxy streams responses by default and does not buffer `text/event-stream`.

```ts
// vite.config.ts (dev server)
server: {
	proxy: {
		'/api': {
			target: 'http://127.0.0.1:4973', // spike used 4993
		},
	},
},
```

`changeOrigin` is unnecessary for localhost→localhost, `ws` is irrelevant (SSE is plain HTTP),
and no header rewriting is required: the proxy forwards `Last-Event-ID` upstream untouched.

## Measurements

- **Unbuffered streaming**: server emitted every 500ms; through the proxy the client observed
  inter-event gaps of **497ms / 500ms / 499ms** — events arrive as sent, not batched.
- **Last-Event-ID replay**: client disconnected after event id 4, stayed away ~1.75s (3 events
  emitted into the ring buffer meanwhile), reconnected with `Last-Event-ID: 4`, and received
  ids **5, 6, 7 within 3ms** of connecting — replayed from the buffer, then live events resumed
  at their natural cadence.

## Server-side pattern that worked (for TASK-040's sseHub)

- `streamSSE` from `hono/streaming`; monotonic numeric ids on every event.
- Ring buffer appended on emit regardless of subscriber count; on connect, if the request
  carries `Last-Event-ID`, write every buffered event with a greater id before subscribing the
  connection to live events.
- Keep the handler's promise pending until `stream.onAbort` fires; unsubscribe there.

## Caveats

- Verified with node's streaming `fetch` (which is what carries `Last-Event-ID` explicitly),
  not a browser `EventSource`. At the HTTP level `EventSource` does exactly this — sends
  `Last-Event-ID` on automatic reconnect — but the browser path is only exercised for real in
  Phase 6/7 (sseHub + client eventSource). No reason to expect a difference through the same
  proxy; flagged for honesty.
- `vite preview` (not used by our dev loop) adds compression that is known to buffer SSE; the
  dev-server proxy path verified here is the only path the plan uses.
