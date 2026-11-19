/**
 * Demo novels for local testing, under the @seed.poemhub.test authors only.
 * Re-running replaces them (deletes those authors' novels first).
 * Copied for the launch reel: the two blurbs that named demo passwords were rewritten.
 * Run from the repo: tsx --conditions=react-server --tsconfig tsconfig.json <this file>
 */
import { config } from "dotenv";
config({ path: [".env.local", ".env"], quiet: true });

import sharp from "sharp";
import { and, eq, like } from "drizzle-orm";
import { getDb } from "@/db";
import { editors, novels } from "@/db/schema";
import { createChapter, createNovel, deleteNovel } from "@/server/novels";
import { saveCover } from "@/server/novel-covers";

type Ch = { title?: string; body: string; status?: "draft" | "published" };
type Demo = {
  author: string; // seed author slug
  title: string;
  blurb: string;
  language?: string;
  status?: "ongoing" | "complete";
  visibility?: "public" | "private";
  password?: string;
  cover?: [string, string, string]; // background, accent, text colour for a generated upload
  chapters: Ch[];
};

const P = (...paras: string[]) => paras.join("\n\n");

const LONG_RADIO = Array.from({ length: 14 }, (_, i) =>
  [
    "The radio talked to nobody. It talked about rain in the north and prices in the south, and once, late at night, about a boat that had not come home.",
    "Akua listened anyway. She had learned that a voice in an empty room is a kind of company, even when it says nothing you want to hear.",
    "Outside, the lake moved against the stones the way it always had, patient and careless, as if it had never taken anything from anyone.",
    "Her mother used to say the water keeps a ledger. Akua did not believe it. A ledger means someone means to pay.",
    "At four the generator coughed and stopped, and the radio stopped with it, and the silence that came after was louder than the news had been.",
    "She lit the lamp. The flame leaned toward the window as though it, too, was waiting for the sound of an engine.",
    "Somewhere across the water a dog barked three times and then thought better of it.",
  ][i % 7],
);

const DEMOS: Demo[] = [
  {
    author: "odalys-moon",
    title: "The Ferry at Yeji",
    blurb:
      "Every Thursday the ferry crosses Lake Volta, and every Thursday Akua waits at the landing for a brother who left three years ago. A slow, warm novel about waiting, rumours and the people who keep a small town afloat.",
    language: "en",
    status: "ongoing",
    cover: ["#1f3a4d", "#e8b04a", "#fdf6e3"],
    chapters: [
      {
        title: "Thursday",
        body: P(
          "^^The ferry came late that Thursday, as it always did in the rainy season. Akua waited at the landing with her basket of smoked fish on her knees and the radio on the step beside her, turned low.",
          "Nobody on the landing said a word when the engine noise came round the point. The women with baskets stood up together, the way birds lift off a wire.",
          "“Is it him?” asked the boy who sold sachet water. He asked every week.\n“Wait,” she said. “Wait and see.”",
          "* * *",
          "He did not come. The boatman shouted the names of the towns across the water, and the women with baskets pushed past her to the gangway, and Akua sat where she was until the ferry was only a smudge on the lake.",
          "She walked home the long way, past the church and the *chop bar* and the tailor who had made her brother's last good shirt. The tailor waved. She waved back. That was Thursday.",
        ),
      },
      {
        title: "The Radio",
        body: P("^^" + LONG_RADIO[0], ...LONG_RADIO.slice(1)),
      },
      {
        title: "Market Day",
        body: P(
          "^^“Fish, fish, fresh from Yeji!” Akua called, though the fish were two days old and everyone knew it.",
          "Auntie Esi bought three, as she always did, and stayed to talk, as she always did. She had heard from a cousin who had heard from a driver that a man fitting Kofi's description had been seen in Tamale, selling phone credit under a mango tree.",
          "“Fitting his description,” Akua said. “Half the men in Tamale fit his description.”",
          "“This one had his laugh,” said Auntie Esi, and paid, and left, and Akua stood holding the coins for a long time.",
          "* * *",
          "That night she wrote a letter she did not send. It began **Dear Kofi** and ended *your sister*, and in the middle it said everything she had not said at the landing.",
        ),
      },
      {
        title: "",
        body: P(
          "The rains broke early. For a week the ferry did not run at all, and the town turned inward, the way a house does when the door is shut.",
          "Akua mended nets for the Mensah boys and was paid in cassava. She did not mind. Her hands needed something to do.",
          "On the seventh day the sky cleared, and from the landing she could see the far shore again, green and close, as if she could wade across.",
        ),
      },
      { title: "Tamale", body: "A draft: Akua takes the bus north. Not finished yet.", status: "draft" },
    ],
  },
  {
    author: "amara-nwosu-bell",
    title: "Ʋu la ƒe Ŋkɔ",
    blurb:
      "Ʋu aɖe le ƒuta si ŋkɔ menye ame aɖeke nya o. Dzaƒo kple Mawuena, nɔviŋutsu kple nɔvinyɔnu, di be yewoanya ŋkɔ si wotsɔ na ʋu la le gbe xoxoawo me.",
    language: "ee",
    status: "complete",
    chapters: [
      {
        title: "Ŋdi Kanyaa",
        body: P(
          "^^Ŋdi kanyaa la, Mawuena yi ƒuta. Ʋu xoxo aɖe nɔ ke dzi, eƒe ta ɖo ɣedzeƒe. Ame aɖeke menya ame si tɔ wònye o.",
          "“Ʋu sia ƒe ŋkɔ ɖe?” wòbia eƒe nɔviŋutsu Dzaƒo.\n“Ŋkɔ meli o,” Dzaƒo gblɔ. “Ðe wòle be ŋkɔ nanɔ ʋu ŋu?”",
          "Mawuena ɖo to ƒu la. Ƒutsotsoewo nɔ dzidzim, eye ya nɔ ʋuʋum blewu. Míeyi futa. Ðevi la kpɔ ʋu la, eye wògblɔ bena: “Ɛ̃, dukɔ la ƒe ŋkɔ nyo.”",
          "* * *",
          "Fiẽ me la, wotrɔ va aƒeme. Woƒe dada nɔ dzo dom. Mawuena bia nya ʋu la ŋu, eye dada kpɔ ɖutsu la dzi esime wòɖo eŋu bena: “Ʋu sia ƒe ŋkɔ le ʋu la ŋutɔ ƒe dzi me.”",
        ),
      },
      {
        title: "Gbe Xoxoawo",
        body: P(
          "^^Ŋkekea ɖe ŋkeke la, eyi futa kple efe nɔvi. Àsí mètúné ò, gake efe dzi dzɔ.",
          "Wòkpɔ təsisi la, eye wòbu tame: “Ɛ, ɖe nàgbɔ gbe ɖeka.” Ŋdɔ la ɖo, eye ɣe la klẽ.",
          "Dzaƒo ŋlɔ nya siwo amegãwo gblɔ ɖe agbalẽ me: ŋkɔ siwo ʋuwo xɔ le blema, ŋkɔ siwo wotsɔ na ƒuƒoƒo, ŋkɔ siwo wotsɔ na ya.",
        ),
      },
      {
        title: "Ŋkɔ la",
        body: P(
          "^^Le nuwuwu la, wova kpɔe: ʋu la ƒe ŋkɔe nye *Dzidzɔ*. Wo dada ƒe dada tsɔe nɛ ŋkeke si dzi wòtrɔ va aƒeme tso ƒu didi aɖe dzi.",
          "Mawuena tsɔ amadede si ŋlɔ ŋkɔ la ɖe ʋu la ƒe akpa dzi. Ame sia ame si va ƒuta la xlẽe, eye wòko.",
        ),
      },
    ],
  },
  {
    author: "juniper-vale",
    title: "Ɔdɔ ne Ɛkaa",
    blurb: "Abena ne Kwabena dɔ wɔn ho, nanso wɔn abusua ntumi nnye ntom. Anwensɛm a ɛfa ɔdɔ ne ɛkaa ho.",
    language: "ak",
    status: "ongoing",
    cover: ["#5b1e2d", "#f2c14e", "#fff8ec"],
    chapters: [
      {
        title: "Nnwonkoro",
        body: P(
          "^^Ɛyɛ adeɛ a ɛyɛ nwonwa: ɔbɛba ɛnnɛ anaa ɔkyena? Abena twɛn wɔ abɔntenaso, n'ani da kwan no so.",
          "Kwabena baa anwummerɛ. Ɔde nnwonkoro bi a ne maame too no bere a ɔyɛ abofra bɛtoo ma no, na ne nne kaa ne koma.",
          "“Ɛdɛn na wo papa bɛka?” Abena bisaa.\n“Ɔbɛka sɛ ɔdɔ nni sika,” Kwabena buaa. “Na me nso mɛka sɛ sika nni ɔdɔ.”",
        ),
      },
      {
        title: "Abusua",
        body: P(
          "^^Abusua no hyiaa wɔ Nana fie. Mpanimfoɔ no tenaa ase komm, na nnipa nkumaa no gyinaa akyire.",
          "Ɔdɔ ne ɛkaa: nneɛma abien a ɛnam bom te sɛ nsuo ne ɛpo. Abena huu sɛ ne maame ani da so, nanso ɔkasaa nni.",
          "* * *",
          "Anadwo no, Abena kyerɛw krataa bi kɔmaa Kwabena. Ɛkaa sɛ: *Twɛn me.*",
        ),
      },
    ],
  },
  {
    author: "ines-calloway",
    title: "Letters to the Lighthouse Keeper",
    blurb:
      "A novel in letters between a woman on the cliff road and the keeper of the lamp that sweeps her ceiling every night.",
    language: "en",
    status: "ongoing",
    visibility: "private",
    password: "moonlight",
    cover: ["#24323f", "#f4d35e", "#eef2f5"],
    chapters: [
      {
        title: "The First Letter",
        body: P(
          "^^Dear keeper, you will not know me. I am the woman in the yellow house on the cliff road, the one whose kitchen light stays on too late.",
          "I am writing because your lamp has been sweeping my ceiling for eleven years, and it seems rude never to have said thank you.",
        ),
      },
      {
        title: "His Reply",
        body: P(
          "^^Dear yellow house, I know your light. I count it as one of mine.",
          "When it goes out early I worry, which is foolish, because a lighthouse keeper's job is ships, not kitchens.",
        ),
      },
    ],
  },
  {
    author: "amara-nwosu-bell",
    title: "The Shared Key",
    blurb:
      "One key in the house, on a red string by the door. A short family story about trust.",
    language: "en",
    visibility: "private",
    chapters: [
      {
        title: "Under One Lock",
        body: P(
          "^^There was one key in the house, and everyone knew where it hung. That was the point of it.",
          "Grandmother said a key you hide is a key you lose. So it hung by the door on a red string, and the door was locked every night, and nobody ever worried.",
        ),
      },
    ],
  },
  {
    author: "theo-lindqvist",
    title: "Salt",
    blurb: "A short story in one sitting: a fisherman, a storm, and the thing he brought back.",
    language: "en",
    status: "complete",
    chapters: [
      {
        title: "",
        body: P(
          "^^“Salt,” the old man said, when they asked him what the sea tasted like after forty years. “Same as the first day. Only now I know what it costs.”",
          "He had gone out on the morning of the storm because the fish were running and the children were hungry, and because he was young enough to think the sky was bluffing.",
          "It was not bluffing.",
          "* * *",
          "They found him two days later on the sandbar at Ada, holding a wooden box that was not his. Inside it was a single shoe, a child's, and a photograph too wet to read.",
          "He kept the box for the rest of his life. He never found the child, and he never stopped looking, and when people asked him why, he said: *because somebody should.*",
        ),
      },
    ],
  },
  {
    author: "bram-okafor",
    title: "Untitled Draft Novel",
    blurb: "Writer's side only: no chapter is published, so readers never see this novel.",
    chapters: [{ title: "Opening", body: "Just notes for now.", status: "draft" }],
  },
];

async function coverFile([bg, accent, ink]: [string, string, string], title: string) {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1200">
  <rect width="800" height="1200" fill="${bg}"/>
  <circle cx="560" cy="380" r="210" fill="${accent}" opacity="0.9"/>
  <path d="M0 820 Q200 760 400 820 T800 820 V1200 H0Z" fill="${accent}" opacity="0.35"/>
  <path d="M0 900 Q200 840 400 900 T800 900 V1200 H0Z" fill="${accent}" opacity="0.55"/>
  <text x="70" y="1080" font-family="Georgia, serif" font-size="68" fill="${ink}">${esc(title)}</text>
</svg>`;
  const jpeg = await sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toBuffer();
  return new Blob([new Uint8Array(jpeg)], { type: "image/jpeg" });
}

async function main() {
  const db = getDb();
  const seeds = await db
    .select({ id: editors.id, slug: editors.slug })
    .from(editors)
    .where(like(editors.email, "%@seed.poemhub.test"));
  const bySlug = new Map(seeds.map((e) => [e.slug, e.id]));

  for (const e of seeds) {
    const old = await db.select({ id: novels.id }).from(novels).where(eq(novels.editorId, e.id));
    for (const n of old) await deleteNovel(e.id, n.id);
  }

  for (const d of DEMOS) {
    const editorId = bySlug.get(d.author);
    if (!editorId) throw new Error(`No seed author ${d.author} (run pnpm db:seed first)`);
    const made = await createNovel(editorId, {
      title: d.title,
      blurb: d.blurb,
      language: d.language ?? "",
      status: d.status ?? "ongoing",
      visibility: d.visibility ?? "public",
      password: d.password ?? "",
    });
    if (!made.ok) throw new Error(`${d.title}: ${JSON.stringify(made)}`);
    const novelId = made.novel.id;
    for (const c of d.chapters) {
      const r = await createChapter(editorId, novelId, { title: c.title ?? "", body: c.body, status: c.status ?? "published" });
      if (!r.ok) throw new Error(`${d.title} / ${c.title}: ${JSON.stringify(r)}`);
    }
    let cover = "drawn cover";
    if (d.cover) {
      const r = await saveCover(editorId, novelId, { file: await coverFile(d.cover, d.title), crop: "0,0,1" });
      cover = r.ok ? "uploaded cover" : `cover failed: ${JSON.stringify(r)}`;
    }
    const [row] = await db.select({ slug: novels.slug }).from(novels).where(and(eq(novels.id, novelId)));
    console.log(`/a/${d.author}/n/${row.slug}  (${d.chapters.length} chapters, ${d.visibility ?? "public"}, ${cover})`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
