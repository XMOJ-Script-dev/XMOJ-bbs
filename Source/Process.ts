// noinspection ExceptionCaughtLocallyJS,JSUnusedGlobalSymbols

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

import {Result, ThrowErrorIfFailed} from "./Result";
import {Output} from "./Output";
import {CheerioAPI, load} from "cheerio";
import * as sqlstring from 'sqlstring';
// @ts-ignore
import CryptoJS from "crypto-js";
import {AnalyticsEngineDataset, D1Database, KVNamespace} from "@cloudflare/workers-types";
import {getDrizzle} from "./Drizzle";
import * as schema from "./schema";
import {and, eq, lt, desc, count, ne, or} from "drizzle-orm";
import {DrizzleD1Database} from "drizzle-orm/d1";

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

// noinspection JSUnusedLocalSymbols
function sleep(time: number) {
  return new Promise((resolve) => setTimeout(resolve, time));
}

export class Process {
  private AdminUserList: Array<string> = ["chenlangning", "shanwenxiao", "zhuchenrui2"];
  // noinspection JSMismatchedCollectionQueryUpdate
  private DenyMessageList: Array<string> = ["std"];
  // noinspection JSMismatchedCollectionQueryUpdate
  private SilencedUser: Array<string> = ["zhaochenyi", "qianwenyu"];
  // noinspection JSMismatchedCollectionQueryUpdate
  private DenyBadgeEditList: Array<string> = [];
  private readonly CaptchaSecretKey: string;
  private GithubImagePAT: string;
  private readonly ACCOUNT_ID: string;
  private AI: any;
  private kv: any;
  private readonly shortMessageEncryptKey_v1: string;
  private readonly API_TOKEN: string;
  private Username: string;
  private SessionID: string;
  private readonly RemoteIP: string;
  private XMOJDatabase: DrizzleD1Database<typeof schema>;
  private readonly logs: AnalyticsEngineDataset;
  private RequestData: Request;
  private Fetch = async (RequestURL: URL): Promise<Response> => {
    Output.Log("Fetch: " + RequestURL.toString());
    const RequestData = new Request(RequestURL, {
      headers: {
        "Cookie": "PHPSESSID=" + this.SessionID,
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15",
        "accept": "*/*",
        "accept-language": "en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7",
        "permissions-policy": "browsing-topics=()",
        "sec-ch-ua-platform": "\"macOS\"",
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin"
      }, "method": "GET"
    });
    return await fetch(RequestData);
  }
  public CheckParams = (Data: object, Checklist: object): Result => {
    for (const i in Data) {
      if (Checklist[i] === undefined) {
        return new Result(false, "参数" + i + "未知");
      }
      const AvailableTypes = ["string", "number", "bigint", "boolean", "symbol", "undefined", "object", "function"];
      if (AvailableTypes.indexOf(Checklist[i]) === -1) {
        return new Result(false, "参数类型" + Checklist[i] + "未知");
      }
      if (typeof Data[i] !== Checklist[i]) {
        return new Result(false, "参数" + i + "期望类型" + Checklist[i] + "实际类型" + typeof Data[i]);
      }
    }
    for (const i in Checklist) {
      if (Data[i] === undefined) {
        return new Result(false, "参数" + i + "未找到");
      }
    }
    return new Result(true, "参数检测通过");
  }
  public CheckToken = async (Data: object): Promise<Result> => {
    ThrowErrorIfFailed(this.CheckParams(Data, {
      "SessionID": "string",
      "Username": "string"
    }));
    this.SessionID = Data["SessionID"];
    this.Username = Data["Username"];
    // return new Result(true, "令牌检测跳过");
    const HashedToken: string = CryptoJS.SHA3(this.SessionID).toString();
    const CurrentSessionData = await this.XMOJDatabase.select({
      userId: schema.phpsessid.userId,
      createTime: schema.phpsessid.createTime
    }).from(schema.phpsessid).where(eq(schema.phpsessid.token, HashedToken));

    if (CurrentSessionData.toString() !== "") {
      if (CurrentSessionData[0]["userId"] === this.Username &&
          CurrentSessionData[0]["createTime"] + 1000 * 60 * 60 * 24 * 7 > new Date().getTime()) {
        return new Result(true, "令牌匹配");
      } else {
        await this.XMOJDatabase.delete(schema.phpsessid).where(eq(schema.phpsessid.token, HashedToken));
        Output.Log("Session " + this.SessionID + " expired");
      }
    }

    const SessionUsername: string = await this.Fetch(new URL("https://www.xmoj.tech/template/bs3/profile.php"))
        .then((Response) => {
          return Response.text();
        }).then((Response) => {
          let SessionUsername = Response.substring(Response.indexOf("user_id=") + 8);
          SessionUsername = SessionUsername.substring(0, SessionUsername.indexOf("'"));
          return SessionUsername;
        }).catch((Error) => {
          Output.Error("Check token failed: " + Error + "\n" +
              "PHPSessionID: \"" + this.SessionID + "\"\n" +
              "Username    : \"" + this.Username + "\"\n");
          return "";
        });
    if (SessionUsername == "") {
      Output.Debug("Check token failed: Session invalid\n" +
          "PHPSessionID: \"" + this.SessionID + "\"\n");
      return new Result(false, "令牌不合法");
    }
    if (SessionUsername != this.Username) {
      Output.Debug("Check token failed: Session and username not match \n" +
          "PHPSessionID   : \"" + this.SessionID + "\"\n" +
          "SessionUsername: \"" + SessionUsername + "\"\n" +
          "Username       : \"" + this.Username + "\"\n");
      return new Result(false, "令牌不匹配");
    }
    //check if the item already exists in db
    const sessionCount = await this.XMOJDatabase.select({count: count()}).from(schema.phpsessid).where(eq(schema.phpsessid.token, HashedToken));
    if (sessionCount[0].count == 0) {
      await this.XMOJDatabase.insert(schema.phpsessid).values({
        token: HashedToken,
        userId: this.Username,
        createTime: new Date().getTime()
      });
    } else {
      Output.Log("token already exists, skipping insert");
    }
    Output.Log("Record session: " + this.SessionID + " for " + this.Username);
    return new Result(true, "令牌匹配");
  }
  public IfUserExist = async (Username: string): Promise<Result> => {
    if (Username !== Username.toLowerCase()) {
      return new Result(false, "用户名必须为小写");
    }
    const userCount = await this.XMOJDatabase.select({count: count()}).from(schema.phpsessid).where(eq(schema.phpsessid.userId, Username));
    if (userCount[0].count > 0) {
      return new Result(true, "用户检查成功", {
        "Exist": true
      });
    }
    return await this.Fetch(new URL("https://www.xmoj.tech/userinfo.php?user=" + Username))
      .then((Response) => {
        return Response.text();
      }).then((Response) => {
        return new Result(true, "用户检查成功", {
          "Exist": Response.indexOf("No such User!") === -1
        });
      }).catch((Error) => {
        Output.Error("Check user exist failed: " + Error + "\n" +
          "Username: \"" + Username + "\"\n");
        return new Result(false, "用户检查失败: " + Error);
      });
  }
  public IfUserExistChecker = async (Username: string): Promise<Result> => {
    return this.IfUserExist(Username);
  }
  public IsAdmin = (): boolean => {
    return this.AdminUserList.indexOf(this.Username) !== -1;
  }
  public DenyMessage = (): boolean => {
    return this.DenyMessageList.indexOf(this.Username) !== -1;
  }
  public IsSilenced = (): boolean => {
    return this.SilencedUser.indexOf(this.Username) !== -1;
  }
  public DenyEdit = (): boolean => {
    return this.DenyBadgeEditList.indexOf(this.Username) !== -1;
  }
  public VerifyCaptcha = async (CaptchaToken: string): Promise<Result> => {
    const ErrorDescriptions: Object = {
      "missing-input-secret": "密钥为空",
      "invalid-input-secret": "密钥不正确",
      "missing-input-response": "验证码令牌为空",
      "invalid-input-response": "验证码令牌不正确或已过期",
      "invalid-widget-id": "解析出的组件编号不正确",
      "invalid-parsed-secret": "解析出的密钥不正确",
      "bad-request": "请求格式错误",
      "timeout-or-duplicate": "相同验证码已经校验过",
      "internal-error": "服务器错误"
    };
    if (this.CaptchaSecretKey === undefined) {
      return new Result(true, "验证码检测跳过");
    }
    // return new Result(true, "验证码检测跳过");
    if (CaptchaToken === "") {
      return new Result(false, "验证码没有完成");
    }
    const VerifyFormData = new FormData();
    VerifyFormData.append("secret", this.CaptchaSecretKey);
    VerifyFormData.append("response", CaptchaToken);
    VerifyFormData.append("remoteip", this.RemoteIP);
    const VerifyResult = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      body: JSON.stringify({
        secret: this.CaptchaSecretKey,
        response: CaptchaToken,
        remoteip: this.RemoteIP
      }),
      headers: {
        "Content-Type": "application/json"
      },
      method: 'POST',
    }).then((Response) => {
      return Response.json();
    });
    if (VerifyResult["success"]) {
      return new Result(true, "验证码通过");
    } else {
      let ErrorString: string = "验证没有通过：";
      for (let i = 0; i < VerifyResult["error-codes"].length; i++) {
        ErrorString += (ErrorDescriptions[VerifyResult["error-codes"][i]] == null ? VerifyResult["error-codes"][i] : ErrorDescriptions[VerifyResult["error-codes"][i]]) + " ";
      }
      ErrorString = ErrorString.trimEnd();
      return new Result(false, ErrorString);
    }
  }
  public GetProblemScore = async (ProblemID: number): Promise<number> => {
    return await this.Fetch(new URL("https://www.xmoj.tech/status.php?user_id=" + this.Username + "&problem_id=" + ProblemID))
      .then((Response) => {
        return Response.text();
      }).then((Response) => {
        const ParsedDocument: CheerioAPI = load(Response);
        const ResultTable = ParsedDocument("#result-tab");
        if (ResultTable.length == 0) {
          Output.Error("Get problem score failed: Cannot find table element\n" +
            "ProblemID: \"" + ProblemID + "\"\n" +
            "Username : \"" + this.Username + "\"\n");
          return 0;
        }
        let MaxScore: number = 0;
        const ResultTableBody = ResultTable.children().eq(1);
        for (let i = 0; i < ResultTableBody.children().length; i++) {
          const ResultRow = ResultTableBody.children().eq(i);
          if (ResultRow.children().eq(4).text().trim() === "正确") {
            return 100;
          } else if (ResultRow.children().eq(4).children().length == 2) {
            const ScoreSpan = ResultRow.children().eq(4).children().eq(1);
            if (ScoreSpan.length == 0) {
              Output.Error("Get problem score failed: Cannot find score span\n" +
                "ProblemID: \"" + ProblemID + "\"\n" +
                "Username : \"" + this.Username + "\"\n");
              return 0;
            }
            const Score: string = ScoreSpan.text().trim();
            MaxScore = Math.max(MaxScore, parseInt(Score.substring(0, Score.length - 1)));
          }
        }
        return MaxScore;
      }).catch((Error) => {
        Output.Error("Get user score failed: " + Error + "\n" +
          "ProblemID: \"" + ProblemID + "\"\n" +
          "Username : \"" + this.Username + "\"\n");
        ThrowErrorIfFailed(new Result(false, "获取题目分数失败"));
        return 0;
      });
  }
  public GetProblemScoreChecker = async (ProblemID: number): Promise<number> => {
    return await this.GetProblemScore(ProblemID);
  }

  public processCppString(inputStr: string) {
    let result = '';
    let i = 0;
    const len = inputStr.length;

    while (i < len) {
      // Check for a raw string literal: R\"(
      if (inputStr.substring(i, i + 4) === 'R\\"(') {
        const rawStringStart = i;
        const rawStringEnd = inputStr.indexOf(')\\"', rawStringStart + 4);

        if (rawStringEnd !== -1) {
          // Append the entire raw string literal without modification
          result += inputStr.substring(rawStringStart, rawStringEnd + 3);
          i = rawStringEnd + 3;
          continue;
        }
      }

      // Check for a regular string literal: \"
      if (inputStr.substring(i, i + 2) === '\\"') {
        result += '\\"'; // Append the opening quote
        i += 2;

        // Process the content inside the regular string
        while (i < len) {
          // Case 1: An escaped backslash. This is key for handling \\\"
          if (inputStr.substring(i, i + 3) === '\\\\n') {
            result += '\\\\n'; // Keep it as is
            i += 3;
            console.log("Escaped backslash found, keeping it as is");
          }
          if (inputStr.substring(i, i + 4) === '\\\\\\\"') {
            result += '\\\\\\\"'; // Keep it as is
            i += 4;
            console.log("Escaped backslash found, keeping it as is");
          }
          // Case 2: A string-terminating quote. This is NOT preceded by another backslash.
          else if (inputStr.substring(i, i + 2) === '\\"') {
            result += '\\"'; // Append the closing quote
            i += 2;
            break; // Exit the inner string-processing loop
          }
          // Case 3: A newline character sequence '\n'
          else if (inputStr.substring(i, i + 2) === '\\n') {
            result += '\\\\n'; // Replace '\n' with '\\n'
            i += 2;
            console.log("AT newline character, replacing with \\\\n: " + inputStr.substring(i - 4, i + 2));
          }
          // Case 4: Any other character
          else {
            result += inputStr[i];
            i++;
          }
        }
      } else {
        // Append any character that is not part of a string we're processing
        result += inputStr[i];
        i++;
      }
    }
    console.log(result);
    return result;
  }

  private AddBBSMention = async (ToUserID: string, PostID: number, ReplyID: number): Promise<void> => {
    if (ToUserID === this.Username) {
      return;
    }
    const mentionCount = await this.XMOJDatabase.select({count: count()}).from(schema.bbsMention).where(and(eq(schema.bbsMention.toUserId, ToUserID), eq(schema.bbsMention.postId, PostID)));
    if (mentionCount[0].count === 0) {
      await this.XMOJDatabase.insert(schema.bbsMention).values({
        toUserId: ToUserID,
        postId: PostID,
        bbsMentionTime: new Date().getTime(),
        replyId: ReplyID
      });
    } else {
      await this.XMOJDatabase.update(schema.bbsMention).set({
        bbsMentionTime: new Date().getTime()
      }).where(and(eq(schema.bbsMention.toUserId, ToUserID), eq(schema.bbsMention.postId, PostID), eq(schema.bbsMention.replyId, ReplyID)));
    }
  };
  private AddMailMention = async (FromUserID: string, ToUserID: string): Promise<void> => {
    const mentionCount = await this.XMOJDatabase.select({count: count()}).from(schema.shortMessageMention).where(and(eq(schema.shortMessageMention.fromUserId, FromUserID), eq(schema.shortMessageMention.toUserId, ToUserID)));
    if (mentionCount[0].count === 0) {
      await this.XMOJDatabase.insert(schema.shortMessageMention).values({
        fromUserId: FromUserID,
        toUserId: ToUserID,
        mailMentionTime: new Date().getTime()
      });
    } else {
      await this.XMOJDatabase.update(schema.shortMessageMention).set({
        mailMentionTime: new Date().getTime()
      }).where(and(eq(schema.shortMessageMention.fromUserId, FromUserID), eq(schema.shortMessageMention.toUserId, ToUserID)));
    }
  };
  private ProcessFunctions = {
    NewPost: async (Data: object): Promise<Result> => {
      ThrowErrorIfFailed(this.CheckParams(Data, {
        "ProblemID": "number",
        "Title": "string",
        "Content": "string",
        "CaptchaSecretKey": "string",
        "BoardID": "number"
      }));
      ThrowErrorIfFailed(await this.VerifyCaptcha(Data["CaptchaSecretKey"]));
      if (Data["Title"].trim() === "") {
        return new Result(false, "标题不能为空");
      }
      if (Data["Content"].trim() === "") {
        return new Result(false, "内容不能为空");
      }
      if (!this.IsAdmin() && (Data["BoardID"] == 0 || Data["BoardID"] == 5)) {
        return new Result(false, "没有权限发表公告");
      }
      if (this.IsSilenced()) {
        return new Result(false, "您已被禁言，无法发表讨论");
      }
      const boardCount = await this.XMOJDatabase.select({count: count()}).from(schema.bbsBoard).where(eq(schema.bbsBoard.boardId, Data["BoardID"]));
      if (Data["BoardID"] !== 0 && boardCount[0].count === 0) {
        return new Result(false, "该板块不存在");
      }
      const post = await this.XMOJDatabase.insert(schema.bbsPost).values({
        userId: this.Username,
        problemId: Data["ProblemID"],
        title: Data["Title"],
        postTime: new Date().getTime(),
        boardId: Data["BoardID"]
      }).returning({insertedId: schema.bbsPost.postId});
      const reply = await this.XMOJDatabase.insert(schema.bbsReply).values({
        userId: this.Username,
        postId: post[0].insertedId,
        content: Data["Content"],
        replyTime: new Date().getTime()
      }).returning({insertedId: schema.bbsReply.replyId});
      return new Result(true, "创建讨论成功", {
        PostID: post[0].insertedId,
        ReplyID: reply[0].insertedId
      });
    },
    NewReply: async (Data: object): Promise<Result> => {
      ThrowErrorIfFailed(this.CheckParams(Data, {
        "PostID": "number",
        "Content": "string",
        "CaptchaSecretKey": "string"
      }));
      ThrowErrorIfFailed(await this.VerifyCaptcha(Data["CaptchaSecretKey"]));
      const Post = await this.XMOJDatabase.select({
        title: schema.bbsPost.title,
        userId: schema.bbsPost.userId,
        boardId: schema.bbsPost.boardId
      }).from(schema.bbsPost).where(eq(schema.bbsPost.postId, Data["PostID"]));
      if (Post.toString() == "") {
        return new Result(false, "该讨论不存在");
      }
      //console.log(Post[0]["board_id"]);
      if (Post[0]["boardId"] == 5) {
        return new Result(false, "此讨论不允许回复");
      }
      //check if the post is locked
      const lockCount = await this.XMOJDatabase.select({count: count()}).from(schema.bbsLock).where(eq(schema.bbsLock.postId, Data["PostID"]));
      if (lockCount[0].count === 1 && !this.IsAdmin()) {
        return new Result(false, "讨论已被锁定");
      }
      if (this.IsSilenced()) {
        return new Result(false, "您已被禁言，无法回复讨论");
      }
      Data["Content"] = Data["Content"].trim();
      if (Data["Content"] === "") {
        return new Result(false, "内容不能为空");
      }
      let MentionPeople = new Array<string>();
      // @ts-ignore
      for (const Match of String(Data["Content"]).matchAll(/@([a-zA-Z0-9]+)/g)) {
        if (ThrowErrorIfFailed(await this.IfUserExistChecker(Match[1]))["Exist"]) {
          MentionPeople.push(Match[1]);
        }
      }
      MentionPeople = Array.from(new Set(MentionPeople));
      if (MentionPeople.length > 3 && !this.IsAdmin()) {
        return new Result(false, "一次最多@3个人");
      }
      const reply = await this.XMOJDatabase.insert(schema.bbsReply).values({
        userId: this.Username,
        postId: Data["PostID"],
        content: Data["Content"],
        replyTime: new Date().getTime()
      }).returning({insertedId: schema.bbsReply.replyId});

      for (const i in MentionPeople) {
        await this.AddBBSMention(MentionPeople[i], Data["PostID"], reply[0].insertedId);
      }

      if (Post[0]["userId"] !== this.Username) {
        await this.AddBBSMention(Post[0]["userId"], Data["PostID"], reply[0].insertedId);
      }

      return new Result(true, "创建回复成功", {
        ReplyID: reply[0].insertedId
      });
    },
    GetPosts: async (Data: object): Promise<Result> => {
      ThrowErrorIfFailed(this.CheckParams(Data, {
        "ProblemID": "number",
        "Page": "number",
        "BoardID": "number"
      }));

      const searchConditions = [];
      if (Data["BoardID"] !== -1) {
        searchConditions.push(eq(schema.bbsPost.boardId, Data["BoardID"]));
      }
      if (Data["ProblemID"] !== 0) {
        searchConditions.push(eq(schema.bbsPost.problemId, Data["ProblemID"]));
      }

      const postCountResult = await this.XMOJDatabase.select({count: count()}).from(schema.bbsPost).where(and(...searchConditions));
      const pageCount = Math.ceil(postCountResult[0].count / 15);

      let ResponseData = {
        Posts: new Array<Object>,
        PageCount: pageCount
      };
      if (ResponseData.PageCount === 0) {
        return new Result(true, "获得讨论列表成功", ResponseData);
      }
      if (Data["Page"] < 1 || Data["Page"] > ResponseData.PageCount) {
        return new Result(false, "参数页数不在范围1~" + ResponseData.PageCount + "内");
      }

      const Posts = await this.XMOJDatabase.select().from(schema.bbsPost).where(and(...searchConditions)).orderBy(desc(schema.bbsPost.postId)).limit(15).offset((Data["Page"] - 1) * 15);
      for (const i in Posts) {
        const Post = Posts[i];

        const replyCountResult = await this.XMOJDatabase.select({count: count()}).from(schema.bbsReply).where(eq(schema.bbsReply.postId, Post.postId));
        const ReplyCount = replyCountResult[0].count;

        const LastReply = await this.XMOJDatabase.select({
          userId: schema.bbsReply.userId,
          replyTime: schema.bbsReply.replyTime
        }).from(schema.bbsReply).where(eq(schema.bbsReply.postId, Post.postId)).orderBy(desc(schema.bbsReply.replyTime)).limit(1);

        if (ReplyCount === 0) {
          await this.XMOJDatabase.delete(schema.bbsPost).where(eq(schema.bbsPost.postId, Post.postId));
          continue;
        }

        const LockData = {
          Locked: false,
          LockPerson: "",
          LockTime: 0
        };
        const Locked = await this.XMOJDatabase.select().from(schema.bbsLock).where(eq(schema.bbsLock.postId, Post.postId));
        if (Locked.toString() !== "") {
          LockData.Locked = true;
          LockData.LockPerson = Locked[0]["lockPerson"];
          LockData.LockTime = Locked[0]["lockTime"];
        }

        const boardNameResult = await this.XMOJDatabase.select({boardName: schema.bbsBoard.boardName}).from(schema.bbsBoard).where(eq(schema.bbsBoard.boardId, Post.boardId));
        ResponseData.Posts.push({
          PostID: Post.postId,
          UserID: Post.userId,
          ProblemID: Post.problemId,
          Title: Post.title,
          PostTime: Post.postTime,
          BoardID: Post.boardId,
          BoardName: boardNameResult[0].boardName,
          ReplyCount: ReplyCount,
          LastReplyUserID: LastReply[0].userId,
          LastReplyTime: LastReply[0].replyTime,
          Lock: LockData
        });
      }
      return new Result(true, "获得讨论列表成功", ResponseData);
    },
    GetPost: async (Data: object): Promise<Result> => {
      ThrowErrorIfFailed(this.CheckParams(Data, {
        "PostID": "number",
        "Page": "number"
      }));
      const ResponseData = {
        UserID: "",
        ProblemID: 0,
        Title: "",
        BoardID: 0,
        BoardName: "",
        PostTime: 0,
        Reply: new Array<Object>(),
        PageCount: 0,
        Lock: {
          Locked: false,
          LockPerson: "",
          LockTime: 0
        }
      };
      const Post = await this.XMOJDatabase.select().from(schema.bbsPost).where(eq(schema.bbsPost.postId, Data["PostID"]));

      if (Post.toString() == "") {
        return new Result(false, "该讨论不存在");
      }
      const replyCountResult = await this.XMOJDatabase.select({count: count()}).from(schema.bbsReply).where(eq(schema.bbsReply.postId, Data["PostID"]));
      ResponseData.PageCount = Math.ceil(replyCountResult[0].count / 15);

      if (ResponseData.PageCount === 0) {
        return new Result(true, "获得讨论成功", ResponseData);
      }
      if (Data["Page"] < 1 || Data["Page"] > ResponseData.PageCount) {
        return new Result(false, "参数页数不在范围1~" + ResponseData.PageCount + "内");
      }
      ResponseData.UserID = Post[0].userId;
      ResponseData.ProblemID = Post[0].problemId;
      ResponseData.Title = Post[0].title;
      ResponseData.PostTime = Post[0].postTime;
      ResponseData.BoardID = Post[0].boardId;
      const boardNameResult = await this.XMOJDatabase.select({boardName: schema.bbsBoard.boardName}).from(schema.bbsBoard).where(eq(schema.bbsBoard.boardId, Post[0].boardId));
      ResponseData.BoardName = boardNameResult[0].boardName;

      const Locked = await this.XMOJDatabase.select().from(schema.bbsLock).where(eq(schema.bbsLock.postId, Data["PostID"]));
      if (Locked.toString() !== "") {
        ResponseData.Lock.Locked = true;
        ResponseData.Lock.LockPerson = Locked[0]["lockPerson"];
        ResponseData.Lock.LockTime = Locked[0]["lockTime"];
      }

      const Reply = await this.XMOJDatabase.select().from(schema.bbsReply).where(eq(schema.bbsReply.postId, Data["PostID"])).orderBy(desc(schema.bbsReply.replyTime)).limit(15).offset((Data["Page"] - 1) * 15);
      for (const i in Reply) {
        let ReplyItem = Reply[i];
        let processedContent: string = ReplyItem.content;
        processedContent = processedContent.replace(/xmoj-bbs\.tech/g, "xmoj-bbs.me");
        ResponseData.Reply.push({
          ReplyID: ReplyItem.replyId,
          UserID: ReplyItem.userId,
          Content: processedContent,
          ReplyTime: ReplyItem.replyTime,
          EditTime: ReplyItem.editTime,
          EditPerson: ReplyItem.editPerson
        });
      }
      return new Result(true, "获得讨论成功", ResponseData);
    },
    LockPost: async (Data: object): Promise<Result> => {
      ThrowErrorIfFailed(this.CheckParams(Data, {
        "PostID": "number"
      }));
      const postCount = await this.XMOJDatabase.select({count: count()}).from(schema.bbsPost).where(eq(schema.bbsPost.postId, Data["PostID"]));
      if (postCount[0].count === 0) {
        return new Result(false, "该讨论不存在");
      }
      if (!this.IsAdmin()) {
        return new Result(false, "没有权限锁定此讨论");
      }
      const lockCount = await this.XMOJDatabase.select({count: count()}).from(schema.bbsLock).where(eq(schema.bbsLock.postId, Data["PostID"]));
      if (lockCount[0].count === 1) {
        return new Result(false, "讨论已经被锁定");
      }
      await this.XMOJDatabase.insert(schema.bbsLock).values({
        postId: Data["PostID"],
        lockPerson: this.Username,
        lockTime: new Date().getTime()
      });
      return new Result(true, "讨论锁定成功");
    },
    UnlockPost: async (Data: object): Promise<Result> => {
      ThrowErrorIfFailed(this.CheckParams(Data, {
        "PostID": "number"
      }));
      const postCount = await this.XMOJDatabase.select({count: count()}).from(schema.bbsPost).where(eq(schema.bbsPost.postId, Data["PostID"]));
      if (postCount[0].count === 0) {
        return new Result(false, "解锁失败，该讨论不存在");
      }
      if (!this.IsAdmin()) {
        return new Result(false, "没有权限解锁此讨论");
      }
      const lockCount = await this.XMOJDatabase.select({count: count()}).from(schema.bbsLock).where(eq(schema.bbsLock.postId, Data["PostID"]));
      if (lockCount[0].count === 0) {
        return new Result(false, "讨论已经被解锁");
      }
      await this.XMOJDatabase.delete(schema.bbsLock).where(eq(schema.bbsLock.postId, Data["PostID"]));
      return new Result(true, "讨论解锁成功");
    },
    EditReply: async (Data: object): Promise<Result> => {
      ThrowErrorIfFailed(this.CheckParams(Data, {
        "ReplyID": "number",
        "Content": "string"
      }));
      const Reply = await this.XMOJDatabase.select({
        postId: schema.bbsReply.postId,
        userId: schema.bbsReply.userId
      }).from(schema.bbsReply).where(eq(schema.bbsReply.replyId, Data["ReplyID"]));
      if (Reply.toString() === "") {
        return new Result(false, "编辑失败，未找到此回复");
      }
      if (!this.IsAdmin() && Reply[0].userId !== this.Username) {
        return new Result(false, "没有权限编辑此回复");
      }
      const postCount = await this.XMOJDatabase.select({count: count()}).from(schema.bbsPost).where(eq(schema.bbsPost.postId, Reply[0].postId));
      if (postCount[0].count === 0) {
        return new Result(false, "编辑失败，该回复所属的讨论不存在");
      }
      const lockCount = await this.XMOJDatabase.select({count: count()}).from(schema.bbsLock).where(eq(schema.bbsLock.postId, Reply[0].postId));
      if (!this.IsAdmin() && lockCount[0].count === 1) {
        return new Result(false, "讨论已被锁定");
      }

      Data["Content"] = Data["Content"].trim();
      if (Data["Content"] === "") {
        return new Result(false, "内容不能为空");
      }
      if (this.IsSilenced()) {
        return new Result(false, "您已被禁言，无法编辑回复");
      }
      const MentionPeople = new Array<string>();
      // @ts-ignore
      for (const Match of String(Data["Content"]).matchAll(/@([a-zA-Z0-9]+)/g)) {
        if (ThrowErrorIfFailed(await this.IfUserExistChecker(Match[1]))["Exist"]) {
          MentionPeople.push(Match[1]);
        }
      }
      await this.XMOJDatabase.update(schema.bbsReply).set({
        content: Data["Content"],
        editTime: new Date().getTime(),
        editPerson: this.Username
      }).where(eq(schema.bbsReply.replyId, Data["ReplyID"]));
      for (const i in MentionPeople) {
        await this.AddBBSMention(MentionPeople[i], Reply[0].postId, Data["ReplyID"]);
      }
      return new Result(true, "编辑回复成功");
    },
    DeletePost: async (Data: object, CheckUserID: boolean = true): Promise<Result> => {
      ThrowErrorIfFailed(this.CheckParams(Data, {
        "PostID": "number"
      }));
      const Post = await this.XMOJDatabase.select({userId: schema.bbsPost.userId}).from(schema.bbsPost).where(eq(schema.bbsPost.postId, Data["PostID"]));
      if (Post.toString() === "") {
        return new Result(false, "删除失败，该讨论不存在");
      }
      const lockCount = await this.XMOJDatabase.select({count: count()}).from(schema.bbsLock).where(eq(schema.bbsLock.postId, Data["PostID"]));
      if (!this.IsAdmin() && lockCount[0].count === 1) {
        return new Result(false, "讨论已被锁定");
      }
      if (!this.IsAdmin() && CheckUserID && Post[0].userId !== this.Username) {
        return new Result(false, "没有权限删除此讨论");
      }
      await this.XMOJDatabase.delete(schema.bbsReply).where(eq(schema.bbsReply.postId, Data["PostID"]));
      await this.XMOJDatabase.delete(schema.bbsPost).where(eq(schema.bbsPost.postId, Data["PostID"]));
      return new Result(true, "删除讨论成功");
    },
    DeleteReply: async (Data: object): Promise<Result> => {
      ThrowErrorIfFailed(this.CheckParams(Data, {
        "ReplyID": "number"
      }));
      const Reply = await this.XMOJDatabase.select({
        userId: schema.bbsReply.userId,
        postId: schema.bbsReply.postId
      }).from(schema.bbsReply).where(eq(schema.bbsReply.replyId, Data["ReplyID"]));
      if (Reply.toString() === "") {
        return new Result(false, "删除失败，该讨论不存在");
      }
      const lockCount = await this.XMOJDatabase.select({count: count()}).from(schema.bbsLock).where(eq(schema.bbsLock.postId, Reply[0].postId));
      if (!this.IsAdmin() && lockCount[0].count === 1) {
        return new Result(false, "讨论已被锁定");
      }
      if (!this.IsAdmin() && Reply[0].userId !== this.Username) {
        return new Result(false, "没有权限删除此回复");
      }
      const replyCount = await this.XMOJDatabase.select({count: count()}).from(schema.bbsReply).where(eq(schema.bbsReply.postId, Reply[0].postId));
      if (replyCount[0].count === 1) {
        await this.ProcessFunctions.DeletePost({PostID: Reply[0].postId}, false);
      }
      await this.XMOJDatabase.delete(schema.bbsReply).where(eq(schema.bbsReply.replyId, Data["ReplyID"]));
      return new Result(true, "删除回复成功");
    },
    GetBBSMentionList: async (Data: object): Promise<Result> => {
      ThrowErrorIfFailed(this.CheckParams(Data, {}));
      const ResponseData = {
        MentionList: new Array<Object>()
      };
      const Mentions = await this.XMOJDatabase.select({
        bbsMentionId: schema.bbsMention.bbsMentionId,
        postId: schema.bbsMention.postId,
        bbsMentionTime: schema.bbsMention.bbsMentionTime,
        replyId: schema.bbsMention.replyId
      }).from(schema.bbsMention).where(eq(schema.bbsMention.toUserId, this.Username));
      for (const i in Mentions) {
        const Mention = Mentions[i];
        const Post = await this.XMOJDatabase.select({
          userId: schema.bbsPost.userId,
          title: schema.bbsPost.title
        }).from(schema.bbsPost).where(eq(schema.bbsPost.postId, Mention.postId));
        if (Post.toString() === "") {
          continue;
        }
        //Calculate the page number
        const totalRepliesBeforeResult = await this.XMOJDatabase.select({ count: count() }).from(schema.bbsReply).where(and(
            eq(schema.bbsReply.postId, Mention.postId),
            lt(schema.bbsReply.replyTime, this.XMOJDatabase.select({replyTime: schema.bbsReply.replyTime}).from(schema.bbsReply).where(eq(schema.bbsReply.replyId, Mention.replyId)))
        ));
        const totalRepliesBefore = totalRepliesBeforeResult[0].count + 1;
        const pageNumber = Math.floor(Number(totalRepliesBefore) / 15) + 1;
        ResponseData.MentionList.push({
          MentionID: Mention.bbsMentionId,
          PostID: Mention.postId,
          PostTitle: Post[0].title,
          MentionTime: Mention.bbsMentionTime,
          PageNumber: pageNumber
        });
      }
      return new Result(true, "获得讨论提及列表成功", ResponseData);
    },
    GetMailMentionList: async (Data: object): Promise<Result> => {
      ThrowErrorIfFailed(this.CheckParams(Data, {}));
      const ResponseData = {
        MentionList: new Array<Object>()
      };
      const Mentions = await this.XMOJDatabase.select({
        mailMentionId: schema.shortMessageMention.mailMentionId,
        fromUserId: schema.shortMessageMention.fromUserId,
        mailMentionTime: schema.shortMessageMention.mailMentionTime
      }).from(schema.shortMessageMention).where(eq(schema.shortMessageMention.toUserId, this.Username));
      for (const i in Mentions) {
        const Mention = Mentions[i];
        ResponseData.MentionList.push({
          MentionID: Mention.mailMentionId,
          FromUserID: Mention.fromUserId,
          MentionTime: Mention.mailMentionTime
        });
      }
      return new Result(true, "获得短消息提及列表成功", ResponseData);
    },
    ReadBBSMention: async (Data: object): Promise<Result> => {
      ThrowErrorIfFailed(this.CheckParams(Data, {
        "MentionID": "number"
      }));
      const MentionData = await this.XMOJDatabase.select({toUserId: schema.bbsMention.toUserId}).from(schema.bbsMention).where(eq(schema.bbsMention.bbsMentionId, Data["MentionID"]));
      if (MentionData.toString() === "") {
        return new Result(false, "未找到提及");
      }
      if (MentionData[0].toUserId !== this.Username) {
        return new Result(false, "没有权限阅读此提及");
      }
      await this.XMOJDatabase.delete(schema.bbsMention).where(eq(schema.bbsMention.bbsMentionId, Data["MentionID"]));
      return new Result(true, "阅读讨论提及成功");
    },
    ReadMailMention: async (Data: object): Promise<Result> => {
      ThrowErrorIfFailed(this.CheckParams(Data, {
        "MentionID": "number"
      }));
      const MentionData = await this.XMOJDatabase.select({toUserId: schema.shortMessageMention.toUserId}).from(schema.shortMessageMention).where(eq(schema.shortMessageMention.mailMentionId, Data["MentionID"]));
      if (MentionData.toString() === "") {
        return new Result(false, "未找到提及");
      }
      if (MentionData[0].toUserId !== this.Username) {
        return new Result(false, "没有权限阅读此提及");
      }
      await this.XMOJDatabase.delete(schema.shortMessageMention).where(eq(schema.shortMessageMention.mailMentionId, Data["MentionID"]));
      return new Result(true, "阅读短消息提及成功");
    },
    ReadUserMailMention: async (Data: object): Promise<Result> => {
      ThrowErrorIfFailed(this.CheckParams(Data, {
        "UserID": "string"
      }));
      await this.XMOJDatabase.delete(schema.shortMessageMention).where(and(eq(schema.shortMessageMention.fromUserId, Data["UserID"]), eq(schema.shortMessageMention.toUserId, this.Username)));
      return new Result(true, "阅读短消息提及成功");
    },
    GetMailList: async (Data: object): Promise<Result> => {
      ThrowErrorIfFailed(this.CheckParams(Data, {}));
      const ResponseData = {
        MailList: new Array<Object>()
      };
      const fromMails = await this.XMOJDatabase.selectDistinct({messageFrom: schema.shortMessage.messageFrom}).from(schema.shortMessage).where(eq(schema.shortMessage.messageTo, this.Username));
      const toMails = await this.XMOJDatabase.selectDistinct({messageTo: schema.shortMessage.messageTo}).from(schema.shortMessage).where(eq(schema.shortMessage.messageFrom, this.Username));
      let OtherUsernameList = [...fromMails.map(m => m.messageFrom), ...toMails.map(m => m.messageTo)];
      OtherUsernameList = Array.from(new Set(OtherUsernameList));

      for (const i in OtherUsernameList) {
        const otherUser = OtherUsernameList[i];
        const lastMessage = await this.XMOJDatabase.select({
          content: schema.shortMessage.content,
          sendTime: schema.shortMessage.sendTime,
          messageFrom: schema.shortMessage.messageFrom,
          messageTo: schema.shortMessage.messageTo
        }).from(schema.shortMessage).where(or(
            and(eq(schema.shortMessage.messageFrom, otherUser), eq(schema.shortMessage.messageTo, this.Username)),
            and(eq(schema.shortMessage.messageFrom, this.Username), eq(schema.shortMessage.messageTo, otherUser))
        )).orderBy(desc(schema.shortMessage.sendTime)).limit(1);

        if (lastMessage.length > 0) {
          let content = lastMessage[0].content;
          if (content.startsWith("Begin xssmseetee v2 encrypted message")) {
            try {
              const bytes = CryptoJS.AES.decrypt(content.substring(37), this.shortMessageEncryptKey_v1 + lastMessage[0].messageFrom + lastMessage[0].messageTo);
              content = bytes.toString(CryptoJS.enc.Utf8);
            } catch (error) {
              content = "解密失败: " + error.message;
            }
          } else if (content.startsWith("Begin xssmseetee v1 encrypted message")) { //deprecated
            try {
              const bytes = CryptoJS.AES.decrypt(content.substring(37), this.shortMessageEncryptKey_v1);
              content = bytes.toString(CryptoJS.enc.Utf8);
            } catch (error) {
              content = "解密失败: " + error.message;
            }
          } else {
            content = "无法解密消息, 原始数据: " + content;
          }
          const unreadCountResult = await this.XMOJDatabase.select({count: count()}).from(schema.shortMessage).where(and(
              eq(schema.shortMessage.messageFrom, otherUser),
              eq(schema.shortMessage.messageTo, this.Username),
              eq(schema.shortMessage.isRead, 0)
          ));

          ResponseData.MailList.push({
            OtherUser: otherUser,
            LastsMessage: content,
            SendTime: lastMessage[0].sendTime,
            UnreadCount: unreadCountResult[0].count
          });
        }
      }
      ResponseData.MailList.sort((a, b) => {
        return a["SendTime"] < b["SendTime"] ? 1 : -1;
      });
      return new Result(true, "获得短消息列表成功", ResponseData);
    },
    SendMail: async (Data: object): Promise<Result> => {
      ThrowErrorIfFailed(this.CheckParams(Data, {
        "ToUser": "string",
        "Content": "string"
      }));
      if (this.DenyMessage()) {
        return new Result(false, "该用户已关闭短消息接收");
      }
      if (Data["Content"].startsWith("您好，我是") && ThrowErrorIfFailed(await this.IfUserExistChecker(Data["ToUser"]))["Exist"] === false) {
        return new Result(false, "未找到用户");
      }
      if (Data["ToUser"] === this.Username) {
        return new Result(false, "无法给自己发送短消息");
      }
      if (Data["Content"].length > 2000) {
        return new Result(false, "短消息过长");
      }
      if ((!(this.AdminUserList.indexOf(Data["ToUser"]) !== -1)) && this.IsSilenced()) {
        return new Result(false, "你已被禁言, 无法向非管理员发送短消息");
      }
      let encryptedContent = "Begin xssmseetee v2 encrypted message" + CryptoJS.AES.encrypt(Data["Content"], this.shortMessageEncryptKey_v1 + this.Username + Data["ToUser"]).toString();
      const message = await this.XMOJDatabase.insert(schema.shortMessage).values({
        messageFrom: this.Username,
        messageTo: Data["ToUser"],
        content: encryptedContent,
        sendTime: new Date().getTime()
      }).returning({insertedId: schema.shortMessage.messageId});
      await this.AddMailMention(this.Username, Data["ToUser"]);
      return new Result(true, "发送短消息成功", {
        MessageID: message[0].insertedId
      });
    },
    GetMail: async (Data: object): Promise<Result> => {
      ThrowErrorIfFailed(this.CheckParams(Data, {
        "OtherUser": "string"
      }));
      const ResponseData = {
        Mail: new Array<Object>()
      };

      const Mails = await this.XMOJDatabase.select().from(schema.shortMessage).where(or(
          and(eq(schema.shortMessage.messageFrom, Data["OtherUser"]), eq(schema.shortMessage.messageTo, this.Username)),
          and(eq(schema.shortMessage.messageFrom, this.Username), eq(schema.shortMessage.messageTo, Data["OtherUser"]))
      )).orderBy(desc(schema.shortMessage.sendTime));

      for (const i in Mails) {
        const Mail = Mails[i];
        let content = Mail.content;
        if (content.startsWith("Begin xssmseetee v2 encrypted message")) {
          try {
            const bytes = CryptoJS.AES.decrypt(content.substring(37), this.shortMessageEncryptKey_v1 + Mail.messageFrom + Mail.messageTo);
            content = bytes.toString(CryptoJS.enc.Utf8);
          } catch (error) {
            content = "解密失败: " + error.message;
          }
        } else if (content.startsWith("Begin xssmseetee v1 encrypted message")) {
          try {
            const bytes = CryptoJS.AES.decrypt(content.substring(37), this.shortMessageEncryptKey_v1);
            content = bytes.toString(CryptoJS.enc.Utf8);
          } catch (error) {
            content = "解密失败: " + error.message;
          }
        } else {
          content = "无法解密消息, 原始数据: " + content;
        }
        ResponseData.Mail.push({
          MessageID: Mail.messageId,
          FromUser: Mail.messageFrom,
          ToUser: Mail.messageTo,
          Content: content,
          SendTime: Mail.sendTime,
          IsRead: Mail.isRead
        });
      }
      await this.XMOJDatabase.update(schema.shortMessage).set({isRead: 1}).where(and(
          eq(schema.shortMessage.messageFrom, Data["OtherUser"]),
          eq(schema.shortMessage.messageTo, this.Username)
      ));
      return new Result(true, "获得短消息成功", ResponseData);
    },
    UploadStd: async (Data: object): Promise<Result> => {
      ThrowErrorIfFailed(this.CheckParams(Data, {
        "ProblemID": "number"
      }));
      const ProblemID = Data["ProblemID"];
      if (ProblemID === 0) {
        return new Result(true, "ProblemID不能为0, 已忽略"); //this isn't really an error, so we return true
      }
      const stdCount = await this.XMOJDatabase.select({count: count()}).from(schema.stdAnswer).where(eq(schema.stdAnswer.problemId, ProblemID));
      if (stdCount[0].count !== 0) {
        let currentStdList = await this.kv.get("std_list");
        console.log(currentStdList.toString().indexOf(Data["ProblemID"].toString()));
        if (currentStdList.split('\n').some(d => d === Data["ProblemID"])) {
          currentStdList = currentStdList + Data["ProblemID"] + "\n";
          this.kv.put("std_list", currentStdList);
        }
        console.log("ProblemID: " + ProblemID + " already has a std answer, skipping upload.");
        return new Result(true, "此题已经有人上传标程");
      }
      if (await this.GetProblemScoreChecker(ProblemID) !== 100) {
        return new Result(false, "没有权限上传此标程");
      }
      let StdCode: string = "";
      let PageIndex: number = 0;
      while (StdCode === "") {
        await this.Fetch(new URL("https://www.xmoj.tech/problemstatus.php?id=" + ProblemID + "&page=" + PageIndex))
          .then((Response) => {
            return Response.text();
          }).then(async (Response) => {
            if (Response.indexOf("[NEXT]") === -1) {
              StdCode = "这道题没有标程（即用户std没有AC这道题）";
              return;
            }
            const ParsedDocument: CheerioAPI = load(Response);
            const SubmitTable = ParsedDocument("#problemstatus");
            if (SubmitTable.length == 0) {
              Output.Error("Get Std code failed: Cannot find submit table\n" +
                "ProblemID: \"" + ProblemID + "\"\n" +
                "Username : \"" + this.Username + "\"\n");
              ThrowErrorIfFailed(new Result(false, "获取标程失败"));
            }
            const SubmitTableBody = SubmitTable.children().eq(1);
            for (let i = 1; i < SubmitTableBody.children().length; i++) {
              const SubmitRow = SubmitTableBody.children().eq(i);
              if (SubmitRow.children().eq(2).text().trim() === "std") {
                let SID: string = SubmitRow.children().eq(1).text();
                if (SID.indexOf("(") != -1) {
                  SID = SID.substring(0, SID.indexOf("("));
                }
                await this.Fetch(new URL("https://www.xmoj.tech/getsource.php?id=" + SID))
                  .then((Response) => {
                    return Response.text();
                  })
                  .then((Response) => {
                    Response = Response.substring(0, Response.indexOf("<!--not cached-->")).trim();
                    if (Response === "I am sorry, You could not view this code!") {
                      Output.Error("Get Std code failed: Cannot view code\n" +
                        "ProblemID: \"" + ProblemID + "\"\n" +
                        "Username : \"" + this.Username + "\"\n");
                      ThrowErrorIfFailed(new Result(false, "获取标程失败"));
                    }
                    Response = Response.substring(0, Response.indexOf("/**************************************************************")).trim();
                    StdCode = Response;
                  });
              }
            }
          }).catch((Error) => {
            Output.Error("Get Std code failed: " + Error + "\n" +
              "ProblemID: \"" + ProblemID + "\"\n" +
              "Username : \"" + this.Username + "\"\n");
            ThrowErrorIfFailed(new Result(false, "获取标程失败"));
          });
        PageIndex++;
      }
      if (StdCode === "这道题没有标程（即用户std没有AC这道题）") {
        StdCode = "";
        let SID: string = "0";
        await this.Fetch(new URL("https://www.xmoj.tech/status.php?problem_id=" + ProblemID + "&jresult=4"))
          .then((response) => {
            return response.text();
          }).then((body) => {
            const $ = load(body);
            SID = $(".oddrow > td:nth-child(2)").html();
          }).catch((Error) => {
            Output.Error("Get Std code failed: " + Error + "\n" +
              "ProblemID: \"" + ProblemID + "\"\n" +
              "Username : \"" + this.Username + "\"\n");
            ThrowErrorIfFailed(new Result(false, "获取SID失败"));
          });
        await this.Fetch(new URL("https://www.xmoj.tech/getsource.php?id=" + SID))
          .then((Response) => {
            return Response.text();
          }).then((Response) => {
            StdCode = Response.substring(0, Response.indexOf("/**************************************************************")).trim();
          })
          .catch((Error) => {
            Output.Error("Get Std code failed: " + Error + "\n" +
              "ProblemID: \"" + ProblemID + "\"\n" +
              "Username : \"" + this.Username + "\"\n");
            ThrowErrorIfFailed(new Result(false, "获取标程失败"));
          });
        StdCode = '//Code by ' + this.Username + '\n' + StdCode;
      }
      await this.XMOJDatabase.insert(schema.stdAnswer).values({
        problemId: Data["ProblemID"],
        stdCode: StdCode
      });
      let currentStdList = await this.kv.get("std_list");
      currentStdList = currentStdList + Data["ProblemID"] + "\n";
      this.kv.put("std_list", currentStdList);
      return new Result(true, "标程上传成功");
    },
    GetStdList: async (Data: object): Promise<Result> => {
      ThrowErrorIfFailed(this.CheckParams(Data, {}));
      const ResponseData = {
        StdList: new Array<number>()
      };
      ResponseData.StdList = (await this.kv.get("std_list")).split("\n").map(Number);
      return new Result(true, "获得标程列表成功", ResponseData);
    },
    GetStd: async (Data: object): Promise<Result> => {
      ThrowErrorIfFailed(this.CheckParams(Data, {
        "ProblemID": "number"
      }));
      if (await this.GetProblemScoreChecker(Data["ProblemID"]) < 50) {
        return new Result(false, "没有权限获取此标程");
      }
      const Std = await this.XMOJDatabase.select({stdCode: schema.stdAnswer.stdCode}).from(schema.stdAnswer).where(eq(schema.stdAnswer.problemId, Data["ProblemID"]));
      if (Std.toString() === "") {
        return new Result(false, "此题还没有人上传标程");
      }
      return new Result(true, "获得标程成功", {
        "StdCode": Std[0].stdCode
      });
    },
    NewBadge: async (Data: object): Promise<Result> => {
      ThrowErrorIfFailed(this.CheckParams(Data, {
        "UserID": "string"
      }));
      if (!this.IsAdmin()) {
        return new Result(false, "没有权限创建此标签");
      }
      await this.XMOJDatabase.insert(schema.badge).values({
        userId: Data["UserID"]
      });
      return new Result(true, "创建标签成功");
    },
    EditBadge: async (Data: object): Promise<Result> => {
      ThrowErrorIfFailed(this.CheckParams(Data, {
        "UserID": "string",
        "BackgroundColor": "string",
        "Color": "string",
        "Content": "string"
      }));
      if (!this.IsAdmin() && Data["UserID"] !== this.Username) {
        return new Result(false, "没有权限编辑此标签");
      }
      const badgeCount = await this.XMOJDatabase.select({count: count()}).from(schema.badge).where(eq(schema.badge.userId, Data["UserID"]));
      if (badgeCount[0].count === 0) {
        return new Result(false, "编辑失败，该标签在数据库中不存在");
      }
      if (this.DenyEdit()) {
        return new Result(false, "你被禁止修改标签");
      }
      if (Data["Content"].length > 20) {
        return new Result(false, "标签内容过长");
      }
      if (Data["Content"].includes("管理员") || Data["Content"].toLowerCase().includes("manager") || Data["Content"].toLowerCase().includes("admin")) {
        return new Result(false, "请不要试图冒充管理员");
      }
      const allowedPattern = /^[\u0000-\u007F\u4E00-\u9FFF\u3400-\u4DBF\u2000-\u206F\u3000-\u303F\uFF00-\uFFEF\uD83C-\uDBFF\uDC00-\uDFFF]*$/;
      if (!allowedPattern.test(Data["Content"])) {
        return new Result(false, "内容包含不允许的字符，导致渲染问题");
      }
      if (Data["Content"].trim() === "") {
        return new Result(false, "内容不能仅包含空格");
      }
      const check = await this.AI.run(
        "@cf/huggingface/distilbert-sst-2-int8",
        {
          text: Data["Content"],
        }
      );
      if (check[check[0]["label"] == "NEGATIVE" ? 0 : 1]["score"].toFixed() > 0.90) {
        return new Result(false, "您设置的标签内容含有负面词汇，请修改后重试");
      }
      await this.XMOJDatabase.update(schema.badge).set({
        backgroundColor: Data["BackgroundColor"],
        color: Data["Color"],
        content: Data["Content"]
      }).where(eq(schema.badge.userId, Data["UserID"]));
      return new Result(true, "编辑标签成功");
    },
    GetBadge: async (Data: object): Promise<Result> => {
      ThrowErrorIfFailed(this.CheckParams(Data, {
        "UserID": "string"
      }));
      const BadgeData = await this.XMOJDatabase.select({
        backgroundColor: schema.badge.backgroundColor,
        color: schema.badge.color,
        content: schema.badge.content
      }).from(schema.badge).where(eq(schema.badge.userId, Data["UserID"]));
      if (BadgeData.toString() == "") {
        return new Result(false, "获取标签失败，该标签在数据库中不存在");
      }
      return new Result(true, "获得标签成功", {
        Content: BadgeData[0].content,
        BackgroundColor: Data["UserID"] === "zhouyiqing" ? "#000000" : BadgeData[0].backgroundColor,
        Color: Data["UserID"] === "zhouyiqing" ? "#ffffff" : BadgeData[0].color
      });
    },
    DeleteBadge: async (Data: object): Promise<Result> => {
      ThrowErrorIfFailed(this.CheckParams(Data, {
        "UserID": "string"
      }));
      if (!this.IsAdmin()) {
        return new Result(false, "没有权限删除此标签");
      }
      await this.XMOJDatabase.delete(schema.badge).where(eq(schema.badge.userId, Data["UserID"]));
      return new Result(true, "删除标签成功");
    },
    GetBoards: async (Data: object): Promise<Result> => {
      ThrowErrorIfFailed(this.CheckParams(Data, {}));
      const BoardsData = await this.XMOJDatabase.select().from(schema.bbsBoard);
      const Boards = BoardsData.map(Board => ({
        BoardID: Board.boardId,
        BoardName: Board.boardName
      }));
      return new Result(true, "获得板块列表成功", {
        "Boards": Boards
      });
    },
    UploadImage: async (Data: object): Promise<Result> => {
      const GithubImageRepo = "XMOJ-Script-dev/XMOJ-Script-Pictures";
      ThrowErrorIfFailed(this.CheckParams(Data, {
        "Image": "string"
      }));
      const Image: string = Data["Image"];
      let ImageID: string = "";
      for (let i = 0; i < 32; i++) {
        ImageID += String.fromCharCode(Math.floor(Math.random() * 26) + 97);
      }
      const ImageData = Image.replace(/^data:image\/\w+;base64,/, "");
      await fetch(new URL("https://api.github.com/repos/" + GithubImageRepo + "/contents/" + ImageID), {
        method: "PUT",
        headers: {
          "Authorization": "Bearer " + this.GithubImagePAT,
          "Content-Type": "application/json",
          "User-Agent": "XMOJ-Script-Server"
        },
        body: JSON.stringify({
          message: `${this.Username} ${new Date().getFullYear()}/${new Date().getMonth() + 1}/${new Date().getDate()} ${new Date().getHours()}:${new Date().getMinutes()}:${new Date().getSeconds()}`,
          content: ImageData
        })
      }).then((Response) => {
        return Response.json();
      }).then((Response) => {
        if (Response["content"]["name"] !== ImageID) {
          Output.Error("Upload image failed\n" +
            "Username: \"" + this.Username + "\"\n" +
            "ImageID : \"" + ImageID + "\"\n" +
            "Response: \"" + JSON.stringify(Response) + "\"\n");
          ThrowErrorIfFailed(new Result(false, "上传图片失败"));
        }
      }).catch((Error) => {
        Output.Error("Upload image failed: " + Error + "\n" +
          "Username: \"" + this.Username + "\"\n" +
          "ImageID : \"" + ImageID + "\"\n");
        ThrowErrorIfFailed(new Result(false, "上传图片失败"));
      });
      return new Result(true, "上传图片成功", {
        ImageID: ImageID
      });
    },
    GetImage: async (Data: object): Promise<Blob> => {
      const GithubImageRepo = "XMOJ-Script-dev/XMOJ-Script-Pictures";
      ThrowErrorIfFailed(this.CheckParams(Data, {
        "ImageID": "string"
      }));
      return await fetch(new URL("https://api.github.com/repos/" + GithubImageRepo + "/contents/" + Data["ImageID"] + "?1=1"), {
        method: "GET",
        headers: {
          "Authorization": "Bearer " + this.GithubImagePAT,
          "Accept": "application/vnd.github.v3.raw",
          "User-Agent": "XMOJ-Script-Server"
        }
      }).then((Response) => {
        return Response.blob();
      }).catch((Error) => {
        Output.Error("Get image failed: " + Error + "\n" +
          "ImageID : \"" + Data["ImageID"] + "\"\n");
        return new Blob();
      });
    },
    SendData: async (): Promise<Result> => {
      //instantly return
      return new Result(true, "数据发送成功");
    },
    GetAnalytics: async (Data: object): Promise<Result> => {
      ThrowErrorIfFailed(this.CheckParams(Data, {
        "Username": "string"
      }));
      if (Data["Username"] !== this.Username && !this.IsAdmin()) {
        return new Result(false, "没有权限获取此用户日志");
      }

      const sanitizedUsername = sqlstring.escape(Data["Username"]);
      const query = `SELECT index1 AS username,
                            blob1  AS IP,
                            blob2  AS Path,
                            blob3  AS Version,
                            blob4  AS DebugMode, timestamp
                     FROM logdb
                     WHERE index1=${sanitizedUsername}
                     ORDER BY timestamp ASC`;

      const API = `https://api.cloudflare.com/client/v4/accounts/${this.ACCOUNT_ID}/analytics_engine/sql`;
      const response = await fetch(API, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.API_TOKEN}`,
        },
        body: query,
      });
      const responseJSON = await response.json();
      return new Result(true, "获得统计数据成功", responseJSON);
    },
    LastOnline: async (Data: object): Promise<Result> => {
      ThrowErrorIfFailed(this.CheckParams(Data, {
        "Username": "string"
      }));
      const username = Data["Username"];
      const sanitizedUsername = sqlstring.escape(username);
      const query = `SELECT timestamp
                     FROM logdb
                     WHERE index1=${sanitizedUsername}
                     ORDER BY timestamp DESC LIMIT 1`;
      const API = `https://api.cloudflare.com/client/v4/accounts/${this.ACCOUNT_ID}/analytics_engine/sql`;
      const response = await fetch(API, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.API_TOKEN}`,
        },
        body: query,
      });
      const responseJSON = await response.json();
      // parse json and return ["data"][0][timestamp]
      if (responseJSON.data && responseJSON.data.length > 0) {
        const timestamp = responseJSON.data[0].timestamp;
        const unixTime = Date.parse(timestamp);
        return new Result(true, "获得最近在线时间成功", {"logintime": unixTime});
      } else {
        return new Result(false, "获得最近在线时间失败", {});
      }
    }
  };

  constructor(RequestData: Request, Environment: Environment) {
    this.XMOJDatabase = getDrizzle(Environment.DB);
    this.AI = Environment.AI;
    this.kv = Environment.kv;
    this.logs = Environment.logdb;
    this.CaptchaSecretKey = Environment.CaptchaSecretKey;
    this.GithubImagePAT = Environment.GithubImagePAT;
    this.ACCOUNT_ID = Environment.ACCOUNT_ID;
    this.API_TOKEN = Environment.API_TOKEN;
    this.shortMessageEncryptKey_v1 = Environment.xssmseetee_v1_key;
    this.RequestData = RequestData;
    this.RemoteIP = RequestData.headers.get("CF-Connecting-IP") || "";
  }

  public async Process(): Promise<Response> {
    try {
      let PathName = new URL(this.RequestData.url).pathname;
      PathName = PathName === "/" ? "/GetNotice" : PathName;
      PathName = PathName.substring(1);
      if (PathName === "GetNotice") {
        const notice = await this.kv.get("noticeboard");
        let resp: Result;
        if (notice === null) {
          resp = new Result(false, "未找到公告");
        } else {
          resp = new Result(true, "获得公告成功", {"Notice": notice});
        }
        return new Response(JSON.stringify(resp), {
          headers: {
            "content-type": "application/json;charset=UTF-8"
          }
        });
      } else if (PathName === "GetAddOnScript") {
        const script = await this.kv.get("addonscript");
        let resp: Result;
        if (script === null) {
          resp = new Result(false, "未找到插件脚本");
        } else {
          resp = new Result(true, "获得插件脚本成功", {"Script": script});
        }
        return new Response(JSON.stringify(resp), {
          headers: {
            "content-type": "application/json;charset=UTF-8"
          }
        });
      }
      if (this.ProcessFunctions[PathName] === undefined) {
        throw new Result(false, "访问的页面不存在");
      }
      if (this.RequestData.method === "GET" && PathName === "GetImage") {
        return new Response(await this.ProcessFunctions[PathName]({
          ImageID: new URL(this.RequestData.url).searchParams.get("ImageID")
        }), {
          headers: {
            "content-type": "image/png"
          }
        });
      }
      if (this.RequestData.method !== "POST") {
        throw new Result(false, "不允许此请求方式");
      }
      if (this.RequestData.headers.get("content-type") !== "application/json") {
        throw new Result(false, "不允许此资源类型");
      }
      let RequestJSON: object;
      try {
        RequestJSON = await this.RequestData.json();
      } catch (Error) {
        throw new Result(false, "请求格式有误");
      }
      ThrowErrorIfFailed(this.CheckParams(RequestJSON, {
        "Authentication": "object",
        "Data": "object",
        "Version": "string",
        "DebugMode": "boolean"
      }));
      let TokenFailedCount = 0;
      while (true) {
        if ((await this.CheckToken(RequestJSON["Authentication"])).Data["Success"]) {
          break;
        }
        TokenFailedCount++;
        if (TokenFailedCount >= 2) {
          ThrowErrorIfFailed(await this.CheckToken(RequestJSON["Authentication"]));
          break;
        }
      }
      this.logs.writeDataPoint({
        'blobs': [this.RemoteIP, PathName, RequestJSON["Version"], RequestJSON["DebugMode"]],
        'indexes': [this.Username]
      });
      throw await this.ProcessFunctions[PathName](RequestJSON["Data"]);
    } catch (ResponseData) {
      if (!(ResponseData instanceof Result)) {
        Output.Error(ResponseData);
        ResponseData = new Result(false, "服务器运行错误：" + String(ResponseData).split("\n")[0]);
      }
      let pathname = new URL(this.RequestData.url).pathname;
      return new Response(pathname == "/GetStd" ? this.processCppString(JSON.stringify(ResponseData)) : JSON.stringify(ResponseData), {
        headers: {
          "content-type": "application/json;charset=UTF-8"
        }
      });
    }
  }
}
