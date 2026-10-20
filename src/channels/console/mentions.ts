export interface Mentionable {
  id: string;
  name: string;
}

// Only ASCII word characters bound a name, so `@Bobさん` still names Bob while `mail@bob.com` names no one.
const WORD_CHAR = /[A-Za-z0-9_]/;

/**
 * The participants named as `@<Agent Group name>` in `text`. At each `@` the longest
 * matching name wins, so `@Alice` never also mentions an Agent named `Al`.
 */
export function mentionedIn(text: string, participants: Mentionable[]): Set<string> {
  const byLength = participants.filter((p) => p.name).sort((a, b) => b.name.length - a.name.length);
  const lower = text.toLowerCase();
  const mentioned = new Set<string>();
  for (let at = lower.indexOf('@'); at !== -1; at = lower.indexOf('@', at + 1)) {
    if (at > 0 && WORD_CHAR.test(lower[at - 1])) continue;
    const hit = byLength.find((p) => {
      const name = p.name.toLowerCase();
      const next = lower[at + 1 + name.length];
      return lower.startsWith(name, at + 1) && (next === undefined || !WORD_CHAR.test(next));
    });
    if (hit) mentioned.add(hit.id);
  }
  return mentioned;
}
