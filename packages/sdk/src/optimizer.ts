import { TraceMessage } from "./types";

// ─── Regular Expressions ─────────────────────────────────────────────────────

// Entire sentences that are pure meta/politeness
const FILLER_SENTENCE_PATTERNS: RegExp[] = [
  /\b(thank you|thanks|many thanks|i('d| would) like to thank)\b[^.!?]*/gi,
  /\b(hello there|hi there|good (morning|afternoon|evening)|hope (you'?re?|this finds you))\b[^.!?]*/gi,
  /\b(i was wondering (if|whether)|would you mind|if (it'?s? )?possible)\b[^.!?]*/gi,
  /\b(looking forward to (your|hearing)|feel free to (ask|let me know)|let me know if (you need|there'?s?)|appreciate (your|it if))\b[^.!?]*/gi,
  /\b(as (an|a) AI|as a language model|i('m| am) an AI)\b[^.!?]*/gi,
];

const INLINE_FILLER_WORDS = [
  { regex: /\bplease\s*/gi, replacement: '' },
  { regex: /\bkindly\s*/gi, replacement: '' },
  { regex: /\bjust\s+(?=\w)/gi, replacement: '' },
  { regex: /\s*very\s+much\b/gi, replacement: '' },
  { regex: /,\s*,+/g, replacement: ',' },           // Fix: collapse multiple commas
  { regex: /\s{2,}/g, replacement: ' ' },
  { regex: /^[,.\s]+/, replacement: '' },           // Fix: trim leading punctuation
];

/**
 * Finds and collapses repeating substrings within a single line.
 * Example: "abcabcabc" -> "abc [↑ Inline repeat collapsed 2 times by Prompttrace]"
 */
function inlineDeduplicate(text: string): string {
  if (text.length < 20) return text;
  
  // Regex to find repeating sequences of at least 8 characters
  // that repeat at least 2 times consecutively.
  const repeatRegex = /(.{10,})\1+/g;
  
  return text.replace(repeatRegex, (match, group) => {
    const count = Math.floor(match.length / group.length);
    if (count > 1) {
      return `${group} [↑ Inline repeat collapsed ${count - 1} times by Prompttrace]`;
    }
    return match;
  });
}

function sequenceDeduplicate(text: string): string {
  // First, handle inline repeats within the entire block if it's single-line
  const inlineFixed = inlineDeduplicate(text);
  
  const lines = inlineFixed.split('\n').map(l => l.trimEnd());
  if (lines.length < 2) return inlineFixed;

  const result: string[] = [];
  const fingerprints = lines.map(l => l.trim().toLowerCase().replace(/\s+/g, ''));

  let i = 0;
  while (i < lines.length) {
    const finger = fingerprints[i];

    // Look for a repeating sequence of lines starting at 'i'
    // seqLen: how many lines are in the pattern we are testing
    let bestSeqLen = 0;
    let bestMatchCount = 0;

    // We check for sequences of length 1 to 20 lines
    for (let seqLen = 1; seqLen <= 20 && i + seqLen <= lines.length; seqLen++) {
      if (fingerprints.slice(i, i + seqLen).join('').length < 10) continue; // Skip trivial patterns

      let matchCount = 0;
      let nextStart = i + seqLen;

      // Look ahead for all consecutive occurrences
      while (nextStart + seqLen <= lines.length) {
        let allMatch = true;
        for (let k = 0; k < seqLen; k++) {
          if (fingerprints[i + k] !== fingerprints[nextStart + k]) {
            allMatch = false;
            break;
          }
        }
        if (allMatch) {
          matchCount++;
          nextStart += seqLen;
        } else {
          break;
        }
      }

      if (matchCount > bestMatchCount) {
        bestMatchCount = matchCount;
        bestSeqLen = seqLen;
      }
    }

    if (bestMatchCount > 0) {
      // Add the pattern once
      for (let k = 0; k < bestSeqLen; k++) {
        result.push(lines[i + k]);
      }
      // Add the collapse marker
      result.push(`\n[↑ Repeated ${bestMatchCount} more time${bestMatchCount > 1 ? 's' : ''} — collapsed by Prompttrace]\n`);
      // Skip all the consumed repeats
      i += (bestMatchCount + 1) * bestSeqLen;
    } else {
      result.push(lines[i]);
      i++;
    }
  }

  return result.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Surgical filler removal.
 */
function removeFillers(text: string): string {
  return text.split('\n\n').map(para => {
    let sentences = para.split(/([.!?]\s+)/);
    let cleanedSentences: string[] = [];

    for (let i = 0; i < sentences.length; i++) {
      let s = sentences[i];
      if (i % 2 !== 0) {
        cleanedSentences.push(s);
        continue;
      }

      let isFiller = false;
      for (const pattern of FILLER_SENTENCE_PATTERNS) {
        if (pattern.test(s)) {
          isFiller = true;
          break;
        }
      }

      if (isFiller && /\b(review|code|bug|fix|error|performance|security|list|step|how|what|why|prompt|trace)\b/i.test(s)) {
        isFiller = false;
      }

      if (!isFiller) {
        for (const cleaner of INLINE_FILLER_WORDS) {
          s = s.replace(cleaner.regex, cleaner.replacement);
        }
        cleanedSentences.push(s);
      } else if (i + 1 < sentences.length) {
        i++;
      }
    }

    return cleanedSentences.join('').replace(/,\s*,+/g, ',').replace(/\s{2,}/g, ' ').trim();
  }).filter(p => p.length > 0).join('\n\n');
}

export function optimizePrompt(messages: TraceMessage[]): TraceMessage[] {
  const optimized: TraceMessage[] = JSON.parse(JSON.stringify(messages));

  for (let i = 0; i < optimized.length; i++) {
    let content = optimized[i].content;

    // 1. Remove filler
    content = removeFillers(content);

    // 2. Collapse ALL consecutive repeats
    content = sequenceDeduplicate(content);

    optimized[i].content = content.trim();
  }

  return optimized.filter(m => m.content.length > 0 || m.role === 'assistant');
}
