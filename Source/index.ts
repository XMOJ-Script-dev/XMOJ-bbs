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

import {Process} from "./Process";
import {Database} from "./Database";
import {NotificationManager} from "./NotificationManager";
import {D1Database, KVNamespace, AnalyticsEngineDataset, DurableObjectNamespace} from "@cloudflare/workers-types";

interface Environment {
  API_TOKEN: string;
  ACCOUNT_ID: string;
  GithubImagePAT: string;
  xssmseetee_v1_key: string;
  kv: KVNamespace;
  CaptchaSecretKey: string;
  DB: D1Database;
  logdb: AnalyticsEngineDataset;
  AI: any;
  NOTIFICATIONS: DurableObjectNamespace;
  NOTIFICATION_PUSH_TOKEN: string;
}

const ParseUsernameFromProfile = (profilePage: string): string => {
  const userIdIndex = profilePage.indexOf("user_id=");
  if (userIdIndex === -1) {
    return "";
  }
  const usernameStart = userIdIndex + "user_id=".length;
  const remainder = profilePage.substring(usernameStart);
  const closingQuoteIndex = remainder.indexOf("'");
  if (closingQuoteIndex === -1) {
    return "";
  }
  return remainder.substring(0, closingQuoteIndex);
};

const isValidSessionID = (sessionID: string): boolean => {
  return /^[A-Za-z0-9,-]+$/.test(sessionID);
};

const getAllowedOrigin = (origin: string): string | null => {
  if (/^https:\/\/[a-z0-9-]+\.xmoj-script[a-z0-9-]*\.pages\.dev$/.test(origin)) {
    return origin;
  }
  if (/^https:\/\/(www\.|dev\.)?xmoj-bbs\.me$/.test(origin)) {
    return origin;
  }
  if (origin === "https://www.xmoj.tech") {
    return origin;
  }
  return null;
};

const addCorsHeaders = (response: Response, origin: string): Response => {
  const allowedOrigin = getAllowedOrigin(origin);
  if (allowedOrigin === null) return response;
  const newHeaders = new Headers(response.headers);
  newHeaders.set("Access-Control-Allow-Origin", allowedOrigin);
  newHeaders.set("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  newHeaders.set("Access-Control-Allow-Headers", "Content-Type");
  newHeaders.set("Access-Control-Allow-Credentials", "true");
  return new Response(response.body, { status: response.status, headers: newHeaders });
};

const ValidateSession = async (sessionID: string): Promise<string> => {
  const responseText = await fetch(new Request("https://www.xmoj.tech/template/bs3/profile.php", {
    headers: {
      "Cookie": "PHPSESSID=" + sessionID,
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15",
      "accept": "*/*",
      "accept-language": "en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7",
      "permissions-policy": "browsing-topics=()",
      "sec-ch-ua-platform": "\"macOS\"",
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-origin"
    },
    method: "GET"
  })).then((response) => {
    return response.text();
  }).catch(() => {
    return "";
  });

  if (responseText.indexOf("user_id=") === -1) {
    return "";
  }
  return ParseUsernameFromProfile(responseText);
};

export {NotificationManager};

export default {
  async fetch(RequestData: Request, Environment: Environment, Context: any) {
    const origin = RequestData.headers.get("Origin") || "";
    if (RequestData.method === "OPTIONS") {
      const allowedOrigin = getAllowedOrigin(origin);
      if (allowedOrigin === null) {
        return new Response(null, { status: 403 });
      }
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": allowedOrigin,
          "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Allow-Credentials": "true",
          "Access-Control-Max-Age": "86400",
        }
      });
    }

    const url = new URL(RequestData.url);
    if (url.pathname === "/ws/notifications") {
      const sessionID = url.searchParams.get("SessionID") || "";
      if (sessionID === "") {
        return new Response("Missing SessionID", {status: 401});
      }
      if (!isValidSessionID(sessionID)) {
        return new Response("Invalid SessionID", {status: 401});
      }

      const userId = await ValidateSession(sessionID);
      if (userId === "") {
        return new Response("Unauthorized", {status: 401});
      }

      const notificationObjectID = Environment.NOTIFICATIONS.idFromName(userId);
      const notificationStub = Environment.NOTIFICATIONS.get(notificationObjectID);
      const forwardURL = new URL(RequestData.url);
      forwardURL.searchParams.set("userId", userId);
      forwardURL.searchParams.delete("SessionID");
      return await notificationStub.fetch(new Request(forwardURL.toString(), RequestData));
    }

    let Processor = new Process(RequestData, Environment);
    return addCorsHeaders(await Processor.Process(), origin);
  },
  async scheduled(Event: any, Environment: { DB: D1Database; }, Context: {
    waitUntil: (arg0: Promise<void>) => void;
  }) {
    let XMOJDatabase = new Database(Environment.DB);
    Context.waitUntil(new Promise<void>(async (Resolve) => {
      await XMOJDatabase.Delete("short_message", {
        "send_time": {
          "Operator": "<=",
          "Value": new Date().getTime() - 1000 * 60 * 60 * 24 * 5
        },
        "is_read": {
          "Operator": "=",
          "Value": 1
        }
      });
      await XMOJDatabase.Delete("phpsessid", {
        "create_time": {
          "Operator": "<=",
          "Value": new Date().getTime() - 1000 * 60 * 60 * 24 * 5
        }
      });
      Resolve();
    }));
  },
};
