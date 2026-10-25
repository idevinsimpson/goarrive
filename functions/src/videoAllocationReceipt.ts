/** Receipt failure must disable new video, never retry provider meeting creation. */
export async function saveVideoReceipt(write: () => Promise<unknown>): Promise<boolean> {
  try { await write(); return true; }
  catch { console.warn('[workout-video] Allocation receipt unavailable; new video stays disabled.'); return false; }
}
