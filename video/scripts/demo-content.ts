/**
 * Demo content for the video walkthroughs, added on top of `pnpm db:seed`.
 * Every author here is fictional and uses an @example.com address (a
 * reserved domain: nothing is ever delivered there).
 *
 * The Akan, Ewe and Ga poems are short, well-known proverbs and greetings
 * rather than invented verse, with an English gloss in italics. Have a
 * native speaker check them before publishing the videos.
 */

export type DemoPoem = {
  title: string;
  body: string;
  language?: "ak" | "ee" | "gaa" | "en";
  private?: boolean;
};

export type DemoAuthor = {
  email: string;
  penName: string;
  tagline?: string;
  bio?: string;
  avatar?: string;
  links?: string[];
  pinned?: string;
  poems: DemoPoem[];
  collection?: { title: string; intro: string; poems: string[] };
};

/** Password of the demo private poems (as in scripts/seed-data.ts). */
export const DEMO_PASSWORD = "moonlight";

export const DEMO_AUTHORS: DemoAuthor[] = [
  {
    email: "ama.sewaa@example.com",
    penName: "Ama Sɛwaa",
    tagline: "Akan proverbs, written down so they keep",
    bio: "Writes in Twi and English. Collects the sayings her grandmother used.",
    avatar: "a05",
    links: ["https://example.com/ama-sewaa"],
    pinned: "Sankɔfa",
    poems: [
      {
        title: "Sankɔfa",
        language: "ak",
        body: "Sɛ wo werɛ fi na wosankɔfa a,\nyɛnkyiri.\n\n*It is no taboo to go back*\n*for what you forgot.*",
      },
      {
        title: "Abofra",
        language: "ak",
        body: "Obi nkyerɛ abofra Nyame.\n\n*No one has to show a child*\n*the Supreme Being.*",
      },
    ],
  },
  {
    email: "selorm.agbo@example.com",
    penName: "Selorm Agbɔ",
    tagline: "Ewe sayings, and what they carry",
    avatar: "a10",
    poems: [
      {
        title: "Nunya",
        language: "ee",
        body: "Nunya, adidoe,\nasi metunɛ o.\n\n*Knowledge is a baobab tree:*\n*no one pair of arms can hold it.*",
      },
      {
        title: "Ati ɖeka",
        language: "ee",
        body: "Ati ɖeka mewɔa ave o.\n\n*One tree does not make a forest.*",
      },
    ],
  },
  {
    email: "naa.oyoo@example.com",
    penName: "Naa Oyoo",
    tagline: "Small prayers by the sea",
    avatar: "a12",
    poems: [
      {
        title: "Oyiwala dɔŋŋ",
        language: "gaa",
        body: "Oyiwala dɔŋŋ,\nAtaa Naa Nyɔŋmɔ,\noyiwala dɔŋŋ.\n\n*Thank you,*\n*Father, Mother, God,*\n*thank you.*",
      },
    ],
  },
];

/** Extra profile details and collections for authors from `pnpm db:seed`. */
export const SEED_EXTRAS: {
  penName: string;
  tagline?: string;
  avatar?: string;
  links?: string[];
  pinned?: string;
  collection?: { title: string; intro: string; poems: string[] };
}[] = [
  {
    penName: "Odalys Moon",
    tagline: "Small poems, mostly before breakfast",
    avatar: "a03",
    links: ["https://example.com/odalys"],
    pinned: "Lantern",
    collection: {
      title: "Four Seasons, Briefly",
      intro: "Four small poems, one for each turn of the year.",
      poems: ["Snowmelt", "Rain on the Tin Roof", "Late Bloom", "First Frost"],
    },
  },
  {
    penName: "Ines Calloway",
    tagline: "Harbour poems",
    avatar: "a08",
    collection: {
      title: "Harbour Days",
      intro: "A week of tides, ferries and lights.",
      poems: ["Low Tide Inventory", "Harbour Lights", "Ferry, 6:40"],
    },
  },
  { penName: "Tomasz Reyes-Hart", avatar: "a02" },
  { penName: "Bram Okafor", avatar: "a09" },
  { penName: "Juniper Vale", avatar: "a04" },
  { penName: "Theo Lindqvist", avatar: "a06" },
  { penName: "Amara Nwosu-Bell", avatar: "a07" },
  { penName: "the quiet archivist", avatar: "a11" },
  { penName: "Ren Takahashi-Moreau", avatar: "a01" },
  { penName: "Wren Abernathy", avatar: "a14" },
];

/** The editor the writer chapters follow. Signs up on camera. */
export const WRITER = {
  email: "abla.demo@example.com",
  penName: "Abla Dzifa",
  /** The avatar she picks in the profile scene ("Avatar 21"). */
  avatarAfterProfile: "a21",
  /** Poems she already has when the writing chapter starts. */
  poems: [
    {
      title: "Harmattan",
      language: "en" as const,
      body: "the dry wind\nwrites on every window\nin a dust only the sun can read",
    },
    {
      title: "Market Day",
      language: "en" as const,
      body: "tomatoes stacked\nlike small red suns,\nmy mother bargaining\nfor the whole morning",
    },
  ],
};

/** A second, throwaway editor used only to rehearse the dev-server scenes. */
export const REHEARSAL = { email: "rehearsal.demo@example.com", penName: "Rehearsal Poet" };
