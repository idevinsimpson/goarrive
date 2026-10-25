import type { Bucket } from '@google-cloud/storage';
import { unavailable } from './guestWorkoutCapability';

/** Inject only the configured Admin Storage bucket; no caller-controlled bucket,
 * URL fetch, signing, token generation, metadata mutation or global permissions. */
export function guestStorageReader(bucket: Bucket) {
  return {
    async metadata(path: string) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const [m] = await Promise.race([bucket.file(path).getMetadata(), new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(unavailable()), 10000);
        })]);
        return { size: Number(m.size), contentType: String(m.contentType || ''), generation: String(m.generation || '') };
      } catch { throw unavailable(); }
      finally { if (timer) clearTimeout(timer); }
    },
    async readRange(path: string, range: { start: number; end: number }, generation: string) {
      const expected = range.end - range.start + 1;
      if (!Number.isSafeInteger(expected) || expected < 1 || expected > 1024 * 1024) throw unavailable();
      const stream = bucket.file(path, { generation }).createReadStream({ start: range.start, end: range.end, validation: false });
      const timer = setTimeout(() => stream.destroy(unavailable()), 10000);
      let size = 0; const chunks: Buffer[] = [];
      try {
        for await (const data of stream) {
          const chunk = Buffer.from(data); size += chunk.length;
          if (size > expected) throw unavailable(); chunks.push(chunk);
        }
        if (size !== expected) throw unavailable(); return Buffer.concat(chunks, size);
      } catch { throw unavailable(); }
      finally { clearTimeout(timer); stream.destroy(); }
    },
  };
}
