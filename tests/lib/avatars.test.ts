import { describe, expect, it } from "vitest";
import { AVATARS, avatarIdFor, defaultAvatarId, isAvatarId } from "@/lib/avatars";
import { renderAvatarSvg } from "@/server/avatar-svg";

describe("avatars", () => {
  it("has 36 unique, stable ids", () => {
    expect(AVATARS).toHaveLength(36);
    expect(new Set(AVATARS.map((a) => a.id)).size).toBe(36);
    expect(AVATARS[0]).toEqual({ id: "a01", seed: "poemhub-avatar-01", paletteId: "terracotta" });
  });

  it("gives every editor a stable default from the set", () => {
    const id = "b672a737-8fd9-4aee-8f12-1c118427ab92";
    expect(defaultAvatarId(id)).toBe(defaultAvatarId(id));
    expect(isAvatarId(defaultAvatarId(id))).toBe(true);
    expect(avatarIdFor({ id, avatar: "a05" })).toBe("a05");
    expect(avatarIdFor({ id, avatar: "bogus" })).toBe(defaultAvatarId(id));
  });

  it("renders deterministic, script-free SVGs and refuses unknown ids", () => {
    const svg = renderAvatarSvg("a07")!;
    expect(svg.startsWith("<svg")).toBe(true);
    expect(renderAvatarSvg("a07")).toBe(svg);
    expect(svg).not.toMatch(/<script|\son\w+=|javascript:/i);
    expect(renderAvatarSvg("a99")).toBeNull();
    expect(renderAvatarSvg("../x")).toBeNull();
  });
});
