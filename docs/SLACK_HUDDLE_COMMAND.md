# Slack `/huddle` Slash Command — Marco App Registration

Marco's Cloud Function (`slackEvents` in `functions/src/slack.ts`) handles the
`/huddle` slash command. The handler exists in code, but the slash command must
ALSO be registered in the Slack app config or Slack itself drops the request.

This is a one-time dashboard step. There is no manifest file in the repo —
Marco's Slack app is configured at api.slack.com.

## Steps

1. Open https://api.slack.com/apps and select Marco's app
   (app id starts with `A0B0947S7ND`; bot user id `U0AV3U11E8K`).
2. Left sidebar → **Slash Commands** → **Create New Command**.
3. Fill in:
   - **Command:** `/huddle`
   - **Request URL:** `https://us-central1-goarrive.cloudfunctions.net/slackEvents`
   - **Short description:** `Force a Marco + Maia two-agent huddle`
   - **Usage hint:** `[your question]`
   - **Escape channels, users, and links sent to your app:** leave unchecked.
4. **Save**.
5. Left sidebar → **Install App** → **Reinstall to Workspace** to grant the new
   `commands` scope.

## Verifying

After install, in any channel Marco is in:

```
/huddle why is the daily check-in stuck on staging?
```

Expected behavior:

- An ephemeral placeholder reply (only visible to you):
  `🤝 Huddle starting — Marco + Maia. The full reply will post in-channel shortly.`
- Within ~15s, an in-channel message with the synthesized answer plus a
  `*Huddle transcript*` footer showing Marco's initial take and Maia's
  real-context perspective.
- If the `ANTHROPIC_API_KEY` Firebase secret is missing or invalid, the
  reply will read `*Huddle aborted — Maia bridge failed.*` with the failure
  stage and detail (no silent degradation).

## Related code

- `functions/src/slack.ts` — `slackEvents` (handler), `getMaiaBrainReply` (Maia
  bridge with `MaiaBridgeError`), `runHuddle` (huddle abort flow),
  `formatHuddleTranscript` (transcript footer).
- `functions/src/__tests__/slack.test.ts` — regression tests locking in the
  fail-loud, transcript-on-success, and honesty-scrub contracts. Run with
  `npm run test:src` from `functions/`.
