// noinspection ExceptionCaughtLocallyJS,JSUnusedGlobalSymbols

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

import {Result, ThrowErrorIfFailed} from "./Result";
import {Database} from "./Database";
import {Output} from "./Output";
import {CheerioAPI, load} from "cheerio";
import * as sqlstring from 'sqlstring';
// @ts-ignore
import CryptoJS from "crypto-js";
import {D1Database, KVNamespace, AnalyticsEngineDataset} from "@cloudflare/workers-types";

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

function sleep(time: number) {
  return new Promise((resolve) => setTimeout(resolve, time));
}

export class Process {
  private AdminUserList: Array<string> = ["chenlangning", "shanwenxiao"];
  private DenyMessageList: Array<string> = [];
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
  private XMOJDatabase: Database;
  private readonly logs: AnalyticsEngineDataset;
  private RequestData: Request;
  private Fetch = async (RequestURL: URL): Promise<Response> => {
    Output.Log("Fetch: " + RequestURL.toString());
    const Abort = new AbortController();
    setTimeout(() => {
      Abort.abort();
    }, 5000);
    const RequestData = new Request(RequestURL, {
      headers: {
        "Cookie": "PHPSESSID=" + this.SessionID
      },
      signal: Abort.signal
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
    const CurrentSessionData = ThrowErrorIfFailed(await this.XMOJDatabase.Select("phpsessid", ["user_id", "create_time"], {
      token: HashedToken
    }));
    if (CurrentSessionData.toString() !== "") {
      if (CurrentSessionData[0]["user_id"] === this.Username &&
        CurrentSessionData[0]["create_time"] + 1000 * 60 * 60 * 24 * 7 > new Date().getTime()) {
        return new Result(true, "令牌匹配");
      } else {
        ThrowErrorIfFailed(await this.XMOJDatabase.Delete("phpsessid", {
          token: HashedToken
        }));
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
    if (ThrowErrorIfFailed(await this.XMOJDatabase.GetTableSize("phpsessid", {
      token: HashedToken
    }))["TableSize"] == 0) {
      ThrowErrorIfFailed(await this.XMOJDatabase.Insert("phpsessid", {
        token: HashedToken,
        user_id: this.Username,
        create_time: new Date().getTime()
      }));
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
    if (ThrowErrorIfFailed(await this.XMOJDatabase.GetTableSize("phpsessid", {
      user_id: Username
    }))["TableSize"] !== 0) {
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
        return new Result(false, "用户检查失败");
      });
  }
  public IfUserExistChecker = async (Username: string): Promise<Result> => {
    let rst = this.IfUserExist(Username);
    if (rst["Success"]) {
      return rst;
    }
    //if failed try again
    const retryCount = 20; // Define how many times you want to retry
    for (let i = 0; i < retryCount; i++) {
      rst = this.IfUserExist(Username);
      if (rst["Success"]) {
        return rst;
      }
      await sleep(500);
    }
    return rst;
  }
  public IsAdmin = (): boolean => {
    return this.AdminUserList.indexOf(this.Username) !== -1;
  }
  public DenyMessage = (): boolean => {
    return this.DenyMessageList.indexOf(this.Username) !== -1;
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
    let rst = await this.GetProblemScore(ProblemID);
    if (rst !== 0) {
      return rst;
    }
    //if failed try again
    const retryCount = 20; // Define how many times you want to retry
    for (let i = 0; i < retryCount; i++) {
      rst = await this.GetProblemScore(ProblemID);
      if (rst !== 0) {
        return rst;
      }
      await sleep(500);
    }
    ThrowErrorIfFailed(new Result(false, "获取题目分数失败"));
  }
  private AddBBSMention = async (ToUserID: string, PostID: number): Promise<void> => {
    if (ToUserID === this.Username) {
      return;
    }
    if (ThrowErrorIfFailed(await this.XMOJDatabase.GetTableSize("bbs_mention", {
      to_user_id: ToUserID,
      post_id: PostID
    }))["TableSize"] === 0) {
      ThrowErrorIfFailed(await this.XMOJDatabase.Insert("bbs_mention", {
        to_user_id: ToUserID,
        post_id: PostID,
        bbs_mention_time: new Date().getTime()
      }));
    } else {
      ThrowErrorIfFailed(await this.XMOJDatabase.Update("bbs_mention", {
        bbs_mention_time: new Date().getTime()
      }, {
        to_user_id: ToUserID,
        post_id: PostID
      }));
    }
  };
  private AddMailMention = async (FromUserID: string, ToUserID: string): Promise<void> => {
    if (ThrowErrorIfFailed(await this.XMOJDatabase.GetTableSize("short_message_mention", {
      from_user_id: FromUserID,
      to_user_id: ToUserID
    }))["TableSize"] === 0) {
      ThrowErrorIfFailed(await this.XMOJDatabase.Insert("short_message_mention", {
        from_user_id: FromUserID,
        to_user_id: ToUserID,
        mail_mention_time: new Date().getTime()
      }));
    } else {
      ThrowErrorIfFailed(await this.XMOJDatabase.Update("short_message_mention", {
        mail_mention_time: new Date().getTime()
      }, {
        from_user_id: FromUserID,
        to_user_id: ToUserID
      }));
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
      if (Data["BoardID"] !== 0 && ThrowErrorIfFailed(await this.XMOJDatabase.GetTableSize("bbs_board", {
        board_id: Data["BoardID"]
      }))["TableSize"] === 0) {
        return new Result(false, "该板块不存在");
      }
      const PostID = ThrowErrorIfFailed(await this.XMOJDatabase.Insert("bbs_post", {
        user_id: this.Username,
        problem_id: Data["ProblemID"],
        title: Data["Title"],
        post_time: new Date().getTime(),
        board_id: Data["BoardID"]
      }))["InsertID"];
      const ReplyID = ThrowErrorIfFailed(await this.XMOJDatabase.Insert("bbs_reply", {
        user_id: this.Username,
        post_id: PostID,
        content: Data["Content"],
        reply_time: new Date().getTime()
      }))["InsertID"];
      return new Result(true, "创建讨论成功", {
        PostID: PostID,
        ReplyID: ReplyID
      });
    },
    NewReply: async (Data: object): Promise<Result> => {
      ThrowErrorIfFailed(this.CheckParams(Data, {
        "PostID": "number",
        "Content": "string",
        "CaptchaSecretKey": "string"
      }));
      ThrowErrorIfFailed(await this.VerifyCaptcha(Data["CaptchaSecretKey"]));
      const Post = ThrowErrorIfFailed(await this.XMOJDatabase.Select("bbs_post", ["title", "user_id", "board_id"], {post_id: Data["PostID"]}));
      if (Post.toString() == "") {
        return new Result(false, "该讨论不存在");
      }
      //console.log(Post[0]["board_id"]);
      if (Post[0]["board_id"] == 5) {
        return new Result(false, "此讨论不允许回复");
      }
      //check if the post is locked
      if (ThrowErrorIfFailed(await this.XMOJDatabase.GetTableSize("bbs_lock", {
        post_id: Data["PostID"]
      }))["TableSize"] === 1 && !this.IsAdmin()) {
        return new Result(false, "讨论已被锁定");
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
      const ReplyID = ThrowErrorIfFailed(await this.XMOJDatabase.Insert("bbs_reply", {
        user_id: this.Username,
        post_id: Data["PostID"],
        content: Data["Content"],
        reply_time: new Date().getTime()
      }))["InsertID"];

      for (const i in MentionPeople) {
        await this.AddBBSMention(MentionPeople[i], Data["PostID"]);
      }

      if (Post[0]["user_id"] !== this.Username) {
        await this.AddBBSMention(Post[0]["user_id"], Data["PostID"]);
      }

      return new Result(true, "创建回复成功", {
        ReplyID: ReplyID
      });
    },
    GetPosts: async (Data: object): Promise<Result> => {
      ThrowErrorIfFailed(this.CheckParams(Data, {
        "ProblemID": "number",
        "Page": "number",
        "BoardID": "number"
      }));
      let ResponseData = {
        Posts: new Array<Object>,
        PageCount: Data["BoardID"] !== -1 ? (Data["ProblemID"] !== 0 ? Math.ceil(ThrowErrorIfFailed(await this.XMOJDatabase.GetTableSize("bbs_post", {
          board_id: Data["BoardID"],
          problem_id: Data["ProblemID"]
        }))["TableSize"] / 15) : Math.ceil(ThrowErrorIfFailed(await this.XMOJDatabase.GetTableSize("bbs_post", {
          board_id: Data["BoardID"]
        }))["TableSize"] / 15)) : (Data["ProblemID"] !== 0 ? Math.ceil(ThrowErrorIfFailed(await this.XMOJDatabase.GetTableSize("bbs_post", {
          problem_id: Data["ProblemID"]
        }))["TableSize"] / 15) : Math.ceil(ThrowErrorIfFailed(await this.XMOJDatabase.GetTableSize("bbs_post"))["TableSize"] / 15))
      };
      if (ResponseData.PageCount === 0) {
        return new Result(true, "获得讨论列表成功", ResponseData);
      }
      if (Data["Page"] < 1 || Data["Page"] > ResponseData.PageCount) {
        return new Result(false, "参数页数不在范围1~" + ResponseData.PageCount + "内");
      }
      const SearchCondition = {};
      if (Data["ProblemID"] !== 0) {
        SearchCondition["problem_id"] = Data["ProblemID"];
      }
      if (Data["BoardID"] !== -1) {
        SearchCondition["board_id"] = Data["BoardID"];
      }
      const Posts = ThrowErrorIfFailed(await this.XMOJDatabase.Select("bbs_post", [], SearchCondition, {
        Order: "post_id",
        OrderIncreasing: false,
        Limit: 15,
        Offset: (Data["Page"] - 1) * 15
      }));
      for (const i in Posts) {
        const Post = Posts[i];

        const ReplyCount: number = ThrowErrorIfFailed(await this.XMOJDatabase.GetTableSize("bbs_reply", {post_id: Post["post_id"]}))["TableSize"];
        const LastReply = ThrowErrorIfFailed(await this.XMOJDatabase.Select("bbs_reply", ["user_id", "reply_time"], {post_id: Post["post_id"]}, {
          Order: "reply_time",
          OrderIncreasing: false,
          Limit: 1
        }));
        if (ReplyCount === 0) {
          await this.XMOJDatabase.Delete("bbs_post", {
            post_id: Post["post_id"]
          });
          continue;
        }

        const LockData = {
          Locked: false,
          LockPerson: "",
          LockTime: 0
        };
        const Locked = ThrowErrorIfFailed(await this.XMOJDatabase.Select("bbs_lock", [], {
          post_id: Post["post_id"]
        }));
        if (Locked.toString() !== "") {
          LockData.Locked = true;
          LockData.LockPerson = Locked[0]["lock_person"];
          LockData.LockTime = Locked[0]["lock_time"];
        }

        ResponseData.Posts.push({
          PostID: Post["post_id"],
          UserID: Post["user_id"],
          ProblemID: Post["problem_id"],
          Title: Post["title"],
          PostTime: Post["post_time"],
          BoardID: Post["board_id"],
          BoardName: ThrowErrorIfFailed(await this.XMOJDatabase.Select("bbs_board", ["board_name"], {
            board_id: Post["board_id"]
          }))[0]["board_name"],
          ReplyCount: ReplyCount,
          LastReplyUserID: LastReply[0]["user_id"],
          LastReplyTime: LastReply[0]["reply_time"],
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
      const Post = ThrowErrorIfFailed(await this.XMOJDatabase.Select("bbs_post", [], {
        post_id: Data["PostID"]
      }));
      if (Post.toString() == "") {
        return new Result(false, "该讨论不存在");
      }
      ResponseData.PageCount = Math.ceil(ThrowErrorIfFailed(await this.XMOJDatabase.GetTableSize("bbs_reply", {post_id: Data["PostID"]}))["TableSize"] / 15);
      if (ResponseData.PageCount === 0) {
        return new Result(true, "获得讨论成功", ResponseData);
      }
      if (Data["Page"] < 1 || Data["Page"] > ResponseData.PageCount) {
        return new Result(false, "参数页数不在范围1~" + ResponseData.PageCount + "内");
      }
      ResponseData.UserID = Post[0]["user_id"];
      ResponseData.ProblemID = Post[0]["problem_id"];
      ResponseData.Title = Post[0]["title"];
      ResponseData.PostTime = Post[0]["post_time"];
      ResponseData.BoardID = Post[0]["board_id"];
      ResponseData.BoardName = ThrowErrorIfFailed(await this.XMOJDatabase.Select("bbs_board", ["board_name"], {board_id: Post[0]["board_id"]}))[0]["board_name"];

      const Locked = ThrowErrorIfFailed(await this.XMOJDatabase.Select("bbs_lock", [], {
        post_id: Data["PostID"]
      }));
      if (Locked.toString() !== "") {
        ResponseData.Lock.Locked = true;
        ResponseData.Lock.LockPerson = Locked[0]["lock_person"];
        ResponseData.Lock.LockTime = Locked[0]["lock_time"];
      }

      const Reply = ThrowErrorIfFailed(await this.XMOJDatabase.Select("bbs_reply", [], {post_id: Data["PostID"]}, {
        Order: "reply_time",
        OrderIncreasing: true,
        Limit: 15,
        Offset: (Data["Page"] - 1) * 15
      }));
      for (const i in Reply) {
        let ReplyItem = Reply[i];
        let processedContent: string = ReplyItem["content"];
        processedContent = processedContent.replace(/xmoj-bbs\.tech/g, "xmoj-bbs.me");
        ResponseData.Reply.push({
          ReplyID: ReplyItem["reply_id"],
          UserID: ReplyItem["user_id"],
          Content: processedContent,
          ReplyTime: ReplyItem["reply_time"],
          EditTime: ReplyItem["edit_time"],
          EditPerson: ReplyItem["edit_person"]
        });
      }
      return new Result(true, "获得讨论成功", ResponseData);
    },
    LockPost: async (Data: object): Promise<Result> => {
      ThrowErrorIfFailed(this.CheckParams(Data, {
        "PostID": "number"
      }));
      if (ThrowErrorIfFailed(await this.XMOJDatabase.GetTableSize("bbs_post", {
        post_id: Data["PostID"]
      }))["TableSize"] === 0) {
        return new Result(false, "该讨论不存在");
      }
      if (!this.IsAdmin()) {
        return new Result(false, "没有权限锁定此讨论");
      }
      if (ThrowErrorIfFailed(await this.XMOJDatabase.GetTableSize("bbs_lock", {
        post_id: Data["PostID"]
      }))["TableSize"] === 1) {
        return new Result(false, "讨论已经被锁定");
      }
      ThrowErrorIfFailed(await this.XMOJDatabase.Insert("bbs_lock", {
        post_id: Data["PostID"],
        lock_person: this.Username,
        lock_time: new Date().getTime()
      }));
      return new Result(true, "讨论锁定成功");
    },
    UnlockPost: async (Data: object): Promise<Result> => {
      ThrowErrorIfFailed(this.CheckParams(Data, {
        "PostID": "number"
      }));
      if (ThrowErrorIfFailed(await this.XMOJDatabase.GetTableSize("bbs_post", {
        post_id: Data["PostID"]
      }))["TableSize"] === 0) {
        return new Result(false, "解锁失败，该讨论不存在");
      }
      if (!this.IsAdmin()) {
        return new Result(false, "没有权限解锁此讨论");
      }
      if (ThrowErrorIfFailed(await this.XMOJDatabase.GetTableSize("bbs_lock", {
        post_id: Data["PostID"]
      }))["TableSize"] === 0) {
        return new Result(false, "讨论已经被解锁");
      }
      ThrowErrorIfFailed(await this.XMOJDatabase.Delete("bbs_lock", {
        post_id: Data["PostID"]
      }));
      return new Result(true, "讨论解锁成功");
    },
    EditReply: async (Data: object): Promise<Result> => {
      ThrowErrorIfFailed(this.CheckParams(Data, {
        "ReplyID": "number",
        "Content": "string"
      }));
      const Reply = ThrowErrorIfFailed(await this.XMOJDatabase.Select("bbs_reply", ["post_id", "user_id"], {
        reply_id: Data["ReplyID"]
      }));
      if (Reply.toString() === "") {
        return new Result(false, "编辑失败，未找到此回复");
      }
      if (!this.IsAdmin() && Reply[0]["user_id"] !== this.Username) {
        return new Result(false, "没有权限编辑此回复");
      }
      if (ThrowErrorIfFailed(await this.XMOJDatabase.GetTableSize("bbs_post", {
        post_id: Reply[0]["post_id"]
      }))["TableSize"] === 0) {
        return new Result(false, "编辑失败，该回复所属的讨论不存在");
      }

      if (!this.IsAdmin() && ThrowErrorIfFailed(await this.XMOJDatabase.GetTableSize("bbs_lock", {
        post_id: Reply[0]["post_id"]
      }))["TableSize"] === 1) {
        return new Result(false, "讨论已被锁定");
      }

      Data["Content"] = Data["Content"].trim();
      if (Data["Content"] === "") {
        return new Result(false, "内容不能为空");
      }
      const MentionPeople = new Array<string>();
      // @ts-ignore
      for (const Match of String(Data["Content"]).matchAll(/@([a-zA-Z0-9]+)/g)) {
        if (ThrowErrorIfFailed(await this.IfUserExistChecker(Match[1]))["Exist"]) {
          MentionPeople.push(Match[1]);
        }
      }
      await this.XMOJDatabase.Update("bbs_reply", {
        content: Data["Content"],
        edit_time: new Date().getTime(),
        edit_person: this.Username
      }, {
        reply_id: Data["ReplyID"]
      });
      for (const i in MentionPeople) {
        await this.AddBBSMention(MentionPeople[i], Reply[0]["post_id"]);
      }
      return new Result(true, "编辑回复成功");
    },
    DeletePost: async (Data: object, CheckUserID: boolean = true): Promise<Result> => {
      ThrowErrorIfFailed(this.CheckParams(Data, {
        "PostID": "number"
      }));
      const Post = ThrowErrorIfFailed(await this.XMOJDatabase.Select("bbs_post", ["user_id"], {
        post_id: Data["PostID"]
      }));
      if (Post.toString() === "") {
        return new Result(false, "删除失败，该讨论不存在");
      }
      if (!this.IsAdmin() && ThrowErrorIfFailed(await this.XMOJDatabase.GetTableSize("bbs_lock", {
        post_id: Data["PostID"]
      }))["TableSize"] === 1) {
        return new Result(false, "讨论已被锁定");
      }
      if (!this.IsAdmin() && CheckUserID && Post[0]["user_id"] !== this.Username) {
        return new Result(false, "没有权限删除此讨论");
      }
      const Replies = ThrowErrorIfFailed(await this.XMOJDatabase.Select("bbs_reply", ["reply_id"], {
        post_id: Data["PostID"]
      }));
      for (const i in Replies) {
        await this.XMOJDatabase.Delete("bbs_reply", {
          reply_id: Replies[i]["reply_id"]
        });
      }
      await this.XMOJDatabase.Delete("bbs_post", {post_id: Data["PostID"]});
      return new Result(true, "删除讨论成功");
    },
    DeleteReply: async (Data: object): Promise<Result> => {
      ThrowErrorIfFailed(this.CheckParams(Data, {
        "ReplyID": "number"
      }));
      const Reply = ThrowErrorIfFailed(await this.XMOJDatabase.Select("bbs_reply", ["user_id", "post_id"], {reply_id: Data["ReplyID"]}));
      if (Reply.toString() === "") {
        return new Result(false, "删除失败，该讨论不存在");
      }
      if (!this.IsAdmin() && ThrowErrorIfFailed(await this.XMOJDatabase.GetTableSize("bbs_lock", {
        post_id: Reply[0]["post_id"]
      }))["TableSize"] === 1) {
        return new Result(false, "讨论已被锁定");
      }
      if (!this.IsAdmin() && Reply[0]["user_id"] !== this.Username) {
        return new Result(false, "没有权限删除此回复");
      }
      if (ThrowErrorIfFailed(await this.XMOJDatabase.GetTableSize("bbs_reply", {
        post_id: Reply[0]["post_id"]
      }))["TableSize"] === 1) {
        await this.ProcessFunctions.DeletePost({PostID: Reply[0]["post_id"]}, false);
      }
      await this.XMOJDatabase.Delete("bbs_reply", {reply_id: Data["ReplyID"]});
      return new Result(true, "删除回复成功");
    },
    GetBBSMentionList: async (Data: object): Promise<Result> => {
      ThrowErrorIfFailed(this.CheckParams(Data, {}));
      const ResponseData = {
        MentionList: new Array<Object>()
      };
      const Mentions = ThrowErrorIfFailed(await this.XMOJDatabase.Select("bbs_mention", ["bbs_mention_id", "post_id", "bbs_mention_time"], {
        to_user_id: this.Username
      }));
      for (const i in Mentions) {
        const Mention = Mentions[i];
        const Post = ThrowErrorIfFailed(await this.XMOJDatabase.Select("bbs_post", ["user_id", "title"], {post_id: Mention["post_id"]}));
        if (Post.toString() === "") {
          continue;
        }
        ResponseData.MentionList.push({
          MentionID: Mention["bbs_mention_id"],
          PostID: Mention["post_id"],
          PostTitle: Post[0]["title"],
          MentionTime: Mention["bbs_mention_time"]
        });
      }
      return new Result(true, "获得讨论提及列表成功", ResponseData);
    },
    GetMailMentionList: async (Data: object): Promise<Result> => {
      ThrowErrorIfFailed(this.CheckParams(Data, {}));
      const ResponseData = {
        MentionList: new Array<Object>()
      };
      const Mentions = ThrowErrorIfFailed(await this.XMOJDatabase.Select("short_message_mention", ["mail_mention_id", "from_user_id", "mail_mention_time"], {
        to_user_id: this.Username
      }));
      for (const i in Mentions) {
        const Mention = Mentions[i];
        ResponseData.MentionList.push({
          MentionID: Mention["mail_mention_id"],
          FromUserID: Mention["from_user_id"],
          MentionTime: Mention["mail_mention_time"]
        });
      }
      return new Result(true, "获得短消息提及列表成功", ResponseData);
    },
    ReadBBSMention: async (Data: object): Promise<Result> => {
      ThrowErrorIfFailed(this.CheckParams(Data, {
        "MentionID": "number"
      }));
      const MentionData = ThrowErrorIfFailed(await this.XMOJDatabase.Select("bbs_mention", ["to_user_id"], {
        bbs_mention_id: Data["MentionID"]
      }));
      if (MentionData.toString() === "") {
        return new Result(false, "未找到提及");
      }
      if (MentionData[0]["to_user_id"] !== this.Username) {
        return new Result(false, "没有权限阅读此提及");
      }
      ThrowErrorIfFailed(await this.XMOJDatabase.Delete("bbs_mention", {
        bbs_mention_id: Data["MentionID"]
      }));
      return new Result(true, "阅读讨论提及成功");
    },
    ReadMailMention: async (Data: object): Promise<Result> => {
      ThrowErrorIfFailed(this.CheckParams(Data, {
        "MentionID": "number"
      }));
      const MentionData = ThrowErrorIfFailed(await this.XMOJDatabase.Select("short_message_mention", ["to_user_id"], {
        mail_mention_id: Data["MentionID"]
      }));
      if (MentionData.toString() === "") {
        return new Result(false, "未找到提及");
      }
      if (MentionData[0]["to_user_id"] !== this.Username) {
        return new Result(false, "没有权限阅读此提及");
      }
      ThrowErrorIfFailed(await this.XMOJDatabase.Delete("short_message_mention", {
        mail_mention_id: Data["MentionID"]
      }));
      return new Result(true, "阅读短消息提及成功");
    },
    ReadUserMailMention: async (Data: object): Promise<Result> => {
      ThrowErrorIfFailed(this.CheckParams(Data, {
        "UserID": "string"
      }));
      ThrowErrorIfFailed(await this.XMOJDatabase.Delete("short_message_mention", {
        from_user_id: Data["UserID"],
        to_user_id: this.Username
      }));
      return new Result(true, "阅读短消息提及成功");
    },
    GetMailList: async (Data: object): Promise<Result> => {
      ThrowErrorIfFailed(this.CheckParams(Data, {}));
      const ResponseData = {
        MailList: new Array<Object>()
      };
      let OtherUsernameList = new Array<string>();
      let Mails = ThrowErrorIfFailed(await this.XMOJDatabase.Select("short_message", ["message_from"], {message_to: this.Username}, {}, true));
      for (const i in Mails) {
        OtherUsernameList.push(Mails[i]["message_from"]);
      }
      Mails = ThrowErrorIfFailed(await this.XMOJDatabase.Select("short_message", ["message_to"], {message_from: this.Username}, {}, true));
      for (const i in Mails) {
        OtherUsernameList.push(Mails[i]["message_to"]);
      }
      OtherUsernameList = Array.from(new Set(OtherUsernameList));
      for (const i in OtherUsernameList) {
        const LastMessageFrom = ThrowErrorIfFailed(await this.XMOJDatabase.Select("short_message", ["content", "send_time", "message_from", "message_to"], {
          message_from: OtherUsernameList[i],
          message_to: this.Username
        }, {
          Order: "send_time",
          OrderIncreasing: false,
          Limit: 1
        }));
        const LastMessageTo = ThrowErrorIfFailed(await this.XMOJDatabase.Select("short_message", ["content", "send_time", "message_from", "message_to"], {
          message_from: this.Username,
          message_to: OtherUsernameList[i]
        }, {
          Order: "send_time",
          OrderIncreasing: false,
          Limit: 1
        }));
        let LastMessage: Object;
        if (LastMessageFrom.toString() === "") {
          LastMessage = LastMessageTo;

        } else if (LastMessageTo.toString() === "") {
          LastMessage = LastMessageFrom;
        } else {
          LastMessage = LastMessageFrom[0]["send_time"] > LastMessageTo[0]["send_time"] ? LastMessageFrom : LastMessageTo;
        }
        if (LastMessage[0]["content"].startsWith("Begin xssmseetee v2 encrypted message")) {
          try {
            const bytes = CryptoJS.AES.decrypt(LastMessage[0]["content"].substring(37), this.shortMessageEncryptKey_v1 + LastMessage[0]["message_from"] + LastMessage[0]["message_to"]);
            LastMessage[0]["content"] = bytes.toString(CryptoJS.enc.Utf8);
          } catch (error) {
            LastMessage[0]["content"] = "解密失败: " + error.message;
          }
        } else if (LastMessage[0]["content"].startsWith("Begin xssmseetee v1 encrypted message")) { //deprecated
          try {
            const bytes = CryptoJS.AES.decrypt(LastMessage[0]["content"].substring(37), this.shortMessageEncryptKey_v1);
            LastMessage[0]["content"] = bytes.toString(CryptoJS.enc.Utf8);
          } catch (error) {
            LastMessage[0]["content"] = "解密失败: " + error.message;
          }
        } else {
          let preContent = LastMessage[0]["content"];
          LastMessage[0]["content"] = "无法解密消息, 原始数据: " + preContent;
        }
        const UnreadCount = ThrowErrorIfFailed(await this.XMOJDatabase.GetTableSize("short_message", {
          message_from: OtherUsernameList[i],
          message_to: this.Username,
          is_read: 0
        }));
        ResponseData.MailList.push({
          OtherUser: OtherUsernameList[i],
          LastsMessage: LastMessage[0]["content"],
          SendTime: LastMessage[0]["send_time"],
          UnreadCount: UnreadCount["TableSize"]
        });
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
      let encryptedContent = "Begin xssmseetee v2 encrypted message" + CryptoJS.AES.encrypt(Data["Content"], this.shortMessageEncryptKey_v1 + this.Username + Data["ToUser"]).toString();
      const MessageID = ThrowErrorIfFailed(await this.XMOJDatabase.Insert("short_message", {
        message_from: this.Username,
        message_to: Data["ToUser"],
        content: encryptedContent,
        send_time: new Date().getTime()
      }))["InsertID"];
      await this.AddMailMention(this.Username, Data["ToUser"]);
      return new Result(true, "发送短消息成功", {
        MessageID: MessageID
      });
    },
    GetMail: async (Data: object): Promise<Result> => {
      ThrowErrorIfFailed(this.CheckParams(Data, {
        "OtherUser": "string"
      }));
      const ResponseData = {
        Mail: new Array<Object>()
      };
      let Mails = ThrowErrorIfFailed(await this.XMOJDatabase.Select("short_message", [], {
        message_from: Data["OtherUser"],
        message_to: this.Username
      }, {
        Order: "send_time",
        OrderIncreasing: false
      }));
      for (const i in Mails) {
        const Mail = Mails[i];
        if (Mail["content"].startsWith("Begin xssmseetee v2 encrypted message")) {
          try {
            const bytes = CryptoJS.AES.decrypt(Mail["content"].substring(37), this.shortMessageEncryptKey_v1 + Mail["message_from"] + Mail["message_to"]);
            Mail["content"] = bytes.toString(CryptoJS.enc.Utf8);
          } catch (error) {
            Mail["content"] = "解密失败: " + error.message;
          }
        } else if (Mail["content"].startsWith("Begin xssmseetee v1 encrypted message")) {
          try {
            const bytes = CryptoJS.AES.decrypt(Mail["content"].substring(37), this.shortMessageEncryptKey_v1);
            Mail["content"] = bytes.toString(CryptoJS.enc.Utf8);
          } catch (error) {
            Mail["content"] = "解密失败: " + error.message;
          }
        } else {
          let preContent = Mail["content"];
          Mail["content"] = "无法解密消息, 原始数据: " + preContent;
        }
        ResponseData.Mail.push({
          MessageID: Mail["message_id"],
          FromUser: Mail["message_from"],
          ToUser: Mail["message_to"],
          Content: Mail["content"],
          SendTime: Mail["send_time"],
          IsRead: Mail["is_read"]
        });
      }
      Mails = ThrowErrorIfFailed(await this.XMOJDatabase.Select("short_message", [], {
        message_from: this.Username,
        message_to: Data["OtherUser"]
      }, {
        Order: "send_time",
        OrderIncreasing: false
      }));
      for (const i in Mails) {
        const Mail = Mails[i];
        if (Mail["content"].startsWith("Begin xssmseetee v2 encrypted message")) {
          try {
            const bytes = CryptoJS.AES.decrypt(Mail["content"].substring(37), this.shortMessageEncryptKey_v1 + Mail["message_from"] + Mail["message_to"]);
            Mail["content"] = bytes.toString(CryptoJS.enc.Utf8);
          } catch (error) {
            Mail["content"] = "解密失败: " + error.message;
          }
        } else if (Mail["content"].startsWith("Begin xssmseetee v1 encrypted message")) {
          try {
            const bytes = CryptoJS.AES.decrypt(Mail["content"].substring(37), this.shortMessageEncryptKey_v1);
            Mail["content"] = bytes.toString(CryptoJS.enc.Utf8);
          } catch (error) {
            Mail["content"] = "解密失败: " + error.message;
          }
        } else {
          let preContent = Mail["content"];
          Mail["content"] = "无法解密消息, 原始数据: " + preContent;
        }
        ResponseData.Mail.push({
          MessageID: Mail["message_id"],
          FromUser: Mail["message_from"],
          ToUser: Mail["message_to"],
          Content: Mail["content"],
          SendTime: Mail["send_time"],
          IsRead: Mail["is_read"]
        });
      }
      ResponseData.Mail.sort((a, b) => {
        return a["SendTime"] < b["SendTime"] ? 1 : -1;
      });
      await this.XMOJDatabase.Update("short_message", {
        is_read: 1
      }, {
        message_from: Data["OtherUser"],
        message_to: this.Username
      });
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
      if (await this.GetProblemScoreChecker(ProblemID) !== 100) {
        return new Result(false, "没有权限上传此标程");
      }
      if (ThrowErrorIfFailed(await this.XMOJDatabase.GetTableSize("std_answer", {
        problem_id: ProblemID
      }))["TableSize"] !== 0) {
        return new Result(true, "此题已经有人上传标程");
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
      ThrowErrorIfFailed(await this.XMOJDatabase.Insert("std_answer", {
        problem_id: Data["ProblemID"],
        std_code: StdCode
      }));
      return new Result(true, "标程上传成功");
    },
    GetStdList: async (Data: object): Promise<Result> => {
      ThrowErrorIfFailed(this.CheckParams(Data, {}));
      const ResponseData = {
        StdList: new Array<number>()
      };
      let StdList = ThrowErrorIfFailed(await this.XMOJDatabase.Select("std_answer", ["problem_id"]));
      for (const i in StdList) {
        ResponseData.StdList.push(StdList[i]["problem_id"]);
      }
      return new Result(true, "获得标程列表成功", ResponseData);
    },
    GetStd: async (Data: object): Promise<Result> => {
      ThrowErrorIfFailed(this.CheckParams(Data, {
        "ProblemID": "number"
      }));
      if (await this.GetProblemScoreChecker(Data["ProblemID"]) < 50) {
        return new Result(false, "没有权限获取此标程");
      }
      const Std = ThrowErrorIfFailed(await this.XMOJDatabase.Select("std_answer", ["std_code"], {
        problem_id: Data["ProblemID"]
      }));
      if (Std.toString() === "") {
        return new Result(false, "此题还没有人上传标程");
      }
      return new Result(true, "获得标程成功", {
        "StdCode": Std[0]["std_code"]
      });
    },
    NewBadge: async (Data: object): Promise<Result> => {
      ThrowErrorIfFailed(this.CheckParams(Data, {
        "UserID": "string"
      }));
      if (!this.IsAdmin()) {
        return new Result(false, "没有权限创建此标签");
      }
      ThrowErrorIfFailed(await this.XMOJDatabase.Insert("badge", {
        user_id: Data["UserID"]
      }));
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
      if (ThrowErrorIfFailed(await this.XMOJDatabase.GetTableSize("badge", {
        user_id: Data["UserID"]
      }))["TableSize"] === 0) {
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
      if (check[check[0]["label"] == "NEGATIVE" ? 0 : 1]["score"].toFixed() > 0.85) {
        return new Result(false, "您设置的标签内容含有负面词汇，请修改后重试");
      }
      ThrowErrorIfFailed(await this.XMOJDatabase.Update("badge", {
        background_color: Data["BackgroundColor"],
        color: Data["Color"],
        content: Data["Content"]
      }, {
        user_id: Data["UserID"]
      }));
      return new Result(true, "编辑标签成功");
    },
    GetBadge: async (Data: object): Promise<Result> => {
      ThrowErrorIfFailed(this.CheckParams(Data, {
        "UserID": "string"
      }));
      const BadgeData = ThrowErrorIfFailed(await this.XMOJDatabase.Select("badge", ["background_color", "color", "content"], {
        user_id: Data["UserID"]
      }));
      if (BadgeData.toString() == "") {
        return new Result(false, "获取标签失败，该标签在数据库中不存在");
      }
      return new Result(true, "获得标签成功", {
        Content: BadgeData[0]["content"],
        BackgroundColor: Data["UserID"] === "zhouyiqing" ? "#000000" : BadgeData[0]["background_color"],
        Color: Data["UserID"] === "zhouyiqing" ? "#ffffff" : BadgeData[0]["color"]
      });
    },
    DeleteBadge: async (Data: object): Promise<Result> => {
      ThrowErrorIfFailed(this.CheckParams(Data, {
        "UserID": "string"
      }));
      if (!this.IsAdmin()) {
        return new Result(false, "没有权限删除此标签");
      }
      ThrowErrorIfFailed(await this.XMOJDatabase.Delete("badge", {
        user_id: Data["UserID"]
      }));
      return new Result(true, "删除标签成功");
    },
    GetBoards: async (Data: object): Promise<Result> => {
      ThrowErrorIfFailed(this.CheckParams(Data, {}));
      const Boards: Array<Object> = new Array<Object>();
      const BoardsData = ThrowErrorIfFailed(await this.XMOJDatabase.Select("bbs_board", []));
      for (const i in BoardsData) {
        const Board = BoardsData[i];
        Boards.push({
          BoardID: Board["board_id"],
          BoardName: Board["board_name"]
        });
      }
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
      const query = `SELECT index1 AS username, blob1 AS IP, blob2 AS Path, blob3 AS Version, blob4 AS DebugMode, timestamp FROM logdb WHERE index1=${sanitizedUsername} ORDER BY timestamp ASC`;

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
      const query = `SELECT timestamp FROM logdb WHERE index1=${sanitizedUsername} ORDER BY timestamp DESC LIMIT 1`;
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
    this.XMOJDatabase = new Database(Environment.DB);
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
      if (this.logs) {
        this.logs.writeDataPoint({
          'blobs': [this.RemoteIP, PathName, RequestJSON["Version"], RequestJSON["DebugMode"]],
          'indexes': [this.Username]
        });
      } else {
        console.log("Local debug mode, logging disabled");
      }
      throw await this.ProcessFunctions[PathName](RequestJSON["Data"]);
    } catch (ResponseData) {
      if (!(ResponseData instanceof Result)) {
        Output.Error(ResponseData);
        ResponseData = new Result(false, "服务器运行错误：" + String(ResponseData).split("\n")[0]);
      }
      return new Response(JSON.stringify(ResponseData), {
        headers: {
          "content-type": "application/json;charset=UTF-8"
        }
      });
    }
  }
}
