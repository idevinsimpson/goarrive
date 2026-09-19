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

import { kit } from './ui/kit';

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
      {/* The trigger is a tertiary control: 44 px tall, underlined navy text. */}
      <Pressable
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        // aria-expanded is picked up on web via accessibilityState; add the raw
        // attribute too for browsers that only read the DOM.
        {...({ 'aria-expanded': open } as Record<string, unknown>)}
        testID={testID}
        style={kit.tertiaryButton}
      >
        <Text style={kit.tertiaryButtonText}>
          {triggerLabel} {open ? '▲' : '▼'}
        </Text>
      </Pressable>
      {open ? (
        <View
          style={kit.card}
          testID={`${testID}-panel`}
          {...({ role: 'region' } as Record<string, unknown>)}
        >
          {blocks.map((block, idx) =>
            block.type === 'heading' ? (
              <Text key={idx} style={kit.cardTitle}>
                {block.text}
              </Text>
            ) : (
              <Text key={idx} style={kit.body}>
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
  // The open panel sits a little under its trigger; the card's own gap
  // spaces the headings and paragraphs inside it.
  wrap: { gap: 4 },
});
