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

// Session tokens are issued by us in exchange for a verified xmoj.tech
// PHPSESSID. They stand for the user, not for a PHPSESSID: xmoj logs users out
// at least once a day and the script logs them back in, and none of that should
// cost a slow round-trip to xmoj or another look at the user's cookie. A token
// only dies when it goes unused for SessionTokenLifetime or the user logs out.

import {ThrowErrorIfFailed} from "./Result";
import {Database} from "./Database";
// @ts-ignore
import CryptoJS from "crypto-js";

export const SessionTokenLifetime = 1000 * 60 * 60 * 24 * 30;
// last_used only needs to be accurate to well within the lifetime; refreshing
// it on every request would turn every read into a D1 write.
const LastUsedResolution = 1000 * 60 * 60 * 24;

export const IsValidSessionToken = (Token: string): boolean => {
  return /^[0-9a-f]{64}$/.test(Token);
};

// Only the hash is stored, so a leaked table cannot be replayed.
export const HashSessionToken = (Token: string): string => {
  return CryptoJS.SHA3(Token).toString();
};

// No expiry is handed out: the lifetime slides with use, so any fixed time
// would go stale.
export const IssueSessionToken = async (XMOJDatabase: Database, Username: string): Promise<{ Token: string }> => {
  const Bytes = new Uint8Array(32);
  crypto.getRandomValues(Bytes);
  const Token = Array.from(Bytes, (Byte) => Byte.toString(16).padStart(2, "0")).join("");
  const Now = new Date().getTime();
  ThrowErrorIfFailed(await XMOJDatabase.Insert("session_token", {
    token_hash: HashSessionToken(Token),
    user_id: Username,
    create_time: Now,
    last_used: Now
  }));
  return {Token};
};

// Returns the user the token was issued to, or "" if it is unknown or expired.
export const ResolveSessionToken = async (XMOJDatabase: Database, Token: string): Promise<string> => {
  if (!IsValidSessionToken(Token)) {
    return "";
  }
  const TokenHash = HashSessionToken(Token);
  const Rows = ThrowErrorIfFailed(await XMOJDatabase.Select("session_token", ["user_id", "last_used"], {
    token_hash: TokenHash
  })) as Array<Record<string, any>>;
  if (Rows.length === 0) {
    return "";
  }
  const Now = new Date().getTime();
  if (Rows[0]["last_used"] + SessionTokenLifetime <= Now) {
    await XMOJDatabase.Delete("session_token", {token_hash: TokenHash});
    return "";
  }
  if (Rows[0]["last_used"] + LastUsedResolution <= Now) {
    await XMOJDatabase.Update("session_token", {last_used: Now}, {token_hash: TokenHash});
  }
  return Rows[0]["user_id"];
};

// Every token the user holds, on every device. Devices that still have a live
// xmoj session simply exchange it again; a token on its own is dead.
export const RevokeAllSessionTokens = async (XMOJDatabase: Database, Username: string): Promise<void> => {
  ThrowErrorIfFailed(await XMOJDatabase.Delete("session_token", {
    user_id: Username
  }));
};

export const RevokeSessionToken = async (XMOJDatabase: Database, Token: string): Promise<void> => {
  ThrowErrorIfFailed(await XMOJDatabase.Delete("session_token", {
    token_hash: HashSessionToken(Token)
  }));
};
