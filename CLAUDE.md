# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

XMOJ-bbs is a RESTful backend for XMOJ-Script written in TypeScript, deployed on Cloudflare Workers. It provides a forum/bulletin board system with user authentication, posts, replies, messaging, badges, and code-sharing features.

## Development Commands

### Testing
```bash
# Run all tests
npm test

# Generate coverage report
npm run coverage
```

Tests use Node.js built-in test runner (`node:test`) and are located in the `test/` directory with `.test.js` extensions.

### Development
```bash
# Start local development server with wrangler
npm start

# Deploy to Cloudflare Workers
npm run deploy
```

### Running Individual Tests
```bash
# Run a specific test file
TS_NODE_TRANSPILE_ONLY=1 TS_NODE_COMPILER_OPTIONS='{"module":"commonjs"}' node --require ts-node/register --test test/database.test.js
```

## Architecture

### Core Files (Source/)

- **index.ts**: Cloudflare Workers entry point. Exports `fetch` handler for HTTP requests and `scheduled` handler for cron jobs (cleans old messages/sessions daily)
- **Process.ts**: Request processor containing all API endpoint logic in the `ProcessFunctions` object. Routes are mapped by URL pathname to function handlers
- **Database.ts**: Abstraction layer over Cloudflare D1 (SQLite). Provides Insert/Select/Update/Delete/GetTableSize methods with automatic query building and parameterized queries
- **Result.ts**: Defines the `Result` class used for all operation returns (Success, Message, Data fields). Includes `ThrowErrorIfFailed` helper for error propagation
- **Output.ts**: Logging utilities with color-coded console output (Debug/Log/Warn/Error)

### Key Architecture Patterns

#### Result Pattern
All operations return a `Result` object with:
- `Success`: boolean indicating operation success
- `Message`: human-readable message (often in Chinese for user-facing errors)
- `Data`: optional object containing return values

Use `ThrowErrorIfFailed(result)` to extract data or propagate errors:
```typescript
const data = ThrowErrorIfFailed(await this.XMOJDatabase.Select("table", []));
```

#### Database Queries
The Database class automatically builds parameterized SQL queries. Never concatenate user input into SQL strings:
```typescript
// Correct
await db.Select("users", ["name"], { id: userId });

// For operators other than =
await db.Select("users", [], { age: { Operator: ">=", Value: 18 } });
```

#### Request Processing Flow
1. Request arrives at `index.ts` fetch handler
2. Creates `Process` instance with request and environment
3. Extracts pathname from URL (defaults to "/GetNotice")
4. Validates request format (POST, application/json, except GetNotice/GetImage)
5. Checks authentication token via `CheckToken`
6. Logs request to Analytics Engine
7. Calls corresponding function in `ProcessFunctions`
8. Returns Result as JSON response

#### Adding New Endpoints
Add a new method to the `ProcessFunctions` object in Process.ts:
```typescript
NewEndpoint: async (Data: object): Promise<Result> => {
  ThrowErrorIfFailed(this.CheckParams(Data, {
    "ParameterName": "type"
  }));
  // Implementation
  return new Result(true, "Success message", { data });
}
```
No routing configuration needed - pathname automatically maps to function name.

#### Authentication
- Uses `CheckToken` which validates session ID against XMOJ website
- Session tokens are hashed (SHA3) and cached in `phpsessid` table
- Admin users are hardcoded in `AdminUserList` array
- Use `this.IsAdmin()`, `this.IsSilenced()`, `this.DenyMessage()`, `this.DenyEdit()` for permission checks

### Cloudflare Workers Environment

The Environment interface defines bindings:
- `DB`: D1Database (SQLite database)
- `kv`: KVNamespace (key-value storage for notices, script cache, std_list)
- `logdb`: AnalyticsEngineDataset (logging and analytics)
- `AI`: Cloudflare AI binding (used for content moderation in badges)
- `CaptchaSecretKey`: Turnstile captcha validation
- `GithubImagePAT`: Personal access token for image uploads to GitHub repo
- `API_TOKEN`, `ACCOUNT_ID`: Cloudflare API credentials for analytics queries
- `xssmseetee_v1_key`: Encryption key for private messages

### Database Schema Conventions

Tables use snake_case naming:
- `bbs_post`: Post metadata (title, user_id, problem_id, board_id, post_time)
- `bbs_reply`: Reply content (content, user_id, post_id, reply_time, edit_time)
- `bbs_mention`: Notification system for @mentions
- `short_message`: Encrypted private messages between users
- `badge`: User badges with custom colors and content
- `std_answer`: Standard solution codes for problems
- `phpsessid`: Cached session tokens

### Testing Conventions

- Tests use Node.js built-in test runner with stubs
- Test files are `.test.js` (not `.test.ts`) in the `test/` directory
- Create mock D1Database stubs with `createStub(responses)` helper
- Tests verify both SQL query construction and parameter binding
- Focus on testing Database class methods and core logic, not full Process flows

### Special Considerations

- **Message Encryption**: Private messages use AES encryption with version-specific prefixes ("Begin xssmseetee v2 encrypted message")
- **Problem Score Scraping**: System scrapes XMOJ website to verify user problem scores via Cheerio
- **Readonly Mode**: Database.ts has a `readonly` flag for maintenance mode
- **CORS/Headers**: Requests to XMOJ mimic real browser headers for compatibility
- **Captcha**: Cloudflare Turnstile used for post/reply creation
- **Content Moderation**: AI model checks badge content for negative sentiment
- **Cron Jobs**: Daily cleanup of old read messages (5+ days) and expired sessions

### Language Note

User-facing messages are primarily in Chinese (Simplified). Error messages, validation text, and API responses use Chinese strings.
