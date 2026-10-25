import * as admin from 'firebase-admin';
import { onCall, onRequest } from 'firebase-functions/v2/https';
import { createGuestRuntime } from './guestRuntime';
import { guestDeliveryHttp } from './guestDeliveryHttp';

const options = { region: 'us-central1', invoker: 'public' as const, maxInstances: 2, concurrency: 2, timeoutSeconds: 30 };
const runtime = () => createGuestRuntime(admin.app());
export const getGuestWorkoutAccess = onCall(options, async request => runtime().status(request.auth));
export const revokeGuestWorkoutLink = onCall(options, async request => runtime().revoke(request.auth, request.data));
export const issueGuestWorkoutLink = onCall(options, async request => runtime().issue(request.auth, request.data));
let handler: ReturnType<typeof guestDeliveryHttp> | undefined;
export const guestWorkoutMedia = onRequest({ ...options, cors: false }, async (req, res) => {
  if (!handler) { const current = runtime(); handler = guestDeliveryHttp(current.delivery, 'https://goarrive.fit', current.enabled); }
  await handler(req, res);
});
