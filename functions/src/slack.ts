/**
 * slack.ts — Slack Event Webhook Handler for Manus Bot
 *
 * ME-011: SLACK_SIGNING_SECRET must be set as a Firebase secret.
 *         firebase functions:secrets:set SLACK_SIGNING_SECRET
 * ME-012: SLACK_BOT_TOKEN must be set as a Firebase secret.
 *         firebase functions:secrets:set SLACK_BOT_TOKEN
 *
 * This function:
 *  1. Handles Slack URL verification challenge (required for event subscription setup)
 *  2. Verifies the Slack request signature (HMAC-SHA256) to reject spoofed requests
 *  3. Handles app_mention events — logs them and posts an acknowledgment reply
 *  4. Handles assistant_thread_started events (AI agent thread creation)
 *
 * Deployed URL format (staging):
 *   https://us-central1-goarrive-staging.cloudfunctions.net/slackEvents
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

const SLACK_API = 'https://slack.com/api';

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

// ─── Cloud Function ───────────────────────────────────────────────────────────

export const slackEvents = onRequest(
  {
    region: 'us-central1',
    secrets: [slackSigningSecret, slackBotToken],
    // Slack requires responses within 3 seconds — keep timeout tight
    timeoutSeconds: 10,
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

    // ── Acknowledge immediately (Slack requires 200 within 3s) ───────────────
    res.status(200).send('');

    // ── Process events asynchronously after ack ───────────────────────────────
    const event = payload.event as Record<string, any> | undefined;
    if (!event) {
      console.log(TAG, 'No event in payload, ignoring');
      return;
    }

    const botToken = slackBotToken.value();
    const eventType = event.type as string;

    console.log(TAG, `Received event type: ${eventType}`);

    // ── app_mention: @Manus was mentioned in a channel ────────────────────────
    if (eventType === 'app_mention') {
      const channel = event.channel as string;
      const threadTs = (event.thread_ts ?? event.ts) as string;
      const userText = (event.text as string) ?? '';
      const userId = event.user as string;

      console.log(TAG, `app_mention from ${userId} in ${channel}: ${userText}`);

      // Log the mention to Firestore for Manus to pick up
      try {
        await admin.firestore().collection('slack_mentions').add({
          channel,
          threadTs,
          userId,
          text: userText,
          eventTs: event.ts,
          processedAt: admin.firestore.FieldValue.serverTimestamp(),
          status: 'pending',
        });
      } catch (err) {
        console.error(TAG, 'Failed to write mention to Firestore:', err);
      }

      // Post an immediate acknowledgment in the thread
      await postSlackMessage(
        botToken,
        channel,
        `👋 Got it, <@${userId}>. I'm on it — give me a moment.`,
        threadTs
      );
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
      return;
    }

    // ── message.im: Direct message to the bot ────────────────────────────────
    if (eventType === 'message' && !event.bot_id) {
      const channel = event.channel as string;
      const threadTs = (event.thread_ts ?? event.ts) as string;
      const userId = event.user as string;
      const text = (event.text as string) ?? '';

      console.log(TAG, `DM from ${userId}: ${text}`);

      await postSlackMessage(
        botToken,
        channel,
        `Hi <@${userId}>! I received your message. I'm Manus — I handle browser-based tasks for GoArrive. Mention me in #dev-goarrive with what you need.`,
        threadTs
      );
      return;
    }

    console.log(TAG, `Unhandled event type: ${eventType} — ignoring`);
  }
);
