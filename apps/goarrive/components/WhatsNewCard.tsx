/**
 * WhatsNewCard — Dashboard card showing the latest platform_releases notes.
 *
 * Shows sent/queued releases (title + feature blurbs + Try-it-now deep links),
 * collapsible and dismissible per release (dismissal persists per user via
 * AsyncStorage), plus a "Share an idea" link to /feedback.
 */
import React, { useEffect, useState, useCallback } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { router } from 'expo-router';
import { db } from '../lib/firebase';
import { useAuth } from '../lib/AuthContext';
import { Icon } from './Icon';
import { BORDER, FB, FG, FH, GOLD, MUTED } from '../lib/theme';

const MAX_RELEASES = 3;

interface ReleaseFeature {
  name: string;
  blurb: string;
  deepLink?: string;
}

interface Release {
  id: string;
  title: string;
  bodyMarkdown: string;
  features: ReleaseFeature[];
  sortMillis: number;
}

function dismissKey(uid: string) {
  return `whatsNewDismissed:${uid}`;
}

function openDeepLink(link: string) {
  if (/^https?:\/\//.test(link)) {
    // Internal deep links open in-app instead of a new tab
    const m = link.match(/^https?:\/\/(?:www\.)?(?:goarrive\.fit|goarrive\.web\.app|goarrive\.firebaseapp\.com)(\/.*)$/);
    if (m && m[1]) {
      router.push(m[1] as any);
    } else {
      Linking.openURL(link).catch(() => {});
    }
  } else {
    router.push(link as any);
  }
}

export default function WhatsNewCard() {
  const { user } = useAuth();
  const uid = user?.uid || '';

  const [releases, setReleases] = useState<Release[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    (async () => {
      try {
        const [snap, stored] = await Promise.all([
          getDocs(
            query(
              collection(db, 'platform_releases'),
              where('status', 'in', ['sent', 'queued']),
            ),
          ),
          AsyncStorage.getItem(dismissKey(uid)),
        ]);
        if (cancelled) return;
        const items: Release[] = snap.docs
          .map((d) => {
            const data = d.data() as any;
            const ts = data.sentAt || data.createdAt;
            return {
              id: d.id,
              title: data.title || 'Platform update',
              bodyMarkdown: data.bodyMarkdown || '',
              features: Array.isArray(data.features) ? data.features : [],
              sortMillis: ts?.toMillis?.() ?? 0,
            };
          })
          .sort((a, b) => b.sortMillis - a.sortMillis)
          .slice(0, MAX_RELEASES);
        setReleases(items);
        setDismissed(stored ? JSON.parse(stored) : []);
      } catch (err) {
        console.error('[WhatsNewCard] load error:', err);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [uid]);

  const dismissRelease = useCallback(
    (releaseId: string) => {
      setDismissed((prev) => {
        const next = [...prev, releaseId];
        AsyncStorage.setItem(dismissKey(uid), JSON.stringify(next)).catch(() => {});
        return next;
      });
    },
    [uid],
  );

  const visible = releases.filter((r) => !dismissed.includes(r.id));
  if (!loaded || visible.length === 0) return null;

  return (
    <View style={s.card}>
      <View style={s.headerRow}>
        <View style={s.headerLeft}>
          <Text style={s.eyebrow}>{"WHAT'S NEW"}</Text>
          <Text style={s.title}>Fresh in GoArrive</Text>
        </View>
        <Icon name="zap" size={18} color={GOLD} />
      </View>

      {visible.map((release) => {
        const isExpanded = expanded[release.id] !== false; // expanded by default
        return (
          <View key={release.id} style={s.releaseBlock}>
            <View style={s.releaseHeaderRow}>
              <Pressable
                style={s.releaseHeaderLeft}
                onPress={() =>
                  setExpanded((prev) => ({ ...prev, [release.id]: !isExpanded }))
                }
                hitSlop={6}
              >
                <Icon
                  name={isExpanded ? 'chevron-down' : 'chevron-right'}
                  size={14}
                  color={MUTED}
                />
                <Text style={s.releaseTitle}>{release.title}</Text>
              </Pressable>
              <Pressable onPress={() => dismissRelease(release.id)} hitSlop={10} style={s.dismissBtn}>
                <Icon name="x" size={14} color="#4A5568" />
              </Pressable>
            </View>

            {isExpanded && (
              <View style={s.releaseBody}>
                {!!release.bodyMarkdown && (
                  <Text style={s.body}>{release.bodyMarkdown.replace(/\*\*/g, '')}</Text>
                )}
                {release.features.map((f, i) => (
                  <View key={i} style={s.featureRow}>
                    <Text style={s.featureName}>{f.name}</Text>
                    {!!f.blurb && <Text style={s.featureBlurb}>{f.blurb}</Text>}
                    {!!f.deepLink && (
                      <Pressable style={s.tryBtn} onPress={() => openDeepLink(f.deepLink!)}>
                        <Text style={s.tryBtnText}>Try it now</Text>
                        <Icon name="chevron-right" size={12} color={GOLD} />
                      </Pressable>
                    )}
                  </View>
                ))}
              </View>
            )}
          </View>
        );
      })}

      <Pressable style={s.shareIdeaRow} onPress={() => router.push('/(app)/feedback' as any)}>
        <Icon name="share" size={14} color={GOLD} />
        <Text style={s.shareIdeaText}>Share an idea — your feedback shapes what we build</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: '#131A27',
    borderWidth: 1,
    borderColor: 'rgba(125,211,252,0.25)',
    borderRadius: 16,
    padding: 16,
    marginTop: 12,
    gap: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  headerLeft: { gap: 4 },
  eyebrow: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
    color: '#7DD3FC',
    fontFamily: FB,
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    color: FG,
    fontFamily: FH,
  },
  releaseBlock: {
    borderTopWidth: 1,
    borderTopColor: BORDER,
    paddingTop: 12,
    gap: 8,
  },
  releaseHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  releaseHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  releaseTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    color: FG,
    fontFamily: FH,
  },
  dismissBtn: { padding: 2 },
  releaseBody: { gap: 8, paddingLeft: 20 },
  body: {
    fontSize: 13,
    color: MUTED,
    fontFamily: FB,
    lineHeight: 18,
  },
  featureRow: {
    backgroundColor: '#0E1320',
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 10,
    padding: 12,
    gap: 4,
  },
  featureName: {
    fontSize: 13,
    fontWeight: '700',
    color: GOLD,
    fontFamily: FH,
  },
  featureBlurb: {
    fontSize: 13,
    color: MUTED,
    fontFamily: FB,
    lineHeight: 18,
  },
  tryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    marginTop: 4,
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.4)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  tryBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: GOLD,
    fontFamily: FB,
  },
  shareIdeaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: BORDER,
    paddingTop: 12,
  },
  shareIdeaText: {
    flex: 1,
    fontSize: 13,
    color: GOLD,
    fontFamily: FB,
    fontWeight: '600',
  },
});
