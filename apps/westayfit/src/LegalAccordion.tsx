/**
 * Inline expandable panel for legal copy. Renders a small markdown-ish subset:
 *  - lines starting with `# ` become a heading
 *  - blank lines become paragraph breaks
 *  - everything else is a paragraph
 * That covers what we ship — placeholder now, approved text later — without
 * pulling a full markdown lib into web bundle.
 *
 * Accessibility: the trigger is a Pressable with role="button" and
 * aria-expanded. The panel is announced when it opens; nothing is visually
 * hidden when closed (unmounted from the tree entirely so screen readers do
 * not read stale copy).
 */
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { wsfTheme } from './theme';

type MarkdownBlock =
  | { type: 'heading'; text: string }
  | { type: 'paragraph'; text: string };

function parseMarkdown(source: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const lines = source.split(/\r?\n/);
  let paragraphBuffer: string[] = [];
  const flushParagraph = () => {
    if (paragraphBuffer.length === 0) return;
    const text = paragraphBuffer.join(' ').trim();
    if (text) blocks.push({ type: 'paragraph', text });
    paragraphBuffer = [];
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith('# ')) {
      flushParagraph();
      blocks.push({ type: 'heading', text: line.slice(2).trim() });
    } else if (line === '') {
      flushParagraph();
    } else {
      paragraphBuffer.push(line);
    }
  }
  flushParagraph();
  return blocks;
}

export function LegalAccordion({
  triggerLabel,
  markdown,
  testID,
}: {
  triggerLabel: string;
  markdown: string;
  testID: string;
}) {
  const [open, setOpen] = useState(false);
  const blocks = parseMarkdown(markdown);
  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        // aria-expanded is picked up on web via accessibilityState; add the raw
        // attribute too for browsers that only read the DOM.
        {...({ 'aria-expanded': open } as Record<string, unknown>)}
        testID={testID}
        style={styles.trigger}
      >
        <Text style={styles.triggerText}>
          {triggerLabel} {open ? '\u25B2' : '\u25BC'}
        </Text>
      </Pressable>
      {open ? (
        <View
          style={styles.panel}
          testID={`${testID}-panel`}
          {...({ role: 'region' } as Record<string, unknown>)}
        >
          {blocks.map((block, idx) =>
            block.type === 'heading' ? (
              <Text key={idx} style={styles.heading}>
                {block.text}
              </Text>
            ) : (
              <Text key={idx} style={styles.paragraph}>
                {block.text}
              </Text>
            )
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: wsfTheme.spacing.sm,
  },
  trigger: {
    paddingVertical: wsfTheme.spacing.xs,
  },
  triggerText: {
    color: wsfTheme.colors.primary,
    fontSize: wsfTheme.typography.body.fontSize,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  panel: {
    marginTop: wsfTheme.spacing.sm,
    padding: wsfTheme.spacing.md,
    borderWidth: 1,
    borderColor: wsfTheme.colors.border,
    borderRadius: wsfTheme.radius.sm,
    backgroundColor: wsfTheme.colors.surface,
  },
  heading: {
    color: wsfTheme.colors.text,
    fontSize: wsfTheme.typography.subheading.fontSize,
    fontWeight: wsfTheme.typography.subheading.fontWeight,
    lineHeight: wsfTheme.typography.subheading.lineHeight,
    marginBottom: wsfTheme.spacing.sm,
  },
  paragraph: {
    color: wsfTheme.colors.text,
    fontSize: wsfTheme.typography.body.fontSize,
    lineHeight: wsfTheme.typography.body.lineHeight,
    marginBottom: wsfTheme.spacing.sm,
  },
});
