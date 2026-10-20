# Kate Studio – PoC runner

Starts the whole Kate Studio PoC with one command and shows it on one page: the **mobile app**, the **backoffice** and the customer's **own AI (chat)** side by side, with a focus view per part and a zoomed-out overview that includes the architecture.

```bash
./run.sh          # first run creates .env with random secrets, then docker compose up --build
```

Open **http://localhost:7000**.

**Live:** [104-196-54-37.sslip.io](https://104-196-54-37.sslip.io/) (open for now: the site password is switched off in `deploy/Caddyfile`), kiosk at [/kiosk](https://104-196-54-37.sslip.io/kiosk).

| Key / action | Does |
| --- | --- |
| `0` / `Esc` | Overview (all parts + architecture) |
| `1` `2` `3` | Focus the app, backoffice or chat. The other parts shrink into a live side rail |
| `←` `→` | Cycle through the views |
| Click a rail thumbnail or a node in the architecture diagram | Focus that part |

Shortcuts work when the showcase page has focus (not while you're typing inside a part). Each view has its own URL (`#overview`, `#app`, `#backoffice`, `#chat`), so you can link straight to one. Switching never reloads a part, so logins and chats stay where they were.

## Kiosk mode (for the stand)

Open **http://localhost:7000/kiosk**, live at [104-196-54-37.sslip.io/kiosk](https://104-196-54-37.sslip.io/kiosk) (or the **Kiosk** link in the top bar). It's an attract loop for passers-by: big taglines next to the real customer app, live, playing one life moment by itself in about 75 seconds. Signals come in, Kate asks "Klopt dit?", the customer says yes, the proposal unlocks, the customer revokes it, and the loop starts again.

- **No LLM, no cost.** It never loads the chat pane, and every step is a plain backend call: demo reset, the demo clock, share, confirm, revoke. The app can't be clicked, so nobody opens Kate's chat inside it either.
- **Shows little.** No backoffice, no architecture, no signal labels (they're blurred chips, sensitive ones only a 🔒). Just the moment, the phase and the app.
- **It drives the shared demo state.** Every loop starts with a demo reset. Don't run it next to a live demo on the same backend, or open **`/kiosk?drive=0`** there: that one only follows whatever the demo is doing.
- `Esc` goes back to the showcase, `f` toggles fullscreen, and the cursor hides when idle. For a dedicated screen: `chromium --kiosk http://localhost:7000/kiosk`. Works on landscape and portrait screens.

## Pitch mode (the 3-minute finals script)

Open **http://localhost:7000/pitch** (or the **Pitch** link in the top bar). It plays the finals pitch script by itself, on a fixed clock that matches the speaker, and loops: about 10 s of setup (demo reset, every pane logged in), then 3:00 of pitch.

| Time | Beat | On screen |
| --- | --- | --- |
| 0:00 | Hook | Slide |
| 0:15 | Tom & Lien: signals | App + backoffice; the demo clock runs to week 14 (71%, Kate may ask) |
| 0:30 | Kate asks | The app confirms the moment |
| 0:42 | Kate arranges | The app's birth checklist opens and runs "Laat Kate alles regelen" (4 in order, 5 to do) |
| 1:05 | Arranged | Baby, swing in the coin tree, +100 Kate Coins |
| 1:20 | Jonas: own AI | Chat (ChatGPT look, as `jonas`) + backoffice; the moment is shared through MCP, 85% → 93% |
| 1:33 | The network | Jonas's ecosystem graph full screen: select CO2 insight, its three reasons light up, send it to his app |
| 2:03 | The opportunity | Jonas's app shows it and he answers *Interesse* |
| 2:15 | Closing | The customer network, then the closing slide |
| 2:45 | Questions | Slide (buffer) |

- Keys: `c` captions (the speaker's lines, for rehearsing), `t` timer, `r` restart, `Esc` back to the showcase. `/pitch?captions&timer` turns both on.
- It drives the panes through the same bridge as the guided tour. When a pane can't do a step, the pitch makes the same backend call itself, so the story always reaches the next beat. Without `ANTHROPIC_API_KEY`, Jonas's share is that call instead of a chat.
- Like the kiosk, it drives the shared demo state: don't run it next to a live demo on the same backend.

Bridge messages the pitch sends (all from the showcase to a pane, never with credentials):

| Pane | Message | Does |
| --- | --- | --- |
| app | `{kateStudio:'login', user}` | Switch to demo customer `tom`, `lien` or `jonas` |
| app | `{kateStudio:'moment', answer:'confirm'}` | Press *Bevestigen* on Kate's question |
| app | `{kateStudio:'checklist', open: true\|false}` / `{…, run:'all'}` | Open or close the birth checklist / *Laat Kate alles regelen* |
| app | `{kateStudio:'kans', answer:'interesse'\|'afgewezen'}` | Answer the open opportunity |
| backoffice | `{kateStudio:'graaf', vol}` | Ecosystem graph of the open customer, full screen on or off |
| backoffice | `{kateStudio:'knoop', id}` | Select a node (its reasoning lines light up) |
| backoffice | `{kateStudio:'kans', link}` · `{kateStudio:'kansTyp', tekst}` · `{kateStudio:'kansVerstuur'}` · `{kateStudio:'kansSluit'}` | Open the send dialog for a possible link, type the note, send, close |
| chat | `{kateStudio:'login', user}` | Log in as that demo customer (default `lien`) |

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

State lives in memory. The **Reset demo** button on the showcase page puts every part back at the start: it resets the backend (`POST /v1/demo/reset` as `adviseur`: demo clock, signals, consents, audit), clears every chat conversation, and reloads each pane; logins stay. To wipe everything, recreate both together, because the MCP server lives in the backend's network: `docker compose up -d --force-recreate backend mcp`.

## Unfinished (PoC)

- State is in memory in every part: a restart of the backend resets the demo.
- One shared site password guards the whole VM, and every demo user has the same password.
- The own-AI chat and Kate's free-text answers need `ANTHROPIC_API_KEY`; without it the tours make the same backend calls themselves.
- The pitch tour, the guided tour and the kiosk all drive the same demo state: run one at a time per backend.

## Deploying

The public VM runs at **https://104-196-54-37.sslip.io/**, with the parts on `app.`, `backoffice.`, `chat.` and `api.104-196-54-37.sslip.io`. For the setup of that VM with HTTPS, a shared site password and automatic deploys on every push, see [deploy/README.md](deploy/README.md).
