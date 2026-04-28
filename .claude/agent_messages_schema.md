# Agent Messages Schema

This document defines the schema for the `agent_messages` Firestore collection. This collection acts as the communication bridge between GoArrive's AI agents (Maia and Marco).

## Purpose

The `agent_messages` collection enables asynchronous, cross-agent communication. It allows one agent to enqueue a message, update, or task for the other agent to process. The primary use case is the **Multi-Agent Huddle (v2)**, where Marco and Maia debate a topic in a multi-turn, real-time Slack thread.

## Document Types

### 1. General Messages
Used for general updates or notifications between agents (e.g., Maia telling Marco she completed a task).

```typescript
interface GeneralAgentMessage {
  type: 'message'; // or undefined in older records
  from: 'maia' | 'marco';
  to: 'marco' | 'maia';
  message: string;
  status: 'pending' | 'read';
  createdAt: admin.firestore.Timestamp;
  readAt?: admin.firestore.Timestamp;
}
```

### 2. Huddle Turns (`huddle_turn`)
Used for the cross-bot live huddle system. Each document represents one agent's turn in the debate.

```typescript
interface HuddleTurnDoc {
  type: 'huddle_turn';
  huddle_id: string;           // Unique ID shared across all turns of one huddle
  turn_index: number;          // 1-based turn counter (Maia writes odd, Marco writes even)
  topic: string;               // The original huddle question/topic
  assigned_position: 'advocate_pro' | 'advocate_con' | null; // null means honest mode
  mode: 'advocate' | 'honest' | 'red-team';
  from: 'maia' | 'marco';
  to: 'marco' | 'maia';
  message: string;             // The turn content
  slack_channel: string;       // Slack channel to post final transcript
  slack_thread_ts: string;     // Slack thread to reply into
  slack_user_id: string;       // Devin's Slack user ID (for @mention in final post)
  status: 'pending' | 'processing' | 'done' | 'error';
  createdAt: admin.firestore.Timestamp;
  processedAt?: admin.firestore.Timestamp;
}
```

### 3. Huddle Complete (`huddle_complete`)
Written by Marco after he generates the final synthesis. This signals to Maia that the huddle loop is closed.

```typescript
interface HuddleCompleteDoc {
  type: 'huddle_complete';
  huddle_id: string;
  topic: string;
  from: 'marco';
  to: 'maia';
  message: string;             // The final synthesis
  slack_channel: string;
  slack_thread_ts: string;
  slack_user_id: string;
  status: 'done';
  createdAt: admin.firestore.Timestamp;
}
```

## Workflows

### Huddle v2 Loop
1. **Initiation**: Maia (triggered via her own process) generates her first turn and writes a `huddle_turn` document to `agent_messages` with `to: "marco"`, `turn_index: 1`, and `status: "pending"`.
2. **Marco Processing**: The `marcoHuddleTurn` Cloud Function (in `huddle-bridge.ts`) listens for `onDocumentCreated`. It picks up the pending turn, marks it `processing`, reads the full huddle history, generates Marco's response, and writes a new `huddle_turn` document back to `agent_messages` with `to: "maia"`, `turn_index: 2`, and `status: "pending"`.
3. **Continuation**: Maia picks up Marco's turn, generates her rebuttal, and writes `turn_index: 3`. This continues until the maximum turn count is reached (currently 4 turns per agent).
4. **Completion**: On Marco's final turn, he generates a synthesis of the entire debate, posts the formatted transcript to Slack, and writes a `huddle_complete` document to signal the end of the loop.
