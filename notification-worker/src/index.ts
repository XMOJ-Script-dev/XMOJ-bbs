/**
 * Notification worker using Cloudflare Durable Objects.
 *
 * `/ws`    - WebSocket endpoint clients connect to for real time notifications
 * `/notify`- Internal endpoint used by the API worker to broadcast messages
 */

export interface Env {
  NOTIFICATION_DO: DurableObjectNamespace;
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/ws" || url.pathname === "/notify") {
      const id = env.NOTIFICATION_DO.idFromName("global");
      const stub = env.NOTIFICATION_DO.get(id);
      return stub.fetch(request);
    }
    return new Response("Not Found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

export class NotificationDurableObject {
  private sessions: Set<WebSocket> = new Set();

  constructor(private state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/ws") {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("Expected websocket", { status: 426 });
      }
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
      server.accept();
      this.sessions.add(server);
      server.addEventListener("close", () => this.sessions.delete(server));
      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname === "/notify") {
      const message = await request.text();
      for (const ws of this.sessions) {
        try {
          ws.send(message);
        } catch (_) {}
      }
      return new Response("OK");
    }

    return new Response("Not Found", { status: 404 });
  }
}

export const durableObjects = {
  NOTIFICATION_DO: NotificationDurableObject,
};
