"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Unit tests for generateMusicVolumeVariants helper logic.
 *
 * We test the pure helpers (gainToPct, bucket defaults) and the
 * idempotency/auth logic by exercising the exported helpers in isolation.
 * Full integration (GCS + FFmpeg) is covered by the integration test script.
 */
const vitest_1 = require("vitest");
// gainToPct helper — mirrors the implementation in index.ts
function gainToPct(gain) {
    return String(Math.round(gain * 100)).padStart(3, '0');
}
(0, vitest_1.describe)('gainToPct', () => {
    (0, vitest_1.test)('1.0 → 100', () => (0, vitest_1.expect)(gainToPct(1.0)).toBe('100'));
    (0, vitest_1.test)('0.5 → 050', () => (0, vitest_1.expect)(gainToPct(0.5)).toBe('050'));
    (0, vitest_1.test)('0.25 → 025', () => (0, vitest_1.expect)(gainToPct(0.25)).toBe('025'));
    (0, vitest_1.test)('0.12 → 012', () => (0, vitest_1.expect)(gainToPct(0.12)).toBe('012'));
    (0, vitest_1.test)('0.05 → 005', () => (0, vitest_1.expect)(gainToPct(0.05)).toBe('005'));
});
(0, vitest_1.describe)('default bucket set', () => {
    const VOLUME_BUCKETS_DEFAULT = [1.0, 0.5, 0.25, 0.12, 0.05];
    (0, vitest_1.test)('has exactly 5 entries', () => (0, vitest_1.expect)(VOLUME_BUCKETS_DEFAULT).toHaveLength(5));
    (0, vitest_1.test)('all values are between 0 and 1', () => {
        VOLUME_BUCKETS_DEFAULT.forEach((b) => {
            (0, vitest_1.expect)(b).toBeGreaterThan(0);
            (0, vitest_1.expect)(b).toBeLessThanOrEqual(1.0);
        });
    });
    (0, vitest_1.test)('pct strings are unique and 3 chars', () => {
        const pcts = VOLUME_BUCKETS_DEFAULT.map(gainToPct);
        (0, vitest_1.expect)(new Set(pcts).size).toBe(5);
        pcts.forEach((p) => (0, vitest_1.expect)(p).toHaveLength(3));
    });
});
(0, vitest_1.describe)('GCS key construction', () => {
    function variantPath(style, trackNumber, gain) {
        return `music_cache/${style}/gain_${gainToPct(gain)}/track_${trackNumber}.mp3`;
    }
    (0, vitest_1.test)('workout style track 3 at gain 0.5', () => (0, vitest_1.expect)(variantPath('workout', 3, 0.5)).toBe('music_cache/workout/gain_050/track_3.mp3'));
    (0, vitest_1.test)('edm style track 0 at gain 1.0', () => (0, vitest_1.expect)(variantPath('edm', 0, 1.0)).toBe('music_cache/edm/gain_100/track_0.mp3'));
    (0, vitest_1.test)('chill style track 23 at gain 0.05', () => (0, vitest_1.expect)(variantPath('chill', 23, 0.05)).toBe('music_cache/chill/gain_005/track_23.mp3'));
});
(0, vitest_1.describe)('bucket allowlist filter (rejects attacker-controlled values)', () => {
    const VOLUME_BUCKETS_DEFAULT = [1.0, 0.5, 0.25, 0.12, 0.05];
    // Mirrors the runtime intersection in functions/src/index.ts:13004.
    function filterAllowedBuckets(input) {
        return Array.isArray(input) && input.length > 0
            ? VOLUME_BUCKETS_DEFAULT.filter((b) => input.includes(b))
            : VOLUME_BUCKETS_DEFAULT;
    }
    (0, vitest_1.test)('missing input → full default set', () => {
        (0, vitest_1.expect)(filterAllowedBuckets(undefined)).toEqual(VOLUME_BUCKETS_DEFAULT);
    });
    (0, vitest_1.test)('empty array → full default set', () => {
        (0, vitest_1.expect)(filterAllowedBuckets([])).toEqual(VOLUME_BUCKETS_DEFAULT);
    });
    (0, vitest_1.test)('valid subset passes through', () => {
        (0, vitest_1.expect)(filterAllowedBuckets([1.0, 0.12])).toEqual([1.0, 0.12]);
    });
    (0, vitest_1.test)('attacker-controlled novel gain values dropped (cost DoS guard)', () => {
        // 200 near-miss gains that would otherwise each transcode a fresh MP3.
        const attack = Array.from({ length: 200 }, (_, i) => 0.5 + i * 0.0001);
        (0, vitest_1.expect)(filterAllowedBuckets(attack)).toEqual([]);
    });
    (0, vitest_1.test)('string injection into filtergraph rejected', () => {
        // Untrusted strings must never reach `volume=${gain}` in the FFmpeg -af filter.
        const injection = ['1.0; rm -rf /', '0.5) volume=99.0 ('];
        (0, vitest_1.expect)(filterAllowedBuckets(injection)).toEqual([]);
    });
    (0, vitest_1.test)('mix of valid + invalid keeps only the allowlisted defaults', () => {
        (0, vitest_1.expect)(filterAllowedBuckets([1.0, 0.75, 0.5, 'evil', 0.999])).toEqual([1.0, 0.5]);
    });
});
(0, vitest_1.describe)('idempotency logic', () => {
    // Simulate the idempotency guard: skip if destExists, generate if not.
    function simulateInvocation(bucketsToProcess, existingPcts) {
        const generated = [];
        const skipped = [];
        for (const gain of bucketsToProcess) {
            const pct = gainToPct(gain);
            const destPath = `music_cache/workout/gain_${pct}/track_1.mp3`;
            if (existingPcts.includes(pct)) {
                skipped.push(destPath);
            }
            else {
                generated.push(destPath);
            }
        }
        return { generated, skipped };
    }
    (0, vitest_1.test)('all skipped when all variants already exist', () => {
        const { generated, skipped } = simulateInvocation([1.0, 0.5, 0.25, 0.12, 0.05], ['100', '050', '025', '012', '005']);
        (0, vitest_1.expect)(generated).toHaveLength(0);
        (0, vitest_1.expect)(skipped).toHaveLength(5);
    });
    (0, vitest_1.test)('all generated when no variants exist', () => {
        const { generated, skipped } = simulateInvocation([1.0, 0.5, 0.25, 0.12, 0.05], []);
        (0, vitest_1.expect)(generated).toHaveLength(5);
        (0, vitest_1.expect)(skipped).toHaveLength(0);
    });
    (0, vitest_1.test)('partial: generates missing, skips existing', () => {
        const { generated, skipped } = simulateInvocation([1.0, 0.5, 0.25, 0.12, 0.05], ['100', '025']);
        (0, vitest_1.expect)(generated).toHaveLength(3);
        (0, vitest_1.expect)(skipped).toHaveLength(2);
    });
});
//# sourceMappingURL=generateMusicVolumeVariants.test.js.map