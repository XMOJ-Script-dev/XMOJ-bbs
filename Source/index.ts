/*
 *     Copyright (C) 2023-2024  XMOJ-bbs contributors
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
import {D1Database, KVNamespace, AnalyticsEngineDataset} from "@cloudflare/workers-types";

interface Environment {
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
