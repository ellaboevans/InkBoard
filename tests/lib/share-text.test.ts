import { describe, expect, it } from "vitest";
import { poemPath, shareImageFileName, shareImagePath, shareText, whatsappShareUrl } from "@/lib/share-image/share-text";

/* What goes with the shared picture (docs/PLAN.md, Phase 21). */

describe("the share text", () => {
  it("is “Title” by Pen Name, on InkBoard: <absolute poem URL>", () => {
    expect(shareText({ title: "Nùnyá", penName: "Selorm Agbɔ", url: "https://tryinkboard.elabo.me/p/selorm-agbo/nunya" })).toBe(
      "“Nùnyá” by Selorm Agbɔ, on InkBoard: https://tryinkboard.elabo.me/p/selorm-agbo/nunya",
    );
  });

  it("trims stray spaces around the title and pen name", () => {
    expect(shareText({ title: "  Harmattan ", penName: " Abla Dzifa ", url: "https://x.test/p/a/b" })).toBe(
      "“Harmattan” by Abla Dzifa, on InkBoard: https://x.test/p/a/b",
    );
  });

  it("the WhatsApp link carries exactly that text, encoded", () => {
    const text = shareText({ title: "Àtí ɖèká & co", penName: "Selorm", url: "https://x.test/p/s/ati?x=1" });
    const url = new URL(whatsappShareUrl(text));
    expect(url.origin).toBe("https://wa.me");
    expect(url.searchParams.get("text")).toBe(text);
  });
});

describe("paths and the file name", () => {
  it("the image sits under the poem's own address", () => {
    expect(poemPath("abla-dzifa", "harmattan")).toBe("/p/abla-dzifa/harmattan");
    expect(shareImagePath("abla-dzifa", "harmattan")).toBe("/p/abla-dzifa/harmattan/share-image");
  });

  it("the file is inkboard-<slug>.png, safe for any file system", () => {
    expect(shareImageFileName("harmattan")).toBe("inkboard-harmattan.png");
    expect(shareImageFileName("a/../b c")).toBe("inkboard-a-b-c.png");
    expect(shareImageFileName("")).toBe("inkboard-poem.png");
  });
});
