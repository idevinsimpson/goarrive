/**
 * huddle-bridge.ts — Marco-side handler for the real cross-bot huddle system (Huddle v2)
 *
 * Architecture:
 *   Maia writes a `huddle_turn` document to `agent_messages` (to: "marco").
 *   This Firestore-triggered function picks it up, generates Marco's real OpenAI
 *   response using the full huddle history, and writes the reply back to
 *   `agent_messages` (to: "maia") so Maia can continue the loop.
 *
 *   When the huddle is complete (turn_index >= max turns OR Maia writes
 *   type: "huddle_complete"), Marco posts the final transcript to Slack.
 *
 * Schema for `agent_messages` documents (huddle_turn type):
 *   {
 *     type:              "huddle_turn"
 *     huddle_id:         string          — unique ID shared across all turns of one huddle
 *     turn_index:        number          — 1-based turn counter (Maia writes odd, Marco writes even)
 *     topic:             string          — the original huddle question/topic
 *     assigned_position: string | null   — "advocate_pro" | "advocate_con" | null (honest mode)
 *     mode:              "advocate" | "honest" | "red-team"
 *     from:              "maia" | "marco"
 *     to:                "marco" | "maia"
 *     message:           string          — the turn content
 *     slack_channel:     string          — Slack channel to post final transcript
 *     slack_thread_ts:   string          — Slack thread to reply into
 *     slack_user_id:     string          — Devin's Slack user ID (for @mention in final post)
 *     status:            "pending" | "processing" | "done" | "error"
 *     createdAt:         Timestamp
 *     processedAt?:      Timestamp
 *   }
 *
 * ME-011: SLACK_SIGNING_SECRET — already set
 * ME-012: SLACK_BOT_TOKEN — already set
 * ME-013: OPENAI_API_KEY — already set
 */

import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { defineSecret } from 'firebase-functions/params';
import * as admin from 'firebase-admin';

const slackBotToken = defineSecret('SLACK_BOT_TOKEN');
const openaiApiKey = defineSecret('OPENAI_API_KEY');
const anthropicApiKey = defineSecret('ANTHROPIC_API_KEY');

const OPENAI_API = 'https://api.openai.com/v1';
const SLACK_API = 'https://slack.com/api';

// Maximum turns per agent per huddle (4 turns each = 8 total turns + 1 synthesis)
const MAX_TURNS_PER_AGENT = 4;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface HuddleTurnDoc {
  type: 'huddle_turn' | 'huddle_complete';
  huddle_id: string;
  turn_index: number;
  topic: string;
  assigned_position: 'advocate_pro' | 'advocate_con' | null;
  mode: 'advocate' | 'honest' | 'red-team';
  role?: 'chair' | 'steward'; // Maia alternates chair/steward per round
  from: 'maia' | 'marco';
  to: 'marco' | 'maia';
  message: string;
  slack_channel: string;
  slack_thread_ts: string;
  slack_user_id: string;
  status: 'pending' | 'processing' | 'done' | 'error';
  createdAt: admin.firestore.Timestamp;
  processedAt?: admin.firestore.Timestamp;
}

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// ─── Slack helpers ────────────────────────────────────────────────────────────

async function slackPost(
  botToken: string,
  method: string,
  body: Record<string, unknown>
): Promise<any> {
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

/** Convert Markdown to Slack mrkdwn (mirrors the slackify in slack.ts). */
function slackify(text: string): string {
  if (!text) return text;
  const parts: Array<{ code: boolean; text: string }> = [];
  const fence = /```[\s\S]*?```/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = fence.exec(text))) {
    if (m.index > last) parts.push({ code: false, text: text.slice(last, m.index) });
    parts.push({ code: true, text: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ code: false, text: text.slice(last) });

  return parts
    .map((p) => {
      if (p.code) return p.text;
      let t = p.text;
      t = t.replace(/\*\*([^*\n]+?)\*\*/g, '*$1*');
      t = t.replace(/__([^_\n]+?)__/g, '*$1*');
      t = t.replace(/^#{1,6}\s+(.+)$/gm, '*$1*');
      t = t.replace(/&amp;/g, '&');
      return t;
    })
    .join('');
}

async function postSlackMessage(
  botToken: string,
  channel: string,
  text: string,
  threadTs?: string
): Promise<void> {
  const body: Record<string, unknown> = {
    channel,
    text: slackify(text),
    mrkdwn: true,
  };
  if (threadTs) body.thread_ts = threadTs;
  const json = await slackPost(botToken, 'chat.postMessage', body);
  if (!json.ok) {
    console.error('[huddleBridge] chat.postMessage error:', json.error);
  }
}

// ─── OpenAI helper ────────────────────────────────────────────────────────────

async function getOpenAIReply(
  apiKey: string,
  messages: OpenAIMessage[]
): Promise<string> {
  const res = await fetch(`${OPENAI_API}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-5.5',
      messages,
      max_completion_tokens: 600,
    }),
  });

  const json = (await res.json()) as {
    choices?: Array<{ message: { content: string } }>;
    error?: { message: string };
  };

  if (json.error) {
    console.error('[huddleBridge] OpenAI error:', json.error.message);
    throw new Error(json.error.message);
  }

  return json.choices?.[0]?.message?.content?.trim() ?? '(No response from Marco)';
}

// ─── Load shared brain (mirrors slack.ts) ────────────────────────────────────

async function loadSharedBrain(): Promise<string> {
  try {
    const snapshot = await admin.firestore().collection('agent_shared_brain').get();
    const priority = [
      'interaction_rules',
      'agent_task_routing',
      'product_identity',
      'do_not_build',
      'current_state_and_roadmap',
    ];
    const docs = new Map<string, string>();
    snapshot.forEach((doc) => {
      if (doc.id !== '_meta') {
        const data = doc.data();
        docs.set(doc.id, `## ${data.filename || doc.id}\n${data.content || ''}`);
      }
    });
    const sections: string[] = [];
    for (const id of priority) {
      if (docs.has(id)) sections.push(docs.get(id)!);
    }
    docs.forEach((content, id) => {
      if (!priority.includes(id)) sections.push(content);
    });
    return sections.join('\n\n---\n\n');
  } catch (err) {
    console.warn('[huddleBridge] Failed to load shared brain:', err);
    return '';
  }
}

// ─── Load full huddle history for a given huddle_id ──────────────────────────

async function loadHuddleHistory(huddleId: string): Promise<HuddleTurnDoc[]> {
  const snapshot = await admin
    .firestore()
    .collection('agent_messages')
    .where('huddle_id', '==', huddleId)
    .where('type', '==', 'huddle_turn')
    .orderBy('turn_index', 'asc')
    .get();

  return snapshot.docs.map((d) => d.data() as HuddleTurnDoc);
}

// ─── Build Marco's system prompt for a huddle turn ───────────────────────────

function buildMarcoHuddleSystemPrompt(
  topic: string,
  mode: HuddleTurnDoc['mode'],
  assignedPosition: HuddleTurnDoc['assigned_position'],
  sharedBrain: string
): string {
  const positionNote =
    mode === 'advocate' && assignedPosition
      ? `\n\nYou are in ADVOCATE mode. Your assigned position is: ${assignedPosition === 'advocate_pro' ? 'PRO (argue in favor)' : 'CON (argue against)'}. This is a labeled exercise — argue your assigned side with conviction. Both agents' positions are labeled as an exercise in the final transcript.`
      : mode === 'red-team'
      ? `\n\nYou are in RED-TEAM mode. Your job is to attack, challenge, and stress-test Maia's position. Find every flaw, edge case, and risk. Be relentless but constructive.`
      : '';

  const brainSection = sharedBrain
    ? `\n\n## GoArrive Shared Knowledge Base\n${sharedBrain.slice(0, 2000)}`
      : '';

  return `You are Marco (My Autonomous Resource & Coordination Operator), a strategic advisor embedded in the GoArrive Slack workspace.

You are in a LIVE HUDDLE with Maia (the GoArrive code agent). This is a real back-and-forth conversation — not a simulation. Each turn is generated by the real agent.

Huddle topic: "${topic}"${positionNote}

Rules for this huddle:
1. Be specific — use names (Jefferson, Sandy, Devin), project names (JT, GoArrive, Georgia Movement), and concrete details when relevant.
2. Take a clear position — do not hedge. If asked to cut/double-down/replace, pick one and defend it.
3. Challenge Maia — if she agrees too easily, push harder. If she makes a point you missed, acknowledge it AND add a counter-consideration.
4. Name the trade-off — every recommendation has a cost. State it explicitly.
5. Keep each turn under 150 words. Be punchy, not exhaustive.
6. Do NOT include HUDDLE_DECISION, LINEAR_*, SENTRY_*, or MAIA_TASK: lines in this huddle.
7. Do NOT say "As Marco" or refer to yourself in the third person.${brainSection}`;
}

// ─── Build the conversation messages array from huddle history ────────────────

function buildHuddleMessages(
  history: HuddleTurnDoc[],
  systemPrompt: string
): OpenAIMessage[] {
  const messages: OpenAIMessage[] = [{ role: 'system', content: systemPrompt }];

  for (const turn of history) {
    if (turn.from === 'marco') {
      messages.push({ role: 'assistant', content: turn.message });
    } else {
      // Maia's turns appear as user messages from Marco's perspective
      const label =
        turn.turn_index === 1
          ? `Maia's opening position:\n${turn.message}`
          : `Maia's response:\n${turn.message}\n\nYour turn. Acknowledge her strongest point, then push back on the one you disagree with most. Stay under 150 words.`;
      messages.push({ role: 'user', content: label });
    }
  }

  return messages;
}

// ─── Build the final transcript for Slack ────────────────────────────────────

function buildTranscriptSlackMessage(
  topic: string,
  history: HuddleTurnDoc[],
  synthesis: string,
  mode: HuddleTurnDoc['mode'],
  assignedPosition: HuddleTurnDoc['assigned_position']
): string {
  const modeLabel =
    mode === 'advocate'
      ? `_Mode: Advocate exercise — positions are assigned, not genuine convictions_`
      : mode === 'red-team'
      ? `_Mode: Red-team — Marco attacks, Maia defends_`
      : `_Mode: Honest — both agents argue their genuine positions_`;

  // Group turns into rounds (Maia + Marco pairs)
  const rounds: Array<{ maia?: string; marco?: string }> = [];
  let currentRound: { maia?: string; marco?: string } = {};

  for (const turn of history) {
    if (turn.from === 'maia') {
      if (currentRound.maia !== undefined) {
        rounds.push(currentRound);
        currentRound = {};
      }
      currentRound.maia = turn.message;
    } else {
      currentRound.marco = turn.message;
      rounds.push(currentRound);
      currentRound = {};
    }
  }
  if (currentRound.maia || currentRound.marco) {
    rounds.push(currentRound);
  }

  const transcriptBlock = rounds
    .map((r, i) => {
      const lines: string[] = [`:speech_balloon: *Round ${i + 1}*`];
      if (r.maia) lines.push(`*Maia:* ${r.maia}`);
      if (r.marco) lines.push(`*Marco:* ${r.marco}`);
      return lines.join('\n');
    })
    .join('\n\n');

  return `*Huddle v2: ${topic.slice(0, 80)}${topic.length > 80 ? '...' : ''}*\n${modeLabel}\n\n${transcriptBlock}\n\n---\n\n*Synthesis*\n${synthesis}`;
}

// ─── Generate synthesis after all turns are complete ─────────────────────────

async function generateSynthesis(
  openaiKey: string,
  topic: string,
  history: HuddleTurnDoc[]
): Promise<string> {
  const transcriptText = history
    .map((t) => `${t.from === 'maia' ? 'Maia' : 'Marco'} (Turn ${t.turn_index}): ${t.message}`)
    .join('\n\n');

  const messages: OpenAIMessage[] = [
    {
      role: 'system',
      content: `You are Marco, synthesizing a completed huddle debate for Devin Simpson.`,
    },
    {
      role: 'user',
      content: `Here is the full huddle transcript on the topic: "${topic}"\n\n${transcriptText}\n\nNow synthesize this into a final, actionable answer for Devin. Format:\n1. *Recommendation* — one clear sentence on what to do\n2. *Why* — 2-3 sentences of the strongest reasoning from both sides\n3. *Trade-off* — what you're giving up with this choice\n4. *Next action* — one concrete next step Devin can take today\n\nDo NOT say "Marco says" or "Maia says". Write as a unified voice.`,
    },
  ];

  return getOpenAIReply(openaiKey, messages);
}

// ─── Main Cloud Function: marcoHuddleTurn ────────────────────────────────────

export const marcoHuddleTurn = onDocumentCreated(
  {
    document: 'agent_messages/{messageId}',
    region: 'us-central1',
    secrets: [slackBotToken, openaiApiKey, anthropicApiKey],
    timeoutSeconds: 300,
    memory: '512MiB',
  },
  async (event) => {
    const TAG = '[marcoHuddleTurn]';
    const snap = event.data;
    if (!snap) return;

    const data = snap.data() as HuddleTurnDoc;

    // Only handle huddle_turn messages addressed to Marco
    if (data.type !== 'huddle_turn' || data.to !== 'marco') {
      return;
    }

    // Skip if already processed (idempotency guard)
    if (data.status !== 'pending') {
      console.log(TAG, `Skipping — status is "${data.status}" for huddle_id=${data.huddle_id}`);
      return;
    }

    const {
      huddle_id,
      turn_index,
      topic,
      assigned_position,
      mode,
      slack_channel,
      slack_thread_ts,
      slack_user_id,
    } = data;

    console.log(TAG, `Processing huddle_id=${huddle_id} turn_index=${turn_index}`);

    // Mark as processing (optimistic lock)
    try {
      await snap.ref.update({
        status: 'processing',
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch (err) {
      console.error(TAG, 'Failed to mark as processing:', err);
      return;
    }

    const botToken = slackBotToken.value();
    const openaiKey = openaiApiKey.value();

    try {
      // Load all prior turns for this huddle
      const history = await loadHuddleHistory(huddle_id);
      console.log(TAG, `Loaded ${history.length} prior turns for huddle_id=${huddle_id}`);

      // Load shared brain context
      const sharedBrain = await loadSharedBrain();

      // Determine if this is the final turn (Marco's MAX_TURNS_PER_AGENT-th turn)
      // Marco turns are even-indexed (2, 4, 6, 8); Maia turns are odd-indexed (1, 3, 5, 7)
      const marcoTurnCount = history.filter((t) => t.from === 'marco').length;
      const isLastTurn = marcoTurnCount + 1 >= MAX_TURNS_PER_AGENT;

      // Build system prompt and conversation messages
      const systemPrompt = buildMarcoHuddleSystemPrompt(
        topic,
        mode,
        assigned_position,
        sharedBrain
      );

      let conversationMessages: OpenAIMessage[];

      if (isLastTurn) {
        // Final turn: ask Marco to wrap up and signal synthesis is ready
        const historyMessages = buildHuddleMessages(history, systemPrompt);
        historyMessages.push({
          role: 'user',
          content: `This is your final turn. Give your strongest closing argument in under 150 words. Make it count — this is what Devin will remember.`,
        });
        conversationMessages = historyMessages;
      } else {
        conversationMessages = buildHuddleMessages(history, systemPrompt);
      }

      // Generate Marco's response
      const marcoReply = await getOpenAIReply(openaiKey, conversationMessages);
      console.log(TAG, `Marco reply (turn ${turn_index + 1}):`, marcoReply.slice(0, 80));

      // Write Marco's turn back to agent_messages
      const marcoTurnDoc: Omit<HuddleTurnDoc, 'processedAt'> = {
        type: 'huddle_turn',
        huddle_id,
        turn_index: turn_index + 1,
        topic,
        assigned_position,
        mode,
        from: 'marco',
        to: isLastTurn ? 'maia' : 'maia', // always reply to Maia; she decides if huddle is done
        message: marcoReply,
        slack_channel,
        slack_thread_ts,
        slack_user_id,
        status: 'pending',
        createdAt: admin.firestore.Timestamp.now(),
      };

      await admin.firestore().collection('agent_messages').add(marcoTurnDoc);
      console.log(TAG, `Wrote Marco turn ${turn_index + 1} to agent_messages`);

      // If this was Marco's last turn, also generate synthesis and post to Slack
      if (isLastTurn) {
        console.log(TAG, 'Final turn — generating synthesis and posting to Slack');

        // Include Marco's just-written turn in the full history for synthesis
        const fullHistory: HuddleTurnDoc[] = [
          ...history,
          { ...marcoTurnDoc, turn_index: turn_index + 1 } as HuddleTurnDoc,
        ];

        const synthesis = await generateSynthesis(openaiKey, topic, fullHistory);
        const transcriptMessage = buildTranscriptSlackMessage(
          topic,
          fullHistory,
          synthesis,
          mode,
          assigned_position
        );

        await postSlackMessage(botToken, slack_channel, transcriptMessage, slack_thread_ts);
        console.log(TAG, 'Posted final huddle transcript to Slack');

        // Write a huddle_complete marker so Maia knows the loop is closed
        await admin.firestore().collection('agent_messages').add({
          type: 'huddle_complete',
          huddle_id,
          topic,
          from: 'marco',
          to: 'maia',
          message: synthesis,
          slack_channel,
          slack_thread_ts,
          slack_user_id,
          status: 'done',
          createdAt: admin.firestore.Timestamp.now(),
        });
      }

      // Mark the incoming turn as done
      await snap.ref.update({ status: 'done' });
      console.log(TAG, `Completed processing huddle_id=${huddle_id} turn_index=${turn_index}`);

      // Log to agent_memory
      await admin.firestore().collection('agent_memory').add({
        agent: 'marco',
        eventType: 'huddle_turn_processed',
        summary: `Marco responded in huddle "${topic.slice(0, 60)}" (turn ${turn_index + 1})`,
        details: {
          huddle_id,
          turn_index: turn_index + 1,
          mode,
          isLastTurn,
          replyPreview: marcoReply.slice(0, 200),
        },
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch (err: any) {
      console.error(TAG, 'Error processing huddle turn:', err);
      await snap.ref.update({ status: 'error' });

      // Post error notice to Slack so Devin knows the huddle stalled
      try {
        await postSlackMessage(
          botToken,
          slack_channel,
          `⚠️ Marco encountered an error on huddle turn ${turn_index + 1}: ${err.message ?? 'Unknown error'}. The huddle may be incomplete.`,
          slack_thread_ts
        );
      } catch (slackErr) {
        console.error(TAG, 'Failed to post error to Slack:', slackErr);
      }
    }
  }
);
