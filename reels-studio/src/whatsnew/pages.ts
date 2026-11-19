/**
 * How a caption line is cut into one-line pages (the video's pill and the SRT
 * both use this): at most MAX_CHARS per page, preferring a break after
 * punctuation once a page has a few words. Pure, no imports.
 */
export const MAX_CHARS = 54;

export function pageBreaks(words: string[]): number[][] {
  const pages: number[][] = [];
  let cur: number[] = [];
  let len = 0;
  words.forEach((w, i) => {
    const add = (len ? 1 : 0) + w.length;
    if (cur.length && len + add > MAX_CHARS) {
      // Step back to the last punctuation in this page, if it leaves a decent page.
      let cut = -1;
      for (let k = cur.length - 1; k >= 1; k--) if (/[,.:;?!]$/.test(words[cur[k - 1]]) && k >= 2) { cut = k; break; }
      if (cut > 0 && cut < cur.length) {
        pages.push(cur.slice(0, cut));
        cur = cur.slice(cut);
      } else {
        pages.push(cur);
        cur = [];
      }
      len = cur.reduce((n, j) => n + words[j].length, 0) + Math.max(0, cur.length - 1);
    }
    cur.push(i);
    len += (cur.length > 1 ? 1 : 0) + w.length;
    // A sentence end with a full-ish page starts a new page.
    if (/[.?!]$/.test(w) && len >= 22 && i < words.length - 1) {
      pages.push(cur);
      cur = [];
      len = 0;
    }
  });
  if (cur.length) pages.push(cur);
  // Balance: a short last page (one word, or under 16 characters) takes words from the page before.
  const chars = (pg: number[]) => pg.reduce((n, j) => n + words[j].length, 0) + Math.max(0, pg.length - 1);
  for (let p = pages.length - 1; p >= 1; p--) {
    const a = pages[p - 1], b = pages[p];
    if (/[.?!]$/.test(words[a[a.length - 1]]) && b.length > 1) continue; // a sentence break: leave it
    while ((b.length === 1 || chars(b) < 16) && a.length > 2 && chars(b) + 1 + words[a[a.length - 1]].length <= MAX_CHARS) {
      b.unshift(a.pop() as number);
      if (chars(b) >= chars(a) - 6) break;
    }
  }
  return pages;
}
