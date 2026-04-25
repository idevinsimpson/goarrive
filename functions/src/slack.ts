/**
 * slack.ts — Slack Event Webhook Handler for MARCO Bot (Manus Autonomous Resource & Coordination Operator)
 *
 * ME-011: SLACK_SIGNING_SECRET must be set as a Firebase secret.
 *         firebase functions:secrets:set SLACK_SIGNING_SECRET
 * ME-012: SLACK_BOT_TOKEN must be set as a Firebase secret.
 *         firebase functions:secrets:set SLACK_BOT_TOKEN
 * ME-013: OPENAI_API_KEY must be set as a Firebase secret.
 *         firebase functions:secrets:set OPENAI_API_KEY
 *
 * This function:
 *  1. Handles Slack URL verification challenge (required for event subscription setup)
 *  2. Verifies the Slack request signature (HMAC-SHA256) to reject spoofed requests
 *  3. Handles app_mention events — acknowledges immediately, then calls OpenAI and
 *     posts a real AI reply in the thread
 *  4. Handles assistant_thread_started events (AI agent thread creation)
 *
 * Deployed URL:
 *   https://us-central1-goarrive.cloudfunctions.net/slackEvents
 *
 * Register this URL in:
 *   https://api.slack.com/apps/A0AUQ8SCVQF/event-subscriptions
 */

import * as crypto from 'crypto';
import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import * as admin from 'firebase-admin';

const slackSigningSecret = defineSecret('SLACK_SIGNING_SECRET');
const slackBotToken = defineSecret('SLACK_BOT_TOKEN');
const openaiApiKey = defineSecret('OPENAI_API_KEY');

const SLACK_API = 'https://slack.com/api';
const OPENAI_API = 'https://api.openai.com/v1';

// ─── Signature Verification ──────────────────────────────────────────────────

function verifySlackSignature(
  signingSecret: string,
  rawBody: string,
  timestamp: string,
  signature: string
): boolean {
  // Reject requests older than 5 minutes to prevent replay attacks
  const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 5 * 60;
  if (parseInt(timestamp, 10) < fiveMinutesAgo) return false;

  const baseString = `v0:${timestamp}:${rawBody}`;
  const hmac = crypto
    .createHmac('sha256', signingSecret)
    .update(baseString)
    .digest('hex');
  const computedSig = `v0=${hmac}`;

  // Constant-time comparison to prevent timing attacks
  return crypto.timingSafeEqual(
    Buffer.from(computedSig, 'utf8'),
    Buffer.from(signature, 'utf8')
  );
}

// ─── Post a message to Slack ─────────────────────────────────────────────────

async function postSlackMessage(
  botToken: string,
  channel: string,
  text: string,
  threadTs?: string
): Promise<void> {
  const body: Record<string, unknown> = { channel, text };
  if (threadTs) body.thread_ts = threadTs;

  const res = await fetch(`${SLACK_API}/chat.postMessage`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${botToken}`,
    },
    body: JSON.stringify(body),
  });

  const json = (await res.json()) as { ok: boolean; error?: string };
  if (!json.ok) {
    console.error('[slackEvents] chat.postMessage error:', json.error);
  }
}

// ─── Set Slack Assistant Status (Loading Indicator) ──────────────────────────

async function setSlackStatus(
  botToken: string,
  channel: string,
  threadTs: string,
  status: string
): Promise<void> {
  const body = {
    channel_id: channel,
    thread_ts: threadTs,
    status,
  };

  const res = await fetch(`${SLACK_API}/assistant.threads.setStatus`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${botToken}`,
    },
    body: JSON.stringify(body),
  });

  const json = (await res.json()) as { ok: boolean; error?: string };
  if (!json.ok) {
    console.error('[slackEvents] assistant.threads.setStatus error:', json.error);
  }
}

// ─── Call OpenAI to generate a reply ─────────────────────────────────────────

async function getOpenAIReply(apiKey: string, userMessage: string): Promise<string> {
  const systemPrompt = `You are MARCO (Manus Autonomous Resource & Coordination Operator), an AI agent embedded in the GoArrive Slack workspace.
GoArrive (G➲A) is a fitness coaching platform. You help the dev team (Devin, Maia) with tasks like:
- Browser-based QA and testing of the staging app
- Checking dashboards (Firebase, Stripe, GCP)
- Answering questions about the product and codebase
- Coordinating with Maia (the code/deploy agent) on tasks

Keep replies concise and practical. If asked to do something that requires browsing or checking a dashboard, say you're on it and will report back. If you can answer directly, do so. Your name is MARCO — not Manus.`;

  const res = await fetch(`${OPENAI_API}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4.1-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      max_tokens: 500,
      temperature: 0.7,
    }),
  });

  const json = (await res.json()) as {
    choices?: Array<{ message: { content: string } }>;
    error?: { message: string };
  };

  if (json.error) {
    console.error('[slackEvents] OpenAI error:', json.error.message);
    return "Sorry, I ran into an issue processing that. Try again in a moment.";
  }

  return json.choices?.[0]?.message?.content?.trim() ?? "I didn't get a response. Try again?";
}

// ─── Strip @mention from message text ────────────────────────────────────────

function stripMention(text: string): string {
  // Remove all <@USERID> mentions from the text and trim
  return text.replace(/<@[A-Z0-9]+>/g, '').trim();
}

// ─── Cloud Function ───────────────────────────────────────────────────────────

export const slackEvents = onRequest(
  {
    region: 'us-central1',
    secrets: [slackSigningSecret, slackBotToken, openaiApiKey],
    // OpenAI call adds latency — give enough time but stay reasonable
    timeoutSeconds: 30,
    invoker: 'public',
  },
  async (req, res) => {
    const TAG = '[slackEvents]';

    // ── Only accept POST ──────────────────────────────────────────────────────
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    // ── Signature verification ────────────────────────────────────────────────
    const timestamp = req.headers['x-slack-request-timestamp'] as string;
    const signature = req.headers['x-slack-signature'] as string;

    if (!timestamp || !signature) {
      console.warn(TAG, 'Missing Slack signature headers');
      res.status(400).send('Bad Request');
      return;
    }

    // Firebase provides the raw body as a Buffer on req.rawBody
    const rawBody = (req as any).rawBody?.toString('utf8') ?? JSON.stringify(req.body);

    const signingSecretValue = slackSigningSecret.value();
    if (!verifySlackSignature(signingSecretValue, rawBody, timestamp, signature)) {
      console.warn(TAG, 'Invalid Slack signature — rejecting request');
      res.status(403).send('Forbidden');
      return;
    }

    const payload = req.body as Record<string, any>;

    // ── URL Verification Challenge (one-time setup) ───────────────────────────
    if (payload.type === 'url_verification') {
      console.log(TAG, 'Responding to URL verification challenge');
      res.status(200).json({ challenge: payload.challenge });
      return;
    }

    // ── Process events ────────────────────────────────────────────────────────
    const event = payload.event as Record<string, any> | undefined;
    if (!event) {
      console.log(TAG, 'No event in payload, ignoring');
      res.status(200).send('');
      return;
    }

    const botToken = slackBotToken.value();
    const openaiKey = openaiApiKey.value();
    const eventType = event.type as string;

    console.log(TAG, `Received event type: ${eventType}`);

    // ── app_mention: @Manus was mentioned in a channel ────────────────────────
    if (eventType === 'app_mention') {
      const channel = event.channel as string;
      const threadTs = (event.thread_ts ?? event.ts) as string;
      const userText = (event.text as string) ?? '';
      const userId = event.user as string;

      // Ignore messages from bots (prevents loops)
      if (event.bot_id) {
        console.log(TAG, 'Ignoring bot message in app_mention');
        res.status(200).send('');
        return;
      }

      console.log(TAG, `app_mention from ${userId} in ${channel}: ${userText}`);

      // Strip the @Manus mention to get the clean user message
      const cleanMessage = stripMention(userText);

      // 1. Fire setStatus in background (non-blocking — only works in DM threads)
      setSlackStatus(botToken, channel, threadTs, 'MARCO is thinking...').catch(
        (err) => console.warn(TAG, 'setStatus failed (non-fatal):', err)
      );

      // 2. Get OpenAI reply and post it directly (no pre-ack message)
      let aiReply = '';
      try {
        aiReply = await getOpenAIReply(openaiKey, cleanMessage || 'Hello!');
      } catch (err) {
        console.error(TAG, 'OpenAI call failed:', err);
        aiReply = "Sorry, I had trouble processing that. Please try again.";
      }

      // 3. Post the AI reply in the thread
      await postSlackMessage(botToken, channel, aiReply, threadTs);

      // 5. Log the mention to Firestore
      try {
        await admin.firestore().collection('slack_mentions').add({
          channel,
          threadTs,
          userId,
          text: userText,
          cleanMessage,
          aiReply,
          eventTs: event.ts,
          processedAt: admin.firestore.FieldValue.serverTimestamp(),
          status: 'completed',
        });
      } catch (err) {
        console.error(TAG, 'Failed to write mention to Firestore:', err);
      }

      res.status(200).send('');
      return;
    }

    // ── assistant_thread_started: AI agent thread was opened ─────────────────
    if (eventType === 'assistant_thread_started') {
      const channelId = event.assistant_thread?.channel_id as string;
      const threadTs = event.assistant_thread?.thread_ts as string;

      console.log(TAG, `assistant_thread_started in ${channelId} at ${threadTs}`);

      // Set suggested prompts for the AI agent thread
      try {
        await fetch(`${SLACK_API}/assistant.threads.setSuggestedPrompts`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            Authorization: `Bearer ${botToken}`,
          },
          body: JSON.stringify({
            channel_id: channelId,
            thread_ts: threadTs,
            prompts: [
              { title: 'Check staging', message: 'Check the staging app and report what you see' },
              { title: 'Run QA on a flow', message: 'Run QA on the member onboarding flow' },
              { title: 'What did Maia deploy?', message: 'What was the last thing Maia deployed?' },
            ],
          }),
        });
      } catch (err) {
        console.error(TAG, 'Failed to set suggested prompts:', err);
      }
      res.status(200).send('');
      return;
    }

     // ── message: channel message or DM (including thread replies) ─────────────
    if (eventType === 'message' && !event.bot_id && !event.subtype) {
      const channel = event.channel as string;
      const threadTs = event.thread_ts as string | undefined;
      const userId = event.user as string;
      const text = (event.text as string) ?? '';

      // Only respond to thread replies (thread_ts present and different from event.ts)
      // This handles replies in Manus threads without needing @mention.
      // For top-level channel messages, we rely on app_mention instead.
      const isThreadReply = threadTs && threadTs !== event.ts;

      if (!isThreadReply) {
        // Top-level channel message without @mention — ignore
        res.status(200).send('');
        return;
      }

      // Only respond if this is a thread Manus has already posted in
      // (tracked in Firestore as slack_mentions). This prevents Manus from
      // jumping into every thread in the channel.
      let isManusThread = false;
      try {
        const snapshot = await admin
          .firestore()
          .collection('slack_mentions')
          .where('channel', '==', channel)
          .where('threadTs', '==', threadTs)
          .limit(1)
          .get();
        isManusThread = !snapshot.empty;
      } catch (err) {
        console.error(TAG, 'Firestore thread check failed:', err);
      }

      if (!isManusThread) {
        console.log(TAG, `Thread reply in non-Manus thread ${threadTs} — ignoring`);
        res.status(200).send('');
        return;
      }

      console.log(TAG, `Thread reply from ${userId} in ${channel} (thread: ${threadTs}): ${text}`);

      // Get AI reply
      let aiReply = '';
      try {
        aiReply = await getOpenAIReply(openaiKey, text || 'Hello!');
      } catch (err) {
        console.error(TAG, 'OpenAI call failed in thread reply:', err);
        aiReply = "Sorry, I had trouble with that. Please try again.";
      }

      await postSlackMessage(botToken, channel, aiReply, threadTs);
      res.status(200).send('');
      return;
    }

    console.log(TAG, `Unhandled event type: ${eventType} — ignoring`);
    res.status(200).send('');
  }
);
