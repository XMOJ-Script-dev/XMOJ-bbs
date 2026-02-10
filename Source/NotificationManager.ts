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
 * This implementation uses the WebSocket Hibernation API via
 * `state.acceptWebSocket(...)` so idle websocket connections do not keep the DO
 * actively running.
 */
interface NotificationAttachment {
  userId: string;
  connectedAt: number;
}

interface HibernationWebSocket extends WebSocket {
  serializeAttachment: (value: NotificationAttachment) => void;
  deserializeAttachment: () => NotificationAttachment | null;
}

interface NotificationEnvironment {
  NOTIFICATION_PUSH_TOKEN?: string;
}

export class NotificationManager {
  private readonly state: DurableObjectState;
  private readonly sessions: Map<string, Set<WebSocket>>;
  private readonly pushToken: string;
  private static readonly MAX_SESSIONS_PER_USER = 20;

  constructor(state: DurableObjectState, env: NotificationEnvironment) {
    this.state = state;
    this.sessions = new Map<string, Set<WebSocket>>();
    this.pushToken = env.NOTIFICATION_PUSH_TOKEN || "";
    // `state.getWebSockets()` is synchronous in the current Cloudflare runtime.
    this.rebuildSessionIndex();
  }

  /**
   * Rebuild in-memory session index from hibernated sockets on cold start.
   */
  private rebuildSessionIndex(): void {
    for (const websocket of this.state.getWebSockets()) {
      const userId = this.getSocketUserId(websocket);
      if (!userId) {
        continue;
      }
      this.addSession(userId, websocket);
    }
  }

  /**
   * Store a socket in the per-user set (supports multi-tab / multi-device).
   *
   * To avoid abuse, each user is capped at MAX_SESSIONS_PER_USER sockets. When
   * exceeded, the oldest socket is closed and removed.
   */
  private addSession(userId: string, websocket: WebSocket): void {
    let userSessions = this.sessions.get(userId);
    if (!userSessions) {
      userSessions = new Set<WebSocket>();
      this.sessions.set(userId, userSessions);
    }

    userSessions.add(websocket);
    while (userSessions.size > NotificationManager.MAX_SESSIONS_PER_USER) {
      const oldestSession = userSessions.values().next().value as WebSocket | undefined;
      if (!oldestSession) {
        break;
      }
      this.removeSession(userId, oldestSession);
      try {
        oldestSession.close(1008, "Too many websocket sessions");
      } catch (_) {
        // Best effort close.
      }
    }
  }

  /**
   * Remove a socket from the in-memory index and cleanup empty user entries.
   */
  private removeSession(userId: string, websocket: WebSocket): void {
    const userSessions = this.sessions.get(userId);
    if (!userSessions) {
      return;
    }

    userSessions.delete(websocket);
    if (userSessions.size === 0) {
      this.sessions.delete(userId);
    }
  }

  /**
   * Read the socket's bound user ID from hibernation attachment metadata.
   */
  private getSocketUserId(websocket: WebSocket): string {
    try {
      const attachment = (websocket as HibernationWebSocket).deserializeAttachment();
      if (attachment && attachment.userId !== "") {
        return attachment.userId;
      }
    } catch (_) {
      // Ignore attachment parse failures and treat socket as anonymous.
    }
    return "";
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Internal push channel from Process.ts.
    if (url.pathname === "/notify") {
      if (this.pushToken === "" || request.headers.get("X-Notification-Token") !== this.pushToken) {
        return new Response("Unauthorized", {status: 401});
      }

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

    // Hibernation API: allow DO to sleep while websocket is idle.
    this.state.acceptWebSocket(server);
    (server as HibernationWebSocket).serializeAttachment({
      userId,
      connectedAt: Date.now()
    });
    this.addSession(userId, server);

    server.send(JSON.stringify({
      type: "connected",
      timestamp: Date.now()
    }));

    return new Response(null, {status: 101, webSocket: client});
  }

  webSocketMessage(websocket: WebSocket, message: string | ArrayBuffer): void {
    try {
      const parsedMessage = JSON.parse(typeof message === "string" ? message : new TextDecoder().decode(message));
      if (parsedMessage.type === "ping") {
        websocket.send(JSON.stringify({type: "pong"}));
      }
    } catch (_) {
      // Ignore malformed client messages to keep the connection alive.
    }
  }

  webSocketClose(websocket: WebSocket): void {
    const userId = this.getSocketUserId(websocket);
    if (userId !== "") {
      this.removeSession(userId, websocket);
    }
  }

  webSocketError(websocket: WebSocket): void {
    const userId = this.getSocketUserId(websocket);
    if (userId !== "") {
      this.removeSession(userId, websocket);
    }

    try {
      websocket.close(1011, "Socket error");
    } catch (_) {
      // Socket may already be closed by runtime/client.
    }
  }
}
