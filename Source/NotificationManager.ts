/*
 *     Copyright (C) 2023-2025  XMOJ-bbs contributors
 *     This file is part of XMOJ-bbs.
 *     XMOJ-bbs is free software: you can redistribute it and/or modify
 *     it under the terms of the GNU Affero General Public License as published by
 *     the Free Software Foundation, either version 3 of the License, or
 *     (at your option) any later version.
 *
 *     XMOJ-bbs is distributed in the hope that it will be useful,
 *     but WITHOUT ANY WARRANTY; without even the implied warranty of
 *     MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *     GNU Affero General Public License for more details.
 *
 *     You should have received a copy of the GNU Affero General Public License
 *     along with XMOJ-bbs.  If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * Durable Object used to manage notification WebSocket sessions per user.
 *
 * A single object instance can keep multiple active sockets in memory and also
 * receive internal push events via `stub.fetch("https://dummy/notify")`.
 */
export class NotificationManager {
  private readonly state: DurableObjectState;
  private readonly sessions: Map<string, Set<WebSocket>>;

  constructor(state: DurableObjectState, _env: unknown) {
    this.state = state;
    this.sessions = new Map<string, Set<WebSocket>>();
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Internal push channel from Process.ts.
    if (url.pathname === "/notify") {
      const body = await request.json() as { userId: string; notification: object };
      const userSessions = this.sessions.get(body.userId);
      if (userSessions) {
        const payload = JSON.stringify(body.notification);
        for (const websocket of userSessions) {
          if (websocket.readyState === 1) {
            websocket.send(payload);
          }
        }
      }
      return new Response("OK");
    }

    const upgradeHeader = request.headers.get("Upgrade");
    if (upgradeHeader !== "websocket") {
      return new Response("Expected WebSocket", {status: 426});
    }

    const userId = url.searchParams.get("userId");
    if (!userId) {
      return new Response("Missing userId", {status: 400});
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.handleSession(server, userId);

    return new Response(null, {status: 101, webSocket: client});
  }

  private handleSession(websocket: WebSocket, userId: string): void {
    websocket.accept();
    let userSessions = this.sessions.get(userId);
    if (!userSessions) {
      userSessions = new Set<WebSocket>();
      this.sessions.set(userId, userSessions);
    }
    userSessions.add(websocket);

    websocket.send(JSON.stringify({
      type: "connected",
      timestamp: Date.now()
    }));

    const removeSession = () => {
      const sessions = this.sessions.get(userId);
      if (!sessions) {
        return;
      }
      sessions.delete(websocket);
      if (sessions.size === 0) {
        this.sessions.delete(userId);
      }
    };

    websocket.addEventListener("close", () => {
      removeSession();
    });
    websocket.addEventListener("error", () => {
      removeSession();
    });
    websocket.addEventListener("message", (event: MessageEvent) => {
      try {
        const message = JSON.parse(event.data as string);
        if (message.type === "ping") {
          websocket.send(JSON.stringify({type: "pong"}));
        }
      } catch (_) {
        // Ignore malformed client messages to keep the connection alive.
      }
    });
  }
}

