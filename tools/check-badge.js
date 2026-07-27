/*
 *     Copyright (C) 2023-2026  XMOJ-bbs contributors
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

// Try badge text against the real moderation model without touching a badge.
//
//   npm run check-badge -- "爆零选手" "nmsl" "🇨🇳"
//   npm run check-badge -- --file candidates.txt
//
// The prompt, model, schema, verdict parser and rejection strings are imported
// from Source/Process.ts, so this cannot drift from what production runs. If a
// verdict here surprises you, production would have done the same thing.

const fs = require("fs");
const os = require("os");
const path = require("path");

const {
    BadgeModerationModel,
    BadgeModerationPrompt,
    BadgeModerationSchema,
    BadgeRuleReasons,
    ReadModerationVerdict,
} = require("../Source/Process.ts");

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || "89969bdf9d5ab8202f8ad8b8ae2c40b8";

// Same deterministic checks EditBadge runs before spending an inference call, so
// the tool reports the real reason rather than sending doomed text to the model.
const DisallowedCharacters = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Zl}\p{Zp}]/u;
const CombiningMarkRun = /[\p{Mn}\p{Me}]{3,}/u;
const MaxGraphemes = 20;

function localVerdict(content) {
    const graphemes = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(content)].length;
    if (graphemes > MaxGraphemes) return "标签内容过长 (" + graphemes + " graphemes)";
    if (content.includes("管理员") || content.toLowerCase().includes("manager") || content.toLowerCase().includes("admin")) {
        return "请不要试图冒充管理员";
    }
    if (DisallowedCharacters.test(content.replaceAll("‍", "")) || CombiningMarkRun.test(content)) {
        return "内容包含不允许的字符，导致渲染问题";
    }
    if (content.trim() === "") return "内容不能仅包含空格";
    return null;
}

function token() {
    if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;
    // Fall back to the login wrangler already holds, so there is nothing to set up.
    const configPath = path.join(os.homedir(), ".wrangler", "config", "default.toml");
    if (!fs.existsSync(configPath)) return null;
    const match = fs.readFileSync(configPath, "utf8").match(/^oauth_token\s*=\s*"([^"]+)"/m);
    return match ? match[1] : null;
}

async function moderate(content, bearer) {
    const response = await fetch(
        "https://api.cloudflare.com/client/v4/accounts/" + ACCOUNT_ID + "/ai/run/" + BadgeModerationModel,
        {
            method: "POST",
            headers: { "Authorization": "Bearer " + bearer, "Content-Type": "application/json" },
            body: JSON.stringify({
                messages: [
                    { role: "system", content: BadgeModerationPrompt },
                    { role: "user", content: "<badge>" + content + "</badge>" },
                ],
                temperature: 0,
                max_completion_tokens: 1024,
                response_format: { type: "json_schema", json_schema: BadgeModerationSchema },
            }),
        }
    );
    const body = await response.json();
    if (!body.success) {
        return { error: JSON.stringify(body.errors || body) };
    }
    return {
        verdict: ReadModerationVerdict(body.result),
        neurons: body.result?.usage?.neurons,
    };
}

async function main() {
    let inputs = process.argv.slice(2);
    const fileFlag = inputs.indexOf("--file");
    if (fileFlag !== -1) {
        const file = inputs[fileFlag + 1];
        if (!file) {
            console.error("--file needs a path");
            process.exit(1);
        }
        inputs = fs.readFileSync(file, "utf8").split("\n").filter((line) => line.trim() !== "");
    }
    if (inputs.length === 0) {
        console.error('usage: npm run check-badge -- "text" ["more text"]');
        console.error('       npm run check-badge -- --file candidates.txt');
        process.exit(1);
    }

    const bearer = token();
    if (!bearer) {
        console.error("No credentials. Run `npx wrangler login`, or set CLOUDFLARE_API_TOKEN.");
        process.exit(1);
    }

    let spent = 0;
    for (const content of inputs) {
        const blocked = localVerdict(content);
        if (blocked !== null) {
            console.log("BLOCKED  " + JSON.stringify(content) + "  " + blocked + "  (no model call)");
            continue;
        }
        const { verdict, neurons, error } = await moderate(content, bearer);
        if (error) {
            console.log("ERROR    " + JSON.stringify(content) + "  " + error);
            continue;
        }
        spent += neurons || 0;
        if (verdict === null) {
            console.log("UNUSABLE " + JSON.stringify(content) + "  model reply failed validation, edit would fail closed");
        } else if (verdict.allowed) {
            console.log("ALLOW    " + JSON.stringify(content));
        } else {
            console.log("REJECT   " + JSON.stringify(content) +
                "  rule " + verdict.rule + " — 标签内容" + BadgeRuleReasons[verdict.rule] + "，请修改后重试");
        }
    }
    if (spent > 0) {
        console.log("\n" + spent.toFixed(1) + " neurons (" + (10000 / (spent / inputs.length)).toFixed(0) + " checks/day at this rate)");
    }
}

main();
