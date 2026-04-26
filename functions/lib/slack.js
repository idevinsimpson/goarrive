"use strict";
/**
 * slack.ts — Slack Event Webhook Handler for Marco Bot (My Autonomous Resource & Coordination Operator)
 *
 * ME-011: SLACK_SIGNING_SECRET must be set as a Firebase secret.
 *         firebase functions:secrets:set SLACK_SIGNING_SECRET
 * ME-012: SLACK_BOT_TOKEN must be set as a Firebase secret.
 *         firebase functions:secrets:set SLACK_BOT_TOKEN
 * ME-013: OPENAI_API_KEY must be set as a Firebase secret.
 *         firebase functions:secrets:set OPENAI_API_KEY
 * ME-014: LINEAR_API_KEY must be set as a Firebase secret.
 *         firebase functions:secrets:set LINEAR_API_KEY
 * ME-015: SENTRY_DSN must be set as a Firebase secret.
 *         firebase functions:secrets:set SENTRY_DSN
 *
 * v3 upgrades:
 *  1. Thread conversation memory — fetches full thread history and passes it to OpenAI
 *  2. Image/vision support — downloads Slack file attachments and sends them to OpenAI
 *  3. GPT-5.5 model with reasoning effort
 *  4. Slack streaming "thinking" indicator via chat.startStream / chat.appendStream / chat.stopStream
 *
 * v4 upgrades:
 *  5. Linear integration — create/list/update issues directly from Slack via @Marco
 *
 * v5 upgrades:
 *  6. Sentry integration — query recent errors and crash reports from Slack via @Marco
 *
 * Deployed URL:
 *   https://us-central1-goarrive.cloudfunctions.net/slackEvents
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.slackEvents = void 0;
const crypto = __importStar(require("crypto"));
const https_1 = require("firebase-functions/v2/https");
const params_1 = require("firebase-functions/params");
const admin = __importStar(require("firebase-admin"));
const slackSigningSecret = (0, params_1.defineSecret)('SLACK_SIGNING_SECRET');
const slackBotToken = (0, params_1.defineSecret)('SLACK_BOT_TOKEN');
const openaiApiKey = (0, params_1.defineSecret)('OPENAI_API_KEY');
const linearApiKey = (0, params_1.defineSecret)('LINEAR_API_KEY');
const sentryDsn = (0, params_1.defineSecret)('SENTRY_DSN');
const SLACK_API = 'https://slack.com/api';
const OPENAI_API = 'https://api.openai.com/v1';
const LINEAR_API = 'https://api.linear.app/graphql';
// Marco's bot user ID (new app A0B0947S7ND)
const MARCO_BOT_USER_ID = 'U0AV3U11E8K';
// Linear team ID for GoArrive "Goa" team
const LINEAR_TEAM_ID = 'ee4ab0b9-5cac-466f-ab41-8e5bbf283a72';
// ─── Signature Verification ──────────────────────────────────────────────────
function verifySlackSignature(signingSecret, rawBody, timestamp, signature) {
    const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 5 * 60;
    if (parseInt(timestamp, 10) < fiveMinutesAgo)
        return false;
    const baseString = `v0:${timestamp}:${rawBody}`;
    const hmacVal = crypto
        .createHmac('sha256', signingSecret)
        .update(baseString)
        .digest('hex');
    const computedSig = `v0=${hmacVal}`;
    if (computedSig.length !== signature.length)
        return false;
    return crypto.timingSafeEqual(Buffer.from(computedSig, 'utf8'), Buffer.from(signature, 'utf8'));
}
// ─── Slack API helpers ────────────────────────────────────────────────────────
async function slackPost(botToken, method, body) {
    const res = await fetch(`${SLACK_API}/${method}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            Authorization: `Bearer ${botToken}`,
        },
        body: JSON.stringify(body),
    });
    return res.json();
}
async function postSlackMessage(botToken, channel, text, threadTs) {
    const body = { channel, text };
    if (threadTs)
        body.thread_ts = threadTs;
    const json = await slackPost(botToken, 'chat.postMessage', body);
    if (!json.ok)
        console.error('[slackEvents] chat.postMessage error:', json.error);
}
async function startStream(botToken, channel, threadTs) {
    try {
        const json = await slackPost(botToken, 'chat.startStream', {
            channel,
            thread_ts: threadTs,
            chunks: [
                {
                    type: 'task_update',
                    id: 'thinking',
                    title: 'Marco is thinking...',
                    status: 'in_progress',
                },
            ],
        });
        if (!json.ok) {
            console.warn('[slackEvents] chat.startStream error:', json.error);
            return null;
        }
        return { channel, threadTs, streamTs: json.stream_ts, botToken };
    }
    catch (err) {
        console.warn('[slackEvents] startStream failed (non-fatal):', err);
        return null;
    }
}
async function stopStream(handle, finalText) {
    try {
        await slackPost(handle.botToken, 'chat.stopStream', {
            channel: handle.channel,
            thread_ts: handle.threadTs,
            stream_ts: handle.streamTs,
            chunks: [
                {
                    type: 'markdown_text',
                    text: finalText,
                },
            ],
        });
    }
    catch (err) {
        console.warn('[slackEvents] stopStream failed (non-fatal):', err);
    }
}
async function stopStreamWithError(handle, errorText) {
    try {
        await slackPost(handle.botToken, 'chat.stopStream', {
            channel: handle.channel,
            thread_ts: handle.threadTs,
            stream_ts: handle.streamTs,
            chunks: [
                {
                    type: 'task_update',
                    id: 'thinking',
                    title: 'Error',
                    status: 'error',
                    details: errorText,
                },
            ],
        });
    }
    catch (err) {
        console.warn('[slackEvents] stopStreamWithError failed (non-fatal):', err);
    }
}
async function fetchThreadHistory(botToken, channel, threadTs) {
    var _a;
    try {
        const res = await fetch(`${SLACK_API}/conversations.replies?channel=${channel}&ts=${threadTs}&limit=50`, {
            headers: { Authorization: `Bearer ${botToken}` },
        });
        const json = (await res.json());
        if (!json.ok) {
            console.warn('[slackEvents] conversations.replies error:', json.error);
            return [];
        }
        return (_a = json.messages) !== null && _a !== void 0 ? _a : [];
    }
    catch (err) {
        console.warn('[slackEvents] fetchThreadHistory failed:', err);
        return [];
    }
}
// ─── Download image from Slack and convert to base64 ─────────────────────────
async function downloadSlackImage(url, botToken) {
    try {
        const res = await fetch(url, {
            headers: { Authorization: `Bearer ${botToken}` },
        });
        if (!res.ok)
            return null;
        const buffer = await res.arrayBuffer();
        return Buffer.from(buffer).toString('base64');
    }
    catch (_a) {
        return null;
    }
}
async function buildMessagesFromThread(botToken, threadMessages, currentEventTs) {
    var _a, _b;
    const systemPrompt = `You are Marco (My Autonomous Resource & Coordination Operator), an AI agent embedded in the GoArrive Slack workspace.
GoArrive (G➲A) is a fitness coaching platform. You help the dev team (Devin, Maia) with tasks like:
- Browser-based QA and testing of the staging app
- Checking dashboards (Firebase, Stripe, GCP)
- Answering questions about the product and codebase
- Coordinating with Maia (the code/deploy agent) on tasks
- Analyzing screenshots, images, and visual content shared in Slack
- Managing Linear issues (create, list, update) for the Goa team
- Querying Sentry for recent app errors and crash reports

You have full thread context — you can see the entire conversation history above. Keep replies concise and practical. Your name is Marco — not Manus. You can see and analyze images.

## Linear Commands
When someone asks you to manage Linear issues, use these exact formats in your response to trigger the action:
- To create an issue: respond with a line starting with "LINEAR_CREATE:" followed by the title
  Example: "LINEAR_CREATE:Fix login bug on staging"
- To list issues: respond with a line starting with "LINEAR_LIST:" followed by optional state filter (or "all")
  Example: "LINEAR_LIST:In Progress" or "LINEAR_LIST:all"
- To update an issue status: respond with a line starting with "LINEAR_UPDATE:" followed by issue identifier and new status
  Example: "LINEAR_UPDATE:GOA-42:Done"

When you detect a Linear command intent, include the appropriate LINEAR_* line in your response, then explain what you're doing.

## Sentry Commands
When someone asks about errors, crashes, or recent issues in the app, use these formats:
- To list recent unresolved errors: respond with a line starting with "SENTRY_ISSUES:" followed by optional filter ("unresolved", "all", or a search query)
  Example: "SENTRY_ISSUES:unresolved" or "SENTRY_ISSUES:all"

When you detect a Sentry query intent, include the appropriate SENTRY_* line in your response, then explain what you're doing.`;
    const messages = [{ role: 'system', content: systemPrompt }];
    for (const msg of threadMessages) {
        // Skip the current event (it'll be added as the last user message)
        if (msg.ts === currentEventTs)
            continue;
        const isMarco = msg.bot_id || msg.user === MARCO_BOT_USER_ID;
        const role = isMarco ? 'assistant' : 'user';
        const text = stripMention((_a = msg.text) !== null && _a !== void 0 ? _a : '');
        // Check for image attachments
        const imageFiles = ((_b = msg.files) !== null && _b !== void 0 ? _b : []).filter((f) => { var _a; return (_a = f.mimetype) === null || _a === void 0 ? void 0 : _a.startsWith('image/'); });
        if (imageFiles.length > 0 && role === 'user') {
            // Build a multi-part content array with text + images
            const parts = [];
            if (text)
                parts.push({ type: 'text', text });
            for (const file of imageFiles.slice(0, 3)) {
                const base64 = await downloadSlackImage(file.url_private, botToken);
                if (base64) {
                    const mimeType = file.mimetype.split(';')[0];
                    parts.push({
                        type: 'image_url',
                        image_url: {
                            url: `data:${mimeType};base64,${base64}`,
                            detail: 'high',
                        },
                    });
                }
            }
            if (parts.length > 0) {
                messages.push({ role, content: parts });
            }
        }
        else if (text) {
            messages.push({ role, content: text });
        }
    }
    return messages;
}
// ─── Strip @mention from message text ────────────────────────────────────────
function stripMention(text) {
    return text.replace(/<@[A-Z0-9]+>/g, '').trim();
}
// ─── Call OpenAI with full conversation context ───────────────────────────────
async function getOpenAIReply(apiKey, messages, hasImages) {
    var _a, _b, _c, _d, _e;
    // GPT-5.5 supports vision; does NOT support 'reasoning' or 'temperature' params
    const model = 'gpt-5.5';
    const requestBody = {
        model,
        messages,
        max_completion_tokens: 1000,
    };
    const res = await fetch(`${OPENAI_API}/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(requestBody),
    });
    const json = (await res.json());
    if (json.error) {
        console.error('[slackEvents] OpenAI error:', json.error.message);
        throw new Error(json.error.message);
    }
    return (_e = (_d = (_c = (_b = (_a = json.choices) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.message) === null || _c === void 0 ? void 0 : _c.content) === null || _d === void 0 ? void 0 : _d.trim()) !== null && _e !== void 0 ? _e : "I didn't get a response. Try again?";
}
async function linearQuery(apiKey, query, variables) {
    const res = await fetch(LINEAR_API, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: apiKey,
        },
        body: JSON.stringify({ query, variables }),
    });
    return res.json();
}
async function linearCreateIssue(apiKey, title, description) {
    var _a, _b, _c, _d;
    const mutation = `
    mutation CreateIssue($title: String!, $teamId: String!, $description: String) {
      issueCreate(input: { title: $title, teamId: $teamId, description: $description }) {
        success
        issue {
          id
          identifier
          title
          url
        }
      }
    }
  `;
    const result = await linearQuery(apiKey, mutation, {
        title,
        teamId: LINEAR_TEAM_ID,
        description,
    });
    if (result.errors) {
        console.error('[slackEvents] Linear createIssue error:', result.errors);
        throw new Error((_b = (_a = result.errors[0]) === null || _a === void 0 ? void 0 : _a.message) !== null && _b !== void 0 ? _b : 'Linear API error');
    }
    const issue = (_d = (_c = result.data) === null || _c === void 0 ? void 0 : _c.issueCreate) === null || _d === void 0 ? void 0 : _d.issue;
    if (!issue)
        throw new Error('No issue returned from Linear');
    return `✅ Created Linear issue *${issue.identifier}*: ${issue.title}\n${issue.url}`;
}
async function linearListIssues(apiKey, stateFilter) {
    var _a, _b, _c, _d, _e, _f;
    const query = `
    query ListIssues($teamId: ID!, $filter: IssueFilter) {
      team(id: $teamId) {
        issues(filter: $filter, first: 20, orderBy: updatedAt) {
          nodes {
            id
            identifier
            title
            state { name }
            assignee { name }
            priority
            url
          }
        }
      }
    }
  `;
    const filter = {};
    if (stateFilter && stateFilter.toLowerCase() !== 'all') {
        filter.state = { name: { eq: stateFilter } };
    }
    else {
        // Exclude done/canceled by default
        filter.state = { type: { nin: ['completed', 'cancelled'] } };
    }
    const result = await linearQuery(apiKey, query, {
        teamId: LINEAR_TEAM_ID,
        filter,
    });
    if (result.errors) {
        console.error('[slackEvents] Linear listIssues error:', result.errors);
        throw new Error((_b = (_a = result.errors[0]) === null || _a === void 0 ? void 0 : _a.message) !== null && _b !== void 0 ? _b : 'Linear API error');
    }
    const issues = (_f = (_e = (_d = (_c = result.data) === null || _c === void 0 ? void 0 : _c.team) === null || _d === void 0 ? void 0 : _d.issues) === null || _e === void 0 ? void 0 : _e.nodes) !== null && _f !== void 0 ? _f : [];
    if (issues.length === 0) {
        return stateFilter && stateFilter.toLowerCase() !== 'all'
            ? `No issues found with status "${stateFilter}".`
            : 'No open issues found in Linear.';
    }
    const priorityEmoji = { 1: '🔴', 2: '🟠', 3: '🟡', 4: '⚪' };
    const lines = issues.map((issue) => {
        var _a;
        const pri = (_a = priorityEmoji[issue.priority]) !== null && _a !== void 0 ? _a : '⚪';
        const assignee = issue.assignee ? ` · ${issue.assignee.name}` : '';
        return `${pri} *${issue.identifier}* — ${issue.title} [${issue.state.name}]${assignee}`;
    });
    const header = stateFilter && stateFilter.toLowerCase() !== 'all'
        ? `*Linear issues — ${stateFilter}* (${issues.length})`
        : `*Open Linear issues* (${issues.length})`;
    return `${header}\n${lines.join('\n')}`;
}
async function linearUpdateIssue(apiKey, identifier, newState) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m;
    // First, find the issue by identifier
    const findQuery = `
    query FindIssue($teamId: ID!, $identifier: String!) {
      team(id: $teamId) {
        issues(filter: { identifier: { eq: $identifier } }, first: 1) {
          nodes { id identifier title }
        }
      }
    }
  `;
    const findResult = await linearQuery(apiKey, findQuery, {
        teamId: LINEAR_TEAM_ID,
        identifier: identifier.toUpperCase(),
    });
    const issue = (_d = (_c = (_b = (_a = findResult.data) === null || _a === void 0 ? void 0 : _a.team) === null || _b === void 0 ? void 0 : _b.issues) === null || _c === void 0 ? void 0 : _c.nodes) === null || _d === void 0 ? void 0 : _d[0];
    if (!issue)
        throw new Error(`Issue "${identifier}" not found in Linear`);
    // Find the state ID by name
    const stateQuery = `
    query FindState($teamId: ID!) {
      team(id: $teamId) {
        states { nodes { id name } }
      }
    }
  `;
    const stateResult = await linearQuery(apiKey, stateQuery, { teamId: LINEAR_TEAM_ID });
    const states = (_h = (_g = (_f = (_e = stateResult.data) === null || _e === void 0 ? void 0 : _e.team) === null || _f === void 0 ? void 0 : _f.states) === null || _g === void 0 ? void 0 : _g.nodes) !== null && _h !== void 0 ? _h : [];
    const matchedState = states.find((s) => s.name.toLowerCase() === newState.toLowerCase());
    if (!matchedState) {
        const stateNames = states.map((s) => s.name).join(', ');
        throw new Error(`State "${newState}" not found. Available states: ${stateNames}`);
    }
    // Update the issue
    const mutation = `
    mutation UpdateIssue($id: String!, $stateId: String!) {
      issueUpdate(id: $id, input: { stateId: $stateId }) {
        success
        issue { identifier title state { name } url }
      }
    }
  `;
    const updateResult = await linearQuery(apiKey, mutation, {
        id: issue.id,
        stateId: matchedState.id,
    });
    if (updateResult.errors) {
        throw new Error((_k = (_j = updateResult.errors[0]) === null || _j === void 0 ? void 0 : _j.message) !== null && _k !== void 0 ? _k : 'Linear update error');
    }
    const updated = (_m = (_l = updateResult.data) === null || _l === void 0 ? void 0 : _l.issueUpdate) === null || _m === void 0 ? void 0 : _m.issue;
    return `✅ Updated *${updated.identifier}* to *${updated.state.name}*: ${updated.title}\n${updated.url}`;
}
// ─── Sentry API helpers ──────────────────────────────────────────────────────
async function sentryListIssues(dsn, filter) {
    // Extract the Sentry base URL and project info from DSN
    // DSN format: https://<key>@<host>/<project_id>
    const dsnMatch = dsn.match(/https:\/\/([^@]+)@([^/]+)\/(.+)/);
    if (!dsnMatch)
        throw new Error('Invalid Sentry DSN format');
    const [, key, host, projectId] = dsnMatch;
    const query = filter === 'all' ? '' : (filter === 'unresolved' ? 'is:unresolved' : filter);
    const url = `https://${host}/api/0/projects/${projectId}/issues/?query=${encodeURIComponent(query)}&limit=10`;
    const res = await fetch(url, {
        headers: {
            Authorization: `DSN ${dsn}`,
            'Content-Type': 'application/json',
        },
    });
    if (!res.ok) {
        // Try Bearer token auth (Sentry auth token)
        const res2 = await fetch(url, {
            headers: {
                Authorization: `Bearer ${key}`,
                'Content-Type': 'application/json',
            },
        });
        if (!res2.ok) {
            throw new Error(`Sentry API error: ${res2.status}`);
        }
        const issues = await res2.json();
        return formatSentryIssues(issues, filter);
    }
    const issues = await res.json();
    return formatSentryIssues(issues, filter);
}
function formatSentryIssues(issues, filter) {
    if (!issues || issues.length === 0) {
        return `✅ No ${filter === 'all' ? '' : filter + ' '}Sentry issues found.`;
    }
    const lines = issues.slice(0, 10).map((issue) => {
        const lastSeen = new Date(issue.lastSeen).toLocaleString('en-US', { timeZone: 'America/New_York' });
        return `• *${issue.title}*\n  ${issue.culprit || 'unknown'} | ${issue.status} | ${issue.count} events | Last: ${lastSeen}\n  ${issue.permalink}`;
    });
    return `*Sentry Issues (${filter}):*\n\n${lines.join('\n\n')}`;
}
// ─── Parse and execute Linear commands from AI reply ─────────────────────────
async function executeLinearCommands(linearKey, aiReply) {
    var _a, _b;
    const lines = aiReply.split('\n');
    const resultLines = [];
    const linearResults = [];
    for (const line of lines) {
        if (line.startsWith('LINEAR_CREATE:')) {
            const title = line.slice('LINEAR_CREATE:'.length).trim();
            try {
                const result = await linearCreateIssue(linearKey, title);
                linearResults.push(result);
            }
            catch (err) {
                linearResults.push(`❌ Failed to create issue: ${err.message}`);
            }
        }
        else if (line.startsWith('LINEAR_LIST:')) {
            const stateFilter = line.slice('LINEAR_LIST:'.length).trim() || 'all';
            try {
                const result = await linearListIssues(linearKey, stateFilter);
                linearResults.push(result);
            }
            catch (err) {
                linearResults.push(`❌ Failed to list issues: ${err.message}`);
            }
        }
        else if (line.startsWith('LINEAR_UPDATE:')) {
            const parts = line.slice('LINEAR_UPDATE:'.length).trim().split(':');
            const identifier = (_a = parts[0]) === null || _a === void 0 ? void 0 : _a.trim();
            const newState = (_b = parts[1]) === null || _b === void 0 ? void 0 : _b.trim();
            if (identifier && newState) {
                try {
                    const result = await linearUpdateIssue(linearKey, identifier, newState);
                    linearResults.push(result);
                }
                catch (err) {
                    linearResults.push(`❌ Failed to update issue: ${err.message}`);
                }
            }
        }
        else {
            resultLines.push(line);
        }
    }
    // Combine: clean AI text (without LINEAR_* lines) + linear results
    const cleanReply = resultLines.join('\n').trim();
    if (linearResults.length > 0) {
        return [cleanReply, ...linearResults].filter(Boolean).join('\n\n');
    }
    return cleanReply || aiReply;
}
// ─── Parse and execute Sentry commands from AI reply ────────────────────────
async function executeSentryCommands(dsn, aiReply) {
    const lines = aiReply.split('\n');
    const resultLines = [];
    const sentryResults = [];
    for (const line of lines) {
        if (line.startsWith('SENTRY_ISSUES:')) {
            const filter = line.slice('SENTRY_ISSUES:'.length).trim() || 'unresolved';
            try {
                const result = await sentryListIssues(dsn, filter);
                sentryResults.push(result);
            }
            catch (err) {
                sentryResults.push(`❌ Failed to fetch Sentry issues: ${err.message}`);
            }
        }
        else {
            resultLines.push(line);
        }
    }
    const cleanReply = resultLines.join('\n').trim();
    if (sentryResults.length > 0) {
        return [cleanReply, ...sentryResults].filter(Boolean).join('\n\n');
    }
    return cleanReply || aiReply;
}
// ─── Handle a mention (shared logic for app_mention and thread replies) ───────
async function handleMention(botToken, openaiKey, linearKey, sentryDsnValue, channel, threadTs, userId, currentMsg) {
    var _a, _b, _c;
    const TAG = '[slackEvents]';
    // 1. Start the streaming thinking indicator
    const stream = await startStream(botToken, channel, threadTs);
    // 2. Fetch full thread history for context
    const threadMessages = await fetchThreadHistory(botToken, channel, threadTs);
    // 3. Build OpenAI messages from thread history
    const messages = await buildMessagesFromThread(botToken, threadMessages, currentMsg.ts);
    // 4. Add the current message as the final user turn
    const currentText = stripMention((_a = currentMsg.text) !== null && _a !== void 0 ? _a : '');
    const currentImages = ((_b = currentMsg.files) !== null && _b !== void 0 ? _b : []).filter((f) => { var _a; return (_a = f.mimetype) === null || _a === void 0 ? void 0 : _a.startsWith('image/'); });
    const hasImages = currentImages.length > 0;
    if (hasImages) {
        const parts = [];
        if (currentText)
            parts.push({ type: 'text', text: currentText || 'What do you see in this image?' });
        for (const file of currentImages.slice(0, 3)) {
            const base64 = await downloadSlackImage(file.url_private, botToken);
            if (base64) {
                const mimeType = file.mimetype.split(';')[0];
                parts.push({
                    type: 'image_url',
                    image_url: {
                        url: `data:${mimeType};base64,${base64}`,
                        detail: 'high',
                    },
                });
            }
        }
        messages.push({ role: 'user', content: parts });
    }
    else {
        messages.push({ role: 'user', content: currentText || 'Hello!' });
    }
    // 5. Call OpenAI with full context
    let aiReply = '';
    try {
        aiReply = await getOpenAIReply(openaiKey, messages, hasImages);
    }
    catch (err) {
        console.error(TAG, 'OpenAI call failed:', err);
        const errMsg = "Sorry, I had trouble processing that. Please try again.";
        if (stream) {
            await stopStreamWithError(stream, errMsg);
        }
        else {
            await postSlackMessage(botToken, channel, errMsg, threadTs);
        }
        return;
    }
    // 6. Execute any Linear commands embedded in the AI reply
    let finalReply = aiReply;
    try {
        finalReply = await executeLinearCommands(linearKey, aiReply);
    }
    catch (err) {
        console.error(TAG, 'Linear command execution failed:', err);
        // Don't fail the whole response — just use the raw AI reply
        finalReply = aiReply;
    }
    // 6b. Execute any Sentry commands embedded in the AI reply
    try {
        finalReply = await executeSentryCommands(sentryDsnValue, finalReply);
    }
    catch (err) {
        console.error(TAG, 'Sentry command execution failed:', err);
        // Don't fail the whole response
    }
    // 7. Stop the stream with the final reply (or post directly if stream failed)
    if (stream) {
        await stopStream(stream, finalReply);
    }
    else {
        await postSlackMessage(botToken, channel, finalReply, threadTs);
    }
    // 8. Log to Firestore
    try {
        await admin.firestore().collection('slack_mentions').add({
            channel,
            threadTs,
            userId,
            text: (_c = currentMsg.text) !== null && _c !== void 0 ? _c : '',
            cleanMessage: currentText,
            aiReply: finalReply,
            hasImages,
            eventTs: currentMsg.ts,
            processedAt: admin.firestore.FieldValue.serverTimestamp(),
            status: 'completed',
        });
    }
    catch (err) {
        console.error(TAG, 'Failed to write mention to Firestore:', err);
    }
}
// ─── Cloud Function ───────────────────────────────────────────────────────────
exports.slackEvents = (0, https_1.onRequest)({
    region: 'us-central1',
    secrets: [slackSigningSecret, slackBotToken, openaiApiKey, linearApiKey, sentryDsn],
    timeoutSeconds: 60,
    invoker: 'public',
}, async (req, res) => {
    var _a, _b, _c;
    const TAG = '[slackEvents]';
    if (req.method !== 'POST') {
        res.status(405).send('Method Not Allowed');
        return;
    }
    // ── URL Verification Challenge ────────────────────────────────────────────
    const earlyPayload = req.body;
    if ((earlyPayload === null || earlyPayload === void 0 ? void 0 : earlyPayload.type) === 'url_verification') {
        console.log(TAG, 'Responding to URL verification challenge');
        res.status(200).json({ challenge: earlyPayload.challenge });
        return;
    }
    // ── Signature Verification ────────────────────────────────────────────────
    const timestamp = req.headers['x-slack-request-timestamp'];
    const signature = req.headers['x-slack-signature'];
    if (!timestamp || !signature) {
        res.status(400).send('Bad Request');
        return;
    }
    const rawBodyBuf = req.rawBody;
    const rawBody = rawBodyBuf ? rawBodyBuf.toString('utf8') : JSON.stringify(req.body);
    const signingSecretValue = slackSigningSecret.value();
    if (!verifySlackSignature(signingSecretValue, rawBody, timestamp, signature)) {
        console.warn(TAG, 'Invalid Slack signature — rejecting request');
        res.status(403).send('Forbidden');
        return;
    }
    const payload = req.body;
    const event = payload.event;
    if (!event) {
        res.status(200).send('');
        return;
    }
    const botToken = slackBotToken.value();
    const openaiKey = openaiApiKey.value();
    const linearKey = linearApiKey.value();
    const sentryDsnValue = sentryDsn.value();
    const eventType = event.type;
    console.log(TAG, `Received event type: ${eventType}`);
    // ── app_mention ───────────────────────────────────────────────────────────
    if (eventType === 'app_mention') {
        // Ignore bot messages
        if (event.bot_id) {
            res.status(200).send('');
            return;
        }
        const channel = event.channel;
        const threadTs = ((_a = event.thread_ts) !== null && _a !== void 0 ? _a : event.ts);
        const userId = event.user;
        console.log(TAG, `app_mention from ${userId} in ${channel}`);
        // Acknowledge immediately — Slack requires a 200 within 3 seconds
        res.status(200).send('');
        // Process asynchronously after acknowledging
        handleMention(botToken, openaiKey, linearKey, sentryDsnValue, channel, threadTs, userId, {
            ts: event.ts,
            text: event.text,
            user: userId,
            files: event.files,
        }).catch((err) => console.error(TAG, 'handleMention failed:', err));
        return;
    }
    // ── assistant_thread_started ──────────────────────────────────────────────
    if (eventType === 'assistant_thread_started') {
        const channelId = (_b = event.assistant_thread) === null || _b === void 0 ? void 0 : _b.channel_id;
        const threadTs = (_c = event.assistant_thread) === null || _c === void 0 ? void 0 : _c.thread_ts;
        console.log(TAG, `assistant_thread_started in ${channelId}`);
        res.status(200).send('');
        // Set suggested prompts asynchronously
        slackPost(botToken, 'assistant.threads.setSuggestedPrompts', {
            channel_id: channelId,
            thread_ts: threadTs,
            prompts: [
                { title: 'Check staging', message: 'Check the staging app and report what you see' },
                { title: 'Create a Linear issue', message: 'Create a Linear issue: ' },
                { title: 'List open issues', message: 'List all open Linear issues' },
                { title: 'Analyze this screenshot', message: 'Here is a screenshot — what do you see?' },
            ],
        }).catch((err) => console.warn(TAG, 'setSuggestedPrompts failed:', err));
        return;
    }
    // ── message: thread reply in a Marco thread ───────────────────────────────
    if (eventType === 'message' && !event.bot_id && !event.subtype) {
        const channel = event.channel;
        const threadTs = event.thread_ts;
        const userId = event.user;
        const isThreadReply = threadTs && threadTs !== event.ts;
        if (!isThreadReply) {
            res.status(200).send('');
            return;
        }
        // Only respond in threads Marco has already participated in
        let isMarcoThread = false;
        try {
            const snapshot = await admin
                .firestore()
                .collection('slack_mentions')
                .where('channel', '==', channel)
                .where('threadTs', '==', threadTs)
                .limit(1)
                .get();
            isMarcoThread = !snapshot.empty;
        }
        catch (err) {
            console.error(TAG, 'Firestore thread check failed:', err);
        }
        if (!isMarcoThread) {
            res.status(200).send('');
            return;
        }
        console.log(TAG, `Thread reply from ${userId} in ${channel} (thread: ${threadTs})`);
        // Acknowledge immediately
        res.status(200).send('');
        handleMention(botToken, openaiKey, linearKey, sentryDsnValue, channel, threadTs, userId, {
            ts: event.ts,
            text: event.text,
            user: userId,
            files: event.files,
        }).catch((err) => console.error(TAG, 'handleMention (thread reply) failed:', err));
        return;
    }
    console.log(TAG, `Unhandled event type: ${eventType} — ignoring`);
    res.status(200).send('');
});
//# sourceMappingURL=slack.js.map