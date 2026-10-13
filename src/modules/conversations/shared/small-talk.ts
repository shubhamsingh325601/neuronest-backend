/**
 * A message that is only a greeting, thanks, or a question about who the parent or child is. Conservative on
 * purpose: the whole message must match, so "hi, tell me the news" is not small talk. Used as a backstop: when
 * the model still answers one of these with the off-topic marker, the parent gets a friendly fixed reply and no
 * strike (plan 0019 section 14).
 */
const PATTERNS: RegExp[] = [
  /^(hi+|hii+|hello+|hey+|heya|hiya|hola|yo|namaste|namaskar|good (morning|afternoon|evening|night)|gm)( (there|everyone|team|ji))?$/,
  /^(ok(ay)? )?(thanks?|thank you|thx|ty|shukriya|dhanyavaad|bye|goodbye|ok(ay)?|cool|great|got it)( (a lot|so much|you))?$/,
  /^(who|what) am i$/,
  /^who(?: is|'s) (my )?(child|kid|son|daughter|baby|little one)$/,
  /^who are you$/,
  /^what (is|s) my (name|child'?s name)$/,
  /^what can you (do|help( me)? with)$/,
  /^(how are you|how r u|how do you do)$/,
  /^(main|mai) kaun (hu|hoon|hun)$/,
  /^(aap|tum) kaun (ho|hain)$/,
  /^(kaise ho|kaise hain aap)$/,
];

export function isSmallTalk(text: string): boolean {
  const normal = text
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^\p{L}\p{N}' ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (normal === '' || normal.length > 40) return false;
  return PATTERNS.some((p) => p.test(normal));
}
