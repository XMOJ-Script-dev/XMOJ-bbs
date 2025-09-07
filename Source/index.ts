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
import {D1Database, KVNamespace, AnalyticsEngineDataset} from "@cloudflare/workers-types";
import {getDrizzle} from "./Drizzle";
import {shortMessage, phpsessid} from "./schema";
import {and, eq, lt} from "drizzle-orm";

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
}

export default {
  async fetch(RequestData: Request, Environment: Environment, Context: any) {
    let Processor = new Process(RequestData, Environment);
    return await Processor.Process();
  },
  async scheduled(Event: any, Environment: { DB: D1Database; }, Context: {
    waitUntil: (arg0: Promise<void>) => void;
  }) {
    const db = getDrizzle(Environment.DB);
    Context.waitUntil(new Promise<void>(async (Resolve) => {
      await db.delete(shortMessage).where(and(
          lt(shortMessage.sendTime, new Date().getTime() - 1000 * 60 * 60 * 24 * 5),
          eq(shortMessage.isRead, 1)
      ));
      await db.delete(phpsessid).where(
          lt(phpsessid.createTime, new Date().getTime() - 1000 * 60 * 60 * 24 * 5)
      );
      Resolve();
    }));
  },
};
