# Badge content moderation: replace the sentiment classifier and fix the character check

Fixes [#39](https://github.com/XMOJ-Script-dev/XMOJ-bbs/issues/39) — emoji in a badge are rejected as negative content.

## Problem

`EditBadge` in `Source/Process.ts` rejects emoji through two independent paths.

**Path 1 — the character allowlist (line 1394).** The regex is documented as preventing
rendering problems, but measurement shows it does close to the opposite:

| Input | Allowlist verdict |
| --- | --- |
| NUL, backspace, ESC, DEL | pass |
| RLO bidi override U+202E | pass |
| zero-width space U+200B | pass |
| line separator U+2028 | pass |
| unpaired low surrogate | pass |
| ❤️ ⭐ ✅ ✨ ☀ | **block** |
| café, かな, 한글, при | **block** |

`\u0000-\u007F` admits the whole ASCII block including the C0 controls.
`\u2000-\u206F` admits U+200B-U+200F and U+202A-U+202E, which are the zero-width and
bidi-override characters that actually corrupt rendering. `\uDC00-\uDFFF` admits
unpaired low surrogates. The C1 controls are blocked, so the check is inconsistent as
well as wrong.

Non-surrogate emoji are rejected here and never reach moderation at all.

**This is also the source of badge characters floating outside their box.** Enumerating
every code point that the allowlist accepts and that is a stacking mark (category `Mn`
or `Me`) returns 244 results: U+E0100–U+E01EF, which are invisible variation selectors,
and **U+302A–U+302D, the ideographic tone marks**. Those four sit inside the CJK
punctuation range that the allowlist admits wholesale. Their canonical combining classes
are 218, 228, 232 and 222 — two attach above the base glyph and two below — so a run of
them stacks vertically out of the badge box. The current 20-unit length limit permits a
stack 20 marks high.

**Path 2 — the AI check (lines 1401–1409).** Two defects compound:

```ts
const check = await this.AI.run("@cf/huggingface/distilbert-sst-2-int8", { text: Data["Content"] });
if (check[check[0]["label"] == "NEGATIVE" ? 0 : 1]["score"].toFixed() > 0.90) {
```

- `toFixed()` with no argument rounds to zero decimals and returns a string, so 0.62
  becomes `"1"` and 0.49 becomes `"0"`. The effective threshold is 0.5, not 0.90.
- `distilbert-sst-2-int8` is an English-only sentiment classifier. It answers "is this
  sentence positive or negative", which is not the moderation question. A sad badge is
  not a policy violation. Emoji and Chinese are out-of-distribution input for it, and
  out-of-distribution input is exactly where a confident wrong answer comes from.

## Design

### Check order in `EditBadge`

Deterministic checks run first so that most rejections cost no inference call.

1. Length limit — **changed**, see below
2. 管理员 / manager / admin substring — unchanged
3. Character check — **replaced**, see below
4. Whitespace-only — unchanged
5. AI moderation — **replaced**, see below

### 1. Length limit

`Data["Content"].length > 20` counts UTF-16 code units, so 😀 costs 2 and 👨‍👩‍👧 costs 8.
Replace with grapheme-cluster counting via `Intl.Segmenter`, available in the Workers
runtime:

```ts
const Graphemes = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(Data["Content"])].length;
if (Graphemes > 20) {
  return new Result(false, "标签内容过长");
}
```

One emoji now costs one character regardless of how many code points compose it. The
limit stays at 20 and the rejection message is unchanged.

### 3. Character check

Replace the allowlist with a denylist of characters that genuinely break rendering:

```ts
// U+200D (ZWJ) is exempt: emoji sequences such as 👨‍👩‍👧 are built from it.
const DisallowedCharacters = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Zl}\p{Zp}]/u;
const CombiningMarkRun = /[\p{Mn}\p{Me}]{3,}/u;
if (DisallowedCharacters.test(Data["Content"].replaceAll("\u200D", "")) ||
    CombiningMarkRun.test(Data["Content"])) {
  return new Result(false, "内容包含不允许的字符，导致渲染问题");
}
```

- `Cc` control, `Cf` format (bidi overrides, zero-width, BOM), `Cs` lone surrogates,
  `Co` private use, `Zl`/`Zp` line and paragraph separators.
- ZWJ is stripped before the test so emoji sequences survive. U+FE0F is category `Mn`,
  not `Cf`, so variation selectors and keycaps pass untouched.
- `[\p{Mn}\p{Me}]{3,}` caps stacking at two marks per base character. This is what stops
  the U+302A–U+302D float described above, and Zalgo stacking generally.

The `{3,}` threshold is calibrated, not arbitrary. Measured against real multi-mark
scripts, a run of two marks is enough for every legitimate case: Vietnamese decomposed
(tiếng), Thai sara plus tone, Hebrew niqqud, Devanagari nukta plus matra, and decomposed
Latin (café) all pass, while a six-mark tone stack and a five-mark Zalgo string are
blocked. Producing a visible float needs far more than two marks. NFC normalisation was
evaluated as a way to reduce false positives and changed no outcome on these cases, so
it is not included.

Verified: all of NUL, backspace, ESC, DEL, RLO, ZWSP, LRM, FSI, BOM, U+2028, lone
surrogates, private-use characters and a five-mark Zalgo string are blocked; all of
😀 💩 ❤️ ⭐ ✅ ✨ ☀, ZWJ families, flags, skin-tone modifiers, keycaps, 你好, café,
ひらがな, 한글 and при pass.

**Accepted consequence:** this is more permissive for scripts the old regex banned.
Arabic and Hebrew badges become possible, and their natural RTL rendering resembles the
old bidi problem even with no override character present. This is correct behaviour, not
a regression, but it is a visible change.

### 5. AI moderation

Replace the sentiment classifier with a moderation prompt on `@cf/zai-org/glm-4.7-flash`
— multilingual with native Chinese, reads emoji as emoji, and supports `response_format`
for structured output.

- `temperature: 0` for repeatability.
- Badge content is passed as the user message inside clear delimiters.
- `response_format` pins output to `{ allowed: boolean, reason: string }`.
- No score threshold anywhere. The `toFixed()` expression is deleted rather than fixed,
  because nothing compares scores any more.

#### The policy

The standard is what does not belong on a competitive-programming judge whose users are
largely school-age. That rationale is stated in the prompt, but the rules are enumerated
rather than left to the model's judgement, because a vague instruction produces
inconsistent verdicts on exactly the borderline input that issue #39 is about.

System prompt:

```
You moderate user "badges" on XMOJ, a competitive programming judge used mainly by
school-age students. A badge is a short public label (max 20 characters) shown next
to a username.

Reject the badge if it contains any of the following:
1.  Profanity, vulgarity or obscenity, in any language, including deliberately
    disguised forms (homophones, leetspeak, initialisms such as nmsl / wcnm).
2.  Sexual content or innuendo.
3.  Insults, harassment, threats or mockery aimed at a person or group, including
    at a named user.
4.  Hate speech or discrimination based on race, ethnicity, nationality, region,
    religion, gender, sexuality or disability.
5.  Violence, gore, or threats of harm.
6.  References to self-harm or suicide.
7.  Drugs, alcohol, tobacco or gambling.
8.  Claiming to be site staff, an administrator, a judge, or a system message.
9.  Advertising, spam, external links, or contact details (QQ, WeChat, phone).
10. Soliciting or offering contest answers, account sharing, or other cheating.

Do NOT reject a badge merely because it is:
-   Negative, sad, self-deprecating or defeatist.
-   Competitive programming slang that sounds harsh but is ordinary in this
    community: AK, 爆零, 挂了, 退役, 打铁, 罚坐, WA, TLE, RE, MLE.
-   Made of emoji, alone or in combination.
-   Written in any language or script.
-   Boastful about rating or results.

If the badge is borderline and does not clearly fall into a listed category, allow it.
```

The closing instruction is deliberate. Issue #39 is a false-positive bug, and
administrators can already remove a badge afterwards via `DeleteBadge`, so the cost of
wrongly allowing is much lower than the cost of wrongly rejecting. Note that this
leniency applies to the model's *judgement* only — it does not conflict with the
fail-closed behaviour below, which covers infrastructure failure.

**Prompt injection:** badge content is user-controlled but capped at 20 graphemes.
Delimiters plus schema-constrained output are proportionate at that size; nothing
heavier is warranted.

### Failure handling

The call is wrapped in `try`/`catch`. On a thrown error, or output that does not parse
against the schema, log via `Output.Error` and reject the edit:

```ts
return new Result(false, "内容审核服务暂时不可用，请稍后重试");
```

Fail-closed preserves today's effective behaviour (an AI error already prevents the
edit) and keeps moderation from being bypassable by inducing a model error. The message
is deliberately distinct from the policy-violation message so that users and logs can
tell an outage from a rejection.

## Testing

In `test/process.test.js`, whose harness already stubs `AI.run`:

| Case | Expectation |
| --- | --- |
| Emoji-only content (😀, ❤️, 👨‍👩‍👧) | passes all deterministic checks, reaches `AI.run`, allowed |
| Plainly abusive content | rejected with the policy message |
| CP slang (爆零, 退役, 挂了) | allowed — the carve-out is load-bearing |
| `AI.run` throws | rejected with the unavailable message |
| `AI.run` returns unparseable output | rejected with the unavailable message |
| Model ID passed to `AI.run` | asserted, so a silent model swap fails the suite |
| Control characters, RLO, ZWSP, lone surrogate, Zalgo | rejected by the character check, `AI.run` never called |
| U+302A run (the floating-badge case) | rejected by the character check |
| Vietnamese, Thai, Hebrew niqqud, Devanagari, decomposed café | pass the character check |
| 20 emoji | within the length limit |
| 21 emoji | rejected as too long |

The character-check and length cases assert that `AI.run` is not called, which pins the
ordering that keeps inference cost off the rejection path.

## Out of scope

- **Cost profile.** `glm-4.7-flash` bills per token where distilbert was cheaper. Badge
  edits are rare enough that this is not expected to matter, but it is a real change.
- `EditBadge` is the only site in the codebase that uses `this.AI`. No other moderation
  path is touched.
