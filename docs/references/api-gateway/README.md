---
description: API gateway purpose, start and stop controls, automatic startup, and HTTP protocol reference
sources:
  - src/main/features/apiGateway
  - src/main/ai/runtime/agentApiGateway.ts
  - src/main/services/PdfTranslationService.ts
  - src/renderer/hooks/useApiGateway.ts
  - src/renderer/pages/settings/ToolSettings/ApiGatewaySettings
---

# API Gateway Reference

The **API Gateway** exposes Cherry Studio's AI capabilities over a local HTTP
server that speaks the **OpenAI**, **Anthropic**, and **Gemini** wire protocols,
plus Cherry REST and Streamable HTTP MCP endpoints. Compatible clients can point at
`http://127.0.0.1:23333` and drive whatever provider/model the desktop app has
configured — Cherry becomes a universal translation gateway in front of every
provider it knows.

Generation requests route through main's `AiStreamManager` as equal,
**non-persisting** subscribers (alongside the renderer's `WebContentsListener`
and the IM `ChannelAdapterListener`), and the resulting `UIMessageChunk` stream
is translated back into the caller's dialect by the adapter system. Models,
knowledge, and MCP routes call their owning services directly.

> **Naming.** React components and the lifecycle service use `apiGateway`;
> IpcApi routes use `api_gateway.*`; Preference and Shared Cache keys use
> `feature.api_gateway.*`. The retired `csaas` alias is not part of the current
> surface.

## Decide whether you need the gateway

The gateway lets other programs use the providers, models, knowledge bases, and
MCP servers configured in Cherry Studio. It also bridges models for some Agent
runtimes and PDF translation. Ordinary chats in Cherry Studio do not require you
to enable it. It is disabled by default.

| Use case | When the gateway is needed |
|---|---|
| Another local app uses Cherry Studio's models | Start it and give the app the gateway URL and API key. The gateway translates supported API protocols for the configured provider. |
| An Agent needs a model bridge | Cherry Studio shows **Enable the API Gateway?** when the selected runtime/model route requires it. Choose **Enable** to use that route, or leave it disabled and choose a route that can connect directly. |
| PDF translation | Cherry Studio starts the gateway temporarily for the translation task and releases it afterward. You do not need to enable it manually. |

### Start the gateway for a client

1. Configure a working provider and model in **Settings → Model Provider** for
   model requests. Keep Cherry Studio running while the client uses the gateway.
2. Open **Settings → API Gateway**. While stopped, choose an available port
   between `1000` and `65535` if the default `23333` is already in use.
3. Click **Start** and wait for **Running**. Cherry Studio generates a gateway
   API key on first activation.
4. Copy the server URL and API key from this page into the client. For an
   OpenAI-compatible client, the default base URL is `http://127.0.0.1:23333/v1`;
   use the displayed port if you changed it. This is the gateway's key, separate
   from the upstream provider's credentials.
5. Select a model from the gateway's model list. Its ID includes the provider,
   such as `anthropic:claude-sonnet-4-6`; see the [HTTP surface](#http-surface) for
   each protocol's endpoints and authentication.

### Stop the gateway and automatic startup

Open **Settings → API Gateway** and click **Stop**. This clears the saved
startup setting.
Gateway-dependent clients and Agent routes need the gateway again before they can
be used. Ordinary chats can continue without it.

An active PDF translation can keep the local gateway running after **Stop**;
the notification explains that shutdown is deferred. Let the translation finish
or cancel it. Once the last task releases the gateway, it stops unless you have
chosen **Start** or **Enable** again. **Restart** is unavailable during these
temporary tasks.

### Understand why it starts automatically

- Clicking **Start**, or accepting an Agent's **Enable the API Gateway?** prompt,
  saves the enabled setting. The gateway then starts on future Cherry Studio
  launches until you click **Stop**.
- PDF translation uses the gateway temporarily without changing that saved
  setting. If it was disabled, it stops again after the last translation task;
  if you had enabled it, it stays running.
- Upgrading from v1 preserves a previously enabled API Server setting. Check
  **Settings → API Gateway** and click **Stop** if you no longer use it.

## Where the code lives

```
src/main/features/apiGateway/        ← the HTTP server (Elysia + @elysia/node)
├── server.ts                        ← `ApiGateway` class: listen / stop, http timeouts
├── app.ts                           ← `buildApp()`: CORS, OpenAPI docs, request-id, error handler, route mounting
├── openapiDocs.ts                   ← localized OpenAPI generation and Scalar page
├── errors.ts                        ← `gatewayErrorHandler` (path → anthropic/openai/google/rest envelopes),
│                                       `buildStreamErrorFrame` (streaming error/timeout frames), `transformOpenAiError`
├── ApiGatewayService.ts             ← lifecycle owner, preference intent, internal listener, running-state reconciler
├── McpSessionStore.ts               ← bounded live Streamable HTTP MCP sessions
├── ModernMcpProxy.ts                ← MCP 2026-07-28 discovery, MRTR and subscriptions
├── proxyStream.ts                   ← `processMessage()` — the core request → stream → response engine
├── reasoningCache.ts                ← google / openrouter reasoning-signature caches
├── openrouter.ts                    ← OpenRouter `reasoning_details` type contract (used by reasoningCache)
├── middleware/
│   └── auth.ts                      ← desktop API-key auth
├── routes/
│   ├── messages.ts                  ← POST /v1/messages, POST /v1/messages/count_tokens (Anthropic)
│   ├── chat.ts                      ← POST /v1/chat/completions (OpenAI Chat)
│   ├── responses.ts                 ← POST /v1/responses (OpenAI Responses)
│   ├── gemini.ts                    ← POST /v1beta/models/{model}:{method}
│   ├── models.ts                    ← GET  /v1/models
│   ├── knowledge.ts                 ← GET/POST /v1/knowledge-bases[/search|/:id]
│   ├── mcp.ts                       ← MCP catalog + Streamable HTTP proxy
│   └── schemas.ts                   ← loose Zod body schemas (validate only what the gateway needs)
├── tokens/                          ← Anthropic/Gemini token estimation and wire-tool projections
├── utils/
│   └── models.ts                    ← `getModels()` — the /v1/models data path (never throws)
└── adapters/
    ├── interfaces.ts                ← `IMessageConverter` / `IStreamAdapter` / `ISseFormatter` contracts
    ├── converters/                  ← input dialect → AI SDK `UIMessage[]` + tools + options
    ├── stream/                      ← `UIMessageChunk` → output dialect events (push API)
    ├── formatters/                  ← output event → SSE wire string
    └── factory/                     ← `MessageConverterFactory`, `StreamAdapterFactory`

src/shared/ipc/schemas/apiGateway.ts      ← lifecycle commands
src/main/ipc/handlers/apiGateway.ts       ← thin lifecycle-service adapters
src/renderer/hooks/useApiGateway.ts       ← renderer state (config + running + loading) and actions
src/renderer/pages/settings/ToolSettings/ApiGatewaySettings/   ← API client settings UI
```

## HTTP surface

`buildApp()` (`app.ts`) assembles one Elysia app on the `@elysia/node` adapter.
CORS is open (`origin: true`); every request is stamped with an `X-Request-ID`
and its latency logged on completion.

### Public (no auth)

| Method & path | Purpose |
|---|---|
| `GET /` | API information (name, version, endpoint map) |
| `GET /health` | Health check (`{ status, timestamp, version }`) |
| `GET /openapi` | Scalar API docs UI (front-end assets load from a CDN — see note) |
| `GET /openapi/json` | OpenAPI JSON spec (fully local) |

> **Offline note.** `renderDocsPage` points Scalar at a pinned jsDelivr bundle,
> so `GET /openapi` (the human docs UI) needs network. `GET /openapi/json` — the
> machine-readable spec that programmatic clients/SDKs consume — is always
> served locally and is unaffected.

### Protected API routes

Mounted under a single `Elysia({ prefix: '/v1' })` that `.use(bearer())` and
applies a **`scoped`** auth guard — so the guard covers every `/v1` plugin but
none of the public routes above. Gemini's `/v1beta` group has its own local
guard, described below.

| Method & path | Dialect | In → out format |
|---|---|---|
| `POST /v1/messages` | Anthropic | `anthropic` → `anthropic` |
| `POST /v1/messages/count_tokens` | Anthropic | token estimate over the converted request; anthropic-dialect endpoints forward it to the provider's own `count_tokens` (via the app proxy/auth), other dialects stay local; no stream |
| `POST /v1/chat/completions` | OpenAI Chat | `openai` → `openai` |
| `POST /v1/responses` | OpenAI Responses | `openai-responses` → `openai-responses` |
| `POST /v1beta/models/{provider:model}:generateContent` | Gemini | `gemini` → Gemini JSON |
| `POST /v1beta/models/{provider:model}:streamGenerateContent?alt=sse` | Gemini | `gemini` → Gemini SSE |
| `POST /v1beta/models/{provider:model}:countTokens` | Gemini | local converted-request estimate |
| `GET /v1/models` | OpenAI list | `{ object:'list', data:[…] }`, ids are `providerId:modelId` (offset/limit) |
| `GET /v1/knowledge-bases` | Cherry REST | list (offset/limit) |
| `POST /v1/knowledge-bases/search` | Cherry REST | semantic search across bases |
| `GET /v1/knowledge-bases/:id` | Cherry REST | single base |
| `GET /v1/mcps` | Cherry REST | active MCP server catalog with gateway URLs |
| `GET /v1/mcps/:id` | Cherry REST | one active server plus its warmed tool catalog |
| `POST /v1/mcps/:id/mcp` | MCP Streamable HTTP | modern discovery/requests/subscriptions or legacy initialize/session requests |

The model in every chat/messages/responses body is `"<providerId>:<modelId>"`
(split on the **first** `:`), e.g. `anthropic:claude-sonnet-4-6`.

Gemini routes carry a separate local auth guard because Gemini clients use
`x-goog-api-key` or `?key=`. The `/v1` scoped guard must not intercept `/v1beta`.

The MCP proxy validates browser `Origin` as loopback-only to prevent DNS
rebinding. Native clients normally send no `Origin`. Live sessions are bounded
and owned by `McpSessionStore`; GET carries server push and DELETE terminates a
legacy session. Modern clients use the same URL with MCP 2026-07-28 discovery
and subscriptions; the SDK classifies the request before it enters either
transport. Both paths retain API-key and Origin checks, request cancellation,
progress, disabled-tool filtering, and tool-list change notifications.

For modern upstream servers, the modern proxy forwards `input_required`, opaque
`requestState`, and `inputResponses` to the external client. Elicitation,
sampling and roots are limited to that client's advertised capabilities; these
requests do not open a desktop consent dialog. Upstream OAuth credentials must
already be configured through the desktop. Legacy callers continue through the
v1 bridge; scalar and array structured results also receive a JSON text
projection so legacy clients can consume them.

### Loopback only

The gateway listens on `127.0.0.1` and `::1` at its configured port (default `23333`).
Two explicit listeners share that port and the MCP session store; the IPv6 socket uses
`ipv6Only: true`. If IPv6 is unavailable, IPv4 remains usable. A port conflict fails
startup and releases both listeners. A `feature.api_gateway.host` of `0.0.0.0` left by an
upstream build is ignored; desktop consumers use `127.0.0.1` through `gatewayClientOrigin`.

### Internal listener for Cherry consumers

Agent runtimes and PDF translation reach models through a second listener that
`ApiGatewayService` starts on `127.0.0.1` with an ephemeral port the first time
it is needed. It is independent of the user's `enabled` preference and stays up
until the service stops. Its keys live only in memory and are never persisted or
shown: `ensureInternalGateway` returns one unrestricted key, and
`createScopedCredential({ path, model })` issues a key for a single consumer run
that only calls that path with that model and is revoked by `dispose`. The
internal listener accepts only those keys, sent in a header, and the public
listener accepts only the user's key. Gateway requests run without Cherry's
retries or fallback models, so a request is served only by the model it named.

## Request flow (generation routes)

The OpenAI, Anthropic, and Gemini generation routes call
`processMessage({ params, inputFormat, outputFormat, signal })` in
`proxyStream.ts`. That function is the heart of the gateway:

1. **Resolve model.** Read `params.model`, split on the first `:` into
   `providerId` / `modelId`, build a `uniqueModelId` via `createUniqueModelId`.
   `params.stream === true` selects streaming vs. JSON.
2. **Validate trusted Agent history.** After the request authenticates with the
   internal Agent key, Anthropic-format history is checked before conversion.
   Deeply identical duplicate `tool_use` / `tool_result` blocks are
   losslessly folded; conflicting reuse of an ID returns HTTP 400. This condition
   depends only on the internal Agent key and Anthropic input format, not the target
   provider.
3. **Convert input.** `MessageConverterFactory.create(inputFormat, …)` returns
   the dialect's `IMessageConverter`, which yields:
   - `toUIMessages(params)` → AI SDK `UIMessage[]` (a system/instructions
     prompt becomes a leading `role: 'system'` message).
   - `toAiSdkTools(params)` → a `ToolSet` of **client tools** (no `execute`):
     the model emits the call and the gateway forwards it to the caller.
   - `extractStreamOptions(params)` → sampling (`temperature`, `topP`,
     `topK`, `maxOutputTokens`, `stopSequences`).
   - `extractProviderOptions(provider, params)` → reasoning/thinking options
     (the `Provider` is loaded best-effort from `ProviderService`).
4. **Assemble overrides.** Sampling + tools + provider options are merged into a
   single `CallOverrides` object — the gateway is **assistant-agnostic**, so
   everything is passed per-request (merged at highest precedence inside
   `buildAgentParams`).
5. **Pick the output adapter.** `StreamAdapterFactory.createAdapter(outputFormat)`
   + `.getFormatter(outputFormat)` give the `IStreamAdapter` (state machine that
   turns `UIMessageChunk`s into dialect events) and the `ISseFormatter` (event →
   SSE string).
6. **Drive the stream.** With `streamId = "gateway-<uuid>"`, call
   `AiStreamManager.streamPrompt({ streamId, uniqueModelId, messages, listener,
   callOverrides, contextOwner: 'caller', idleTimeoutMs })`. Caller ownership
   keeps externally managed history out of Cherry's context-build and in-loop
   compaction middleware. This uses the **`promptStreamLifecycle`** — no status
   broadcast, no attach/reconnect, no persistence; the stream evicts immediately
   at terminal.
   - **Streaming**: an `SseListener` with a push-API `formatChunk` /
     `formatDone` / `formatPaused` / `formatError` pipes the adapter's events
     through the formatter into a `text/event-stream` `ReadableStream`. The
     response is withheld behind a startup-commit barrier until the first
     provider-semantic chunk or clean completion; protocol scaffolding such as
     `start` is buffered but does not commit HTTP 200.
   - **Non-streaming**: a plain `StreamListener` feeds every chunk into the
     adapter to accumulate state, then `adapter.buildNonStreamingResponse()` is
     returned as a JSON `Response`.
7. **Abort & timeout.** The route's `request.signal` (client disconnect) calls
   `aiStreamManager.abort(streamId, …)`. An idle (no-chunk) timeout —
   **20 minutes** (`GATEWAY_STREAM_IDLE_TIMEOUT_MS`) — and any mid-stream abort
   surface as a **failure**, not a truncated success. Before streaming response
   commitment, an upstream pause rejects with **504**; after commitment it emits
   a per-dialect error frame (`buildStreamErrorFrame`). Non-streaming requests
   return **504**. The server's per-request timeout is **5 minutes** (`server.ts`),
   with `setTimeout(0)` so live SSE connections are not socket-timed-out.

```
client  ──HTTP──▶  route  ──▶  processMessage
                                  │  converter (in dialect → UIMessage[] + tools + overrides)
                                  ▼
                          AiStreamManager.streamPrompt  (equal, non-persisting subscriber)
                                  │  UIMessageChunk stream
                                  ▼
                          IStreamAdapter.transformChunk → ISseFormatter.formatEvent
                                  ▼
                          SSE ReadableStream  /  JSON Response   ──▶  client
```

### Streaming response commitment

A streaming request has two error regimes:

- **Before commitment:** `processMessage` has not returned its `Response` yet.
  Adapter-generated startup frames remain buffered. A provider error rejects
  with the original serialized error, so the route returns its real HTTP status
  and dialect envelope (for example, HTTP 400 or 503). An idle-timeout pause
  rejects as HTTP 504. AI SDK `start`, step, metadata, partial tool-input, and
  tool-output chunks do not commit the response.
- **After commitment:** once text/reasoning output, an available tool call, a
  finish chunk, or clean completion commits HTTP 200, headers can no longer
  change. A later error or pause therefore emits the dialect's terminal SSE
  error frame and closes the stream.

Client disconnect before commitment abandons the pending response, clears its
startup buffer, aborts the manager execution, and does not surface a gateway
error. The gateway never transparently retries after commitment because doing
so could duplicate model output or tool side effects.

## Adapter system

Two independent dialect axes, chosen by `inputFormat` / `outputFormat`:

| Role | Interface | Implementations |
|---|---|---|
| **Converter** (input → AI SDK) | `IMessageConverter` | `anthropic`, `openai`, `openai-responses`, `gemini` |
| **Stream adapter** (`UIMessageChunk` → events) | `IStreamAdapter` | Anthropic, OpenAI Chat, OpenAI Responses, Gemini adapters |
| **Formatter** (event → SSE string) | `ISseFormatter` | Anthropic, OpenAI Chat, OpenAI Responses, Gemini formatters |

The output formats are **`anthropic`**, **`openai`**, **`openai-responses`**, and **`gemini`**
— the full `OutputFormat` union, each registered in `StreamAdapterFactory`.

Adapters consume the AI SDK **`UIMessageChunk`** stream (not `fullStream`):

- **Usage** comes from `message-metadata` chunks, projected as
  `GatewayUsageMetadata` (`promptTokens` = input, `completionTokens` = output,
  `thoughtsTokens` = reasoning, `totalTokens`). There is **no cache-token
  breakdown** on this channel.
- **`finishReason`** comes from the `finish` chunk; reasoning **signatures**
  come from the reasoning part's `providerMetadata` (cached per provider via
  `reasoningCache.ts` so split signatures survive across chunks).

## Lifecycle & configuration

### `ApiGatewayService` (`src/main/features/apiGateway/ApiGatewayService.ts`)

A `BaseService` — `@Injectable('ApiGatewayService')`,
`@ServicePhase(Phase.WhenReady)`, implements **`Activatable`** — registered one
line in `src/main/core/application/serviceRegistry.ts`. It owns the local
`ApiGateway` HTTP listeners (`src/main/features/apiGateway`) and is the
single authority for their running state.

| Hook | Responsibility |
|---|---|
| `onInit` | Subscribe to `feature.api_gateway.enabled`; IpcApi handlers live in `src/main/ipc/handlers/apiGateway.ts`. |
| `onReady` | Read the persisted desired state and flush the reconciler. |
| `onActivate` | Start on `127.0.0.1` / `::1` at the configured port. |
| `onDeactivate` | Stop the listeners and publish the running state as `false`. |

`ensureValidApiKey()` generates a `cs-sk-<uuid>` key into
`feature.api_gateway.api_key` the first time it is missing.

All activation/deactivation flows through a self-held
[`createLatestReconciler`](../../../src/main/core/concurrency/README.md), the
sole caller of `activate`/`deactivate`. It is driven by `onReady`, Preference
changes and IpcApi actions, converging actual state to `desiredEnabled`.
Start/stop persist user intent before convergence.
Cherry's own consumers never keep this listener up; they use the internal
listener described below.

An explicit gateway stop persists `enabled = false`, then stops the listener.
An explicit restart reuses the configured gateway port.

### Running state — Shared Cache, not IPC

`publishRunningState()` writes `feature.api_gateway.running` (boolean) into the
**Shared Cache** via `CacheService.setShared(...)`. **Main is authoritative**;
the renderer reads it reactively with `useSharedCacheValue('feature.api_gateway.running')`.
There is deliberately **no status/config pull IPC** — pulling running state or
config over IPC would be an anti-pattern, since running lives in the shared
cache and config lives in the Preference subsystem.

### IpcApi (imperative actions only)

| Route | Result | Handler |
|---|---|---|
| `api_gateway.start` | `{ success } \| { success:false, error }` | `ApiGatewayService.start()` |
| `api_gateway.stop` | success includes `outcome: 'stopped'` | `ApiGatewayService.stop()` |
| `api_gateway.restart` | `{ success } \| { success:false, error }` | `ApiGatewayService.restart()` |

### Preferences (`feature.api_gateway.*`)

| Key | Type | Default | Notes |
|---|---|---|---|
| `feature.api_gateway.enabled` | `boolean` | `false` | Auto-start on launch / toggled from settings |
| `feature.api_gateway.host` | `string` | `'127.0.0.1'` | Read for the displayed URL; the listener always binds loopback |
| `feature.api_gateway.port` | `number` | `23333` | TCP port for the IPv4 and IPv6 loopback listeners; UI accepts 1000–65535 |
| `feature.api_gateway.api_key` | `string \| null` | `null` | Auto-generated `cs-sk-<uuid>` on first activate |

Migrated from v1 `redux/settings/apiServer.{enabled,host,port,apiKey}` via the
v2 preference migrators. Edit `classification.json` (not the generated schemas)
to change these — see the v2 data-classify toolchain.

### Renderer

`useApiGateway()` reads config (`enabled`/`host`/`port`/`apiKey`) from
Preferences and `running` from the shared cache, exposes `loading`, and wraps
the three IpcApi actions plus `setApiGatewayConfig`. Main owns writes to the
`enabled` key inside start/stop so persisted intent and runtime state cannot diverge. The
`ApiGatewaySettings` page renders the status indicator, start/stop/restart
controls, port input, server URL, the (copy/regenerate) API key, an
`Authorization` header example, and a link to `…/openapi`.

## Authentication

`authorizeApiRequest(xApiKey, bearerToken)` (`middleware/auth.ts`), run from the
`/v1` guard's `beforeHandle`:

1. Token = trimmed `x-api-key` header (Anthropic style, takes priority) **or**
   `Authorization: Bearer <token>` (OpenAI style, parsed by `@elysia/bearer`).
2. No token → **401** `Unauthorized: missing credentials`.
3. No `feature.api_gateway.api_key` configured → **403** `Forbidden`.
4. Compare against the configured key with **`crypto.timingSafeEqual`**
   (length-checked first). Match → allow; mismatch → **403** `Forbidden`.

The `/v1beta` guard passes Gemini's `x-goog-api-key` / `?key=` token as a third
candidate to the same timing-safe comparison and shapes guard failures in the
Google error envelope.

## Error handling

One root `onError` (`gatewayErrorHandler`) selects the response envelope by
request **path**, so every endpoint speaks its caller's dialect:

| Path prefix | Envelope | Builder |
|---|---|---|
| `/v1/messages` | Anthropic `{ type:'error', error:{ type, message } }` | `anthropicErrorHandler` |
| `/v1/chat`, `/v1/responses` | OpenAI `{ error:{ message, type, code } }` | `openaiErrorHandler` |
| `/v1beta` | Google `{ error:{ code, message, status } }` | `googleErrorHandler` |
| everything else | Cherry REST `{ error:{ code, message, details? } }` | `restErrorHandler` |

`DataApiError`s (from the data-layer services backing models/knowledge) carry
their own `status`/`code` and are mapped straight into the selected envelope.
Built-in Elysia `VALIDATION` / `NOT_FOUND` / `PARSE` codes map to 400/404/400
(422 for REST validation). Explicit HTTP responses thrown by custom parsers
are preserved through Elysia's `ParseError` wrapper.
Unknown provider/runtime errors are shaped by
`transformAnthropicError` / `transformOpenAiError` — **status-driven**: they read
`statusCode` off the AI-SDK `SerializedError`, so a provider 401/429/… keeps its
real status and message instead of flattening to 500. Internal-error messages are
gated behind `isDev`, and the AI-SDK error extras (`stack` / `url` /
request+response bodies) are dropped — for both the JSON handlers and the
streaming `buildStreamErrorFrame`.

## Key invariants

- **Equal, non-persisting subscriber.** The gateway uses
  `promptStreamLifecycle` — its turns are not persisted, not broadcast as topic
  status, and not attachable. It shares the exact same `AiStreamManager` engine
  as the renderer and IM channels.
- **Caller-owned history.** Gateway clients own their context. The gateway sets
  `contextOwner: 'caller'`, so Cherry does not truncate tool results, prune or
  window messages, or run summary compaction. Protocol conversion and provider
  serialization still run normally.
- **Assistant-agnostic.** No assistant/topic context. Sampling, client tools,
  and provider options ride as per-request `CallOverrides`.
- **Main owns running state.** `feature.api_gateway.running` in the Shared Cache is
  the one source of truth; the renderer mirrors it, never sets it.
- **Generation dialect is chosen by path, both directions.** Input format is
  fixed per route; output envelope (success and error) is chosen from the path,
  so a generation client gets back the protocol it spoke.
- **Auth key is the persisted preference.** `feature.api_gateway.api_key`, compared
  timing-safe; auto-generated on first activation.

## Related references

- [AI Reference](../ai/README.md) — `AiStreamManager`, `streamPrompt`,
  `UIMessageChunk`, `buildAgentParams` / `CallOverrides`, the listener model
  (`SseListener`, `WebContentsListener`).
- [Service Lifecycle](../lifecycle/README.md) — `BaseService`, `Activatable`,
  `@ServicePhase`, `serviceRegistry.ts`.
- [Data Layer](../data/README.md) — Preference (`feature.api_gateway.*`), Cache
  (`feature.api_gateway.running`) and the
  `ProviderService` / `KnowledgeBaseService` owners.
