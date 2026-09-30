# KBC Momentum – PoC runner

Starts the whole KBC Momentum PoC with one command and shows it on one page: the **mobile app**, the **backoffice** and the customer's **own AI (chat)** side by side, with a focus view per part and a zoomed-out overview that includes the architecture.

```bash
./run.sh          # first run creates .env with random secrets, then docker compose up --build
```

Open **http://localhost:7000**.

| Key / action | Does |
| --- | --- |
| `0` / `Esc` | Overview (all parts + architecture) |
| `1` `2` `3` | Focus the app, backoffice or chat. The other parts shrink into a live side rail |
| `←` `→` | Cycle through the views |
| Click a rail thumbnail or a node in the architecture diagram | Focus that part |

Shortcuts work when the showcase page has focus (not while you're typing inside a part). Each view has its own URL (`#overview`, `#app`, `#backoffice`, `#chat`), so you can link straight to one. Switching never reloads a part, so logins and chats stay where they were.

## What runs

| Service | Source | URL |
| --- | --- | --- |
| `gateway` | this repo (`gateway/`) | http://localhost:7000 (showcase page) |
| `app` | [mobile-app](https://github.com/in4matics-tectonic/mobile-app), Expo web export | http://localhost:7001 |
| `backoffice` | [backoffice](https://github.com/in4matics-tectonic/backoffice), Vite build | http://localhost:7002 |
| `chat` | this repo (`chat/`): Claude + the MCP tools | http://localhost:7003 |
| `backend` | [backend](https://github.com/in4matics-tectonic/backend), its own `Dockerfile` | http://localhost:7004 (`/docs`) |
| `mcp` | [mcp](https://github.com/in4matics-tectonic/mcp), HTTP mode | internal only: `http://backend:3001/mcp` |

- The app and the backoffice are served by nginx, which also proxies `/v1` to the backend. The browser stays same-origin, so there's no CORS and no API URL in the bundles.
- The MCP server shares the backend's network namespace. It only allows plain http to `localhost`, and this way it reaches the API on `http://127.0.0.1:3000` without changes to the mcp repo.
- The chat pane switches between apps with the buttons in its header (also `?app=` on the chat URL):
  - **ChatGPT, Gemini, Claude**: the customer's own AI from the tech doc. Claude does the talking behind all three looks, and it can use exactly the three KBC MCP tools with the logged-in customer's token.
  - **Kate**: the assistant in KBC Mobile. She talks to the backend directly, asks "Klopt dit?" by herself once the demo clock gets a moment to phase `vragen` (with *Ja, klopt / Niet voor ons / Later*), and shows the plan as action cards once it reaches `voorstel`.
  - Tokens stay on the chat server and never reach the browser. It needs `ANTHROPIC_API_KEY`; without it Kate still asks and shows the plan with fixed texts, but free-text chat is off. Answers are rendered as markdown (sanitized).

Demo users and the flow are in the [backend README](https://github.com/in4matics-tectonic/backend#demo-flow). They all use the password `in4matics-must-win` (set in `docker-compose.yml`).

## Sources: GitHub or local

By default every image is built **straight from the GitHub repos** (`main`) using BuildKit git build contexts. There are no submodules to bump: a rebuild picks up the latest `main`.

```bash
docker compose build --no-cache backoffice && docker compose up -d   # pull the latest main of one part
```

To build a local checkout (uncommitted work) or another branch, set it in `.env`:

```bash
BACKOFFICE_SRC=../backoffice                                          # local folder
BACKEND_SRC=https://github.com/in4matics-tectonic/backend.git#my-branch
```

Only the backend ships its own `Dockerfile`. The other parts are built with the Dockerfiles in `docker/`, which take the source from the named build context `src`, so the project repos don't need any Docker files.

## Configuration (`.env`)

See [.env.example](.env.example): `JWT_SECRET`, `ANTHROPIC_API_KEY`, optional `CHAT_MODEL` (default `claude-opus-5-5`) and `CHAT_EFFORT` (default `low`), `*_SRC` and the host ports (`7000`–`7004`).

State lives in memory. `POST /v1/demo/reset` as `adviseur` (the backoffice reset button) starts the demo over. To wipe everything, recreate both together, because the MCP server lives in the backend's network: `docker compose up -d --force-recreate backend mcp`.

## Deploying

For the public VM with HTTPS, a shared site password and automatic deploys on every push, see [deploy/README.md](deploy/README.md).
