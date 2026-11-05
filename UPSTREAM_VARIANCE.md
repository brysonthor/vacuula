# Upstream Variance & Patches

This document tracks custom features and stability patches maintained in this fork relative to upstream (`https://github.com/vacuula/vacuula`).

---

## 1. Gen 3 Connection Stability Patch

### Problem Description
Neato Gen 3 Connected robots (BotVac D3, D5, D7) connect to the Vacuula server over HTTPS via `POST /vendors/neato/login` (chunked transfer encoding).
In upstream:
1. **Aggressive Socket Read Timeout:** `nucleo.py` configured `sock.settimeout(60)`. Because Neato robots emit heartbeats at approximately 30-second intervals, any minor Wi-Fi latency, packet retry, or AP roaming delay that pushed an interval past 60.0 seconds raised `TimeoutError: The read operation timed out`. This caused the server to immediately close the TCP socket and mark the robot offline.
2. **Buffer Desynchronization in Event Handler:** In `event_handler.py`, when a heartbeat chunk (`chr(data[0]) != '{' and msg_size == 1`) arrived, the function returned early without executing `del robot_buffers[serial]`. This left the chunk length buffer populated, causing subsequent chunk lengths and payloads to become desynchronized, leading to dropped messages and parse errors.
3. **Uncleaned Buffer on Disconnect:** If a connection dropped mid-chunk, `robot_buffers[serial]` remained cached in memory across reconnections.

### Files Modified

#### `server/src/vacuula_server/gen3/handlers/nucleo.py`
- Replaced application-level socket timeouts with blocking reads (`sock.settimeout(None)`) and kernel TCP keepalives (`SO_KEEPALIVE`, `TCP_KEEPIDLE=60`, `TCP_KEEPINTVL=15`, `TCP_KEEPCNT=8`, `TCP_USER_TIMEOUT=300_000`). This completely prevents false disconnects during prolonged Wi-Fi power-save sleep while allowing the OS TCP stack to detect genuinely dead peers.
- Fixed CPython `SocketIO` timeout poisoning (`ValueError: cannot read from timed out object`) by avoiding socket timeouts entirely on stream reader objects.
- Removed periodic unsolicited heartbeat chunks from the server: Gen 3 firmware only accepts the initial `{"heartbeat": 60, ...}` login response at connect time and expects signed command envelopes once established.
- Added graceful superseding of previous connections on robot reconnect via `shutdown_robot_socket()` to unblock reader threads without corrupting SSL state.
- Added `reset_robot_buffer(serial)` in `finally:` to guarantee no stale buffer state carries over across robot reconnections.

#### `server/src/vacuula_server/gen3/event_handler.py`
- Changed buffer retrieval to `msg_size = robot_buffers.pop(serial, None)` at the start of payload processing. This ensures the buffer length state is always cleared regardless of whether the chunk is a heartbeat, a JSON error, or an event payload.
- Added `reset_robot_buffer(serial)` to allow external cleanup upon socket teardown.
- Added safe `int(data.strip(), 16)` exception handling against malformed chunk headers.

---

## 2. Discord Notifications Feature

### Feature Description
Adds real-time Discord notifications via webhook embeds for Neato Gen 3 (BotVac D3/D5/D7) and Gen 4 (D8/D9/D10) robots.

#### Notification Events:
1. **Robot Connectivity:**
   - 🟢 **Robot Online:** Dispatched when a robot connects to the Vacuula server.
   - 🔴 **Robot Offline:** Dispatched when a robot disconnects.
2. **Cleaning State Transitions:**
   - 🧹 **Cleaning Started:** When a robot begins a house, spot, or map cleaning run.
   - ⏸️ **Cleaning Paused:** When cleaning is paused.
   - ▶️ **Cleaning Resumed:** When cleaning resumes.
   - 🏠 **Returning to Dock:** When the robot heads back to its base.
   - 🔋 **Docked at Base:** When the robot docks successfully.
3. **Robot Errors & Alerts:**
   - ⚠️ **Robot Error:** Human-friendly translations for Neato error codes (e.g., brush stuck, wheel hanging, bumper stuck, dustbin missing).
   - 🔔 **Robot Alert:** Warnings such as dustbin full.
4. **Session / Run Completion Summary:**
   - ✨ **Cleaning Session Complete:** Dispatched upon upload and processing of the run map and session data. Includes area cleaned (m² and sq ft), duration, battery consumption, and completion status.

#### Key Architectural Highlights:
- **Zero-Block Asynchronous Dispatch:** Webhook delivery runs on a daemon background worker thread with bounded queueing so network delays or Discord rate limits never delay robot socket reads/writes.
- **State Machine Debouncing:** Deduplicates repeated error reports and state heartbeats to prevent notification spam.
- **Opt-In via Environment Variable:** Enabled only when `DISCORD_WEBHOOK_URL` is set (e.g. via `.env` / `docker-compose.yml`).

### Files Modified

#### `server/src/vacuula_server/discord.py` (New module)
- Implements the asynchronous Discord webhook worker, embed builder, error translation dictionary, state transition tracker, and notification dispatchers.

#### `server/src/vacuula_server/handlers/events.py`
- Hooks into `notify_robots_changed()` to detect online/offline state changes for all connected robots.

#### `server/src/vacuula_server/gen3/event_handler.py`
- Hooks into `robot_data` to process Gen 3 state events (e.g., event 77) for cleaning transitions and errors.

#### `server/src/vacuula_server/gen3/handlers/beehive.py`
- Hooks into `upload_finish` to dispatch run completion summaries when Gen 3 session maps are finalized.

#### `server/src/vacuula_server/gen4/handlers.py`
- Hooks into `robot_event` and `robot_response` to track Gen 4 state transitions and errors.
- Hooks into `maps_create` to dispatch run completion summaries when Gen 4 sessions are finalized.

---

## 3. Gen 4 Connection Stability & Crash Prevention Patch

### Problem Description
Neato Gen 4 robots (D8, D9, D10) connect directly to the Vacuula server over a custom TLS socket protocol on port 3443 (`vacuula_server.gen4.init.start`).
In upstream:
1. **Fatal Unhandled Exception in Accept Loop:** In `init.py`, the listener thread synchronously executes `ctx.wrap_socket(client, server_side=True)`. The `try...except` block only caught `ssl.SSLError`. If a robot or network glitch reset or aborted the connection during the TLS handshake (e.g. `ConnectionResetError: [Errno 104] Connection reset by peer`, `BrokenPipeError`, or other `OSError`), the unhandled exception crashed `Thread-2 (start)` permanently.
2. **Permanent Port 3443 Teardown:** When `start()` crashed, the `with socket.socket(...) as sock:` block exited and closed the TCP listener on port 3443. The rest of the Vacuula server (HTTP UI and Gen 3 server) remained running, but port 3443 was closed (`Connection refused`), permanently preventing any Gen 4 robot from reconnecting until a manual container restart.
3. **Aggressive TCP User Timeout:** `init.py` configured `client.setsockopt(socket.IPPROTO_TCP, socket.TCP_USER_TIMEOUT, 20_000)` (20 seconds). When a robot traversed Wi-Fi weak spots or roamed between APs while cleaning, unacknowledged packets for 20s caused the kernel to abruptly terminate the socket with `BrokenPipeError: [Errno 32] Broken pipe`.
4. **KeyError on Disconnect:** In `handle_robot`, the `finally:` block executed `del robot_connections[rc.serial]`. If a robot disconnected before successfully logging in (where `rc.serial` is `<unknown>`), this raised `KeyError` and skipped the rest of socket cleanup and `notify_robots_changed()`.

### Files Modified

#### `server/src/vacuula_server/gen4/init.py`
- Expanded TLS handshake exception handling to catch `(ssl.SSLError, OSError)` as well as general unexpected setup errors, logging warnings and safely closing the client socket without terminating the listener loop.
- Increased `TCP_USER_TIMEOUT` from 20s (`20_000` ms) to 90s (`90_000` ms) and configured TCP keepalive probes (`TCP_KEEPIDLE=60`, `TCP_KEEPINTVL=10`, `TCP_KEEPCNT=5`) to tolerate normal Wi-Fi roaming and transient signal fades during cleaning without false disconnects.
- Wrapped `sock.accept()` and connection setup in defensive try-except blocks so individual connection issues can never crash the Gen 4 listener thread.
- Changed `del robot_connections[rc.serial]` to `robot_connections.pop(rc.serial, None)` in `handle_robot` to prevent `KeyError` if a connection drops before login.

---

## 4. Robot State Caching & Responsive UI Override

### Problem Description
Neato Gen 3 and Gen 4 robot firmware prioritizes real-time LIDAR navigation and map uploads (`/maps/upload_jobs` or `maps.create`) over incoming polling commands. When robots are actively cleaning or transmitting large map payloads, they frequently delay or drop synchronous state queries (`getRobotState` on Gen 3 and `state.show` on Gen 4).
In upstream:
1. **30-Second API Block & 504 Failures:** `post_robot_command` blocked synchronously for 30 seconds (`COMMAND_TIMEOUT_S = 30`) waiting for the robot socket to reply. If the vacuum did not reply within 30 seconds, it returned HTTP 504 Gateway Timeout.
2. **Permanent UI Blank/Lockout:** On the frontend (`AppContext.tsx`), navigating to the web UI or switching robots immediately calls `setRobot(undefined)` followed by `getRobotState()`. `<RequireRobot>` blanks out the entire application until `robot` is defined. Because the 30-second API call timed out with 504 and lacked a fallback handler, the UI froze permanently on a blank screen whenever robots were cleaning.
3. **Redundant Polling:** Neato robots already stream state events passively to the server (Event 77 on Gen 3, `peer.state` on Gen 4), but the server discarded or forwarded them without retaining a current state snapshot.

### Files Modified

#### `server/src/vacuula_server/state.py`
- Added thread-safe in-memory state caching (`last_known_robot_state: dict[str, dict]`).
- Added state update helpers (`update_gen3_state_cache`, `update_gen4_state_cache`) that merge incoming state transitions, battery updates, and error events into the cache.
- Added state retrieval helpers (`get_cached_state_gen3`, `get_cached_state_gen4`) that synthesize responsive state payloads with matching `reqId` and appropriate control states if a robot is actively engaged.

#### `server/src/vacuula_server/handlers/app.py`
- In `post_robot_command`, state queries (`getRobotState` and `state.show`) now wait at most 2.5 seconds for a fresh response from the robot.
- If a robot is busy cleaning or uploading maps and does not respond within 2.5s, the server returns the cached/assumed state immediately with HTTP 200 OK.
- Action commands (`start`, `stop`, `pause`, `resume`, `sendToBase`, etc.) continue to wait the full 30 seconds (`COMMAND_TIMEOUT_S = 30`).

#### `server/src/vacuula_server/gen3/event_handler.py`
- Captures state transitions from both command responses and passive Event 77 notifications, updating the cache in real time.
- Added support for both string and integer `reqId` lookups in `pending_requests`.

#### `server/src/vacuula_server/gen4/handlers.py`
- Captures state transitions from `peer.state` events and command responses, keeping the Gen 4 state cache synchronized.

---

## 5. Responsive Desktop + Mobile UI & Full-Stack Capability Parity

### Feature Description
Upgrades Vacuula from a `640px`-clamped mobile-only web UI into a responsive Desktop + Mobile web application (including Home Assistant Ingress support) and exposes the full hardware capabilities of Neato Gen 3 (Botvac Connected / D3–D7) and Neato Gen 4 (D800/D8/D9/D10) robots.

#### Key Architectural Highlights:
1. **Upstream-Safe Additive Database Schema (`fork_db.py`)**:
   - Because `server/src/vacuula_server/db.py` (`check_db_is_up_to_date()`) asserts a single linear Alembic head revision on boot, fork-specific SQLite tables (`fork__server_setting`, `fork__consumable_reset`, `fork__server_schedule`, `fork__schedule_skip`, `fork__robot_telemetry`) live in a dedicated SQLAlchemy `ForkBase(DeclarativeBase)` initialized via `ForkBase.metadata.create_all(engine)` on startup rather than adding migration files under `server/migrations/versions/`. Merging new upstream Alembic revisions requires zero migration rebasing.
2. **Multi-Robot Fleet Overview, Shareable Routes & Offline Read-Only Mode**:
   - `/` renders a live Fleet Overview dashboard across all linked robots (battery, state, alerts, model/firmware, quick transport actions, and onboarding empty state when 0 robots are linked).
   - `/settings` and `/logs` remain accessible even when 0 robots are linked or all robots are offline.
   - `/robot/:serial/*` provides deep-linkable workspaces (`Command Center`, `Map Studio`, `Run History`, `Schedule`, `Robot & Maintenance`, and Gen 3 `Remote Drive`). Offline robots hydrate from cached server telemetry + `localStorage` boundaries in read-only mode instead of locking out the UI.
3. **Orchestration, Ephemeral "Clean Here", & Gen 4 Schedule Preservation (`orchestrator.py`)**:
   - Snapshots Gen 4 schedules prior to `promote_gen4_floorplan` (`post_promote`) and restores them automatically so floorplan edits no longer disable routines.
   - Provides a server-orchestrated Multi-Zone Cleaning Queue for Gen 3 robots (`queue` SSE broadcasts), ephemeral rectangle/polygon **"Clean Here"** runs on both Gen 3 and Gen 4, and a background Hybrid Scheduler supporting **"Skip Next Run"** windows, one-off ("Clean Tomorrow") runs, and Gen 3 multi-zone scheduled routines.
4. **Gen 3 Manual Remote Drive Proxy (`manual_drive.py`)**:
   - Zero-dependency RFC 6455 LAN WebSocket client proxying `ws://<robot-ip>:<port>/drive` (`getRobotManualCleaningInfo`) over Vacuula's HTTP API with a 1.5s deadman motor-stop switch, paired with a desktop WASD/Arrow + mobile touch D-pad UI (`/robot/:serial/drive`).
5. **Consumable Lifespans, UI-Managed Discord Notifications & Diagnostics (`fork_api.py`)**:
   - Tracks runtime wear across Filter (120h), Main Brush (300h), Side Brush (200h), and Sensors (30h) with reset/threshold controls and optional Discord alerts.
   - Exposes Discord webhook URL, per-category event toggles, and a live test button in `/settings` (falling back to `DISCORD_WEBHOOK_URL` if unset in DB), plus a searchable live-tail Server Log Viewer (`/logs`), Gen 3 `.tar.gz` diagnostic archive pulls/downloads, and run/map/robot deletion endpoints.

### Files Added / Modified
- **Server (`server/src/vacuula_server/`)**: `fork_db.py`, `orchestrator.py`, `manual_drive.py`, `handlers/fork_api.py`, `handlers/route_matcher.py`, `handlers/events.py`, `discord.py`, `state.py`, `__init__.py`, `gen3/handlers/nucleo.py`, `gen4/handlers.py`, `gen4/app.py`.
- **Frontend (`app/src/`)**: Responsive shell (`app.tsx`, `app.module.scss`, `Sidebar`, `ResponsivePanel`, native `<dialog>` `Modal`, `Topbar`, `Navbar`), 5 accent themes + thin themed scrollbars (`theme/`), and workspaces (`Fleet`, `home`, `map`, `runs`, `schedule`, `robotSettings`, `settings`, `serverLogs`, `drive`).

---

## 6. Fork Configuration & Syncing Upstream

### Building & Running Locally with Docker Compose
Create a local `.env` (gitignored) with optional Discord webhook configuration:

```ini
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/<id>/<token>
```

Build from the repository root using `build/docker/Dockerfile`:

```yaml
services:
  vacuula:
    build:
      context: .
      dockerfile: build/docker/Dockerfile
    image: vacuula-local:latest
    environment:
      - DISCORD_WEBHOOK_URL=${DISCORD_WEBHOOK_URL:-}
```

### Merging Upstream Changes
To pull in new commits from `https://github.com/vacuula/vacuula`:

```bash
git fetch upstream
git checkout main
git merge upstream/main
git push origin main
```
