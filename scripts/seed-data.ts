/**
 * Demo content for `pnpm db:seed`. All authors are fictional and all poems
 * were written for this project. Private poems use SEED_PASSWORD (each poem
 * has its own copy), except authors with `sharedPassword`, whose private
 * poems all open with SEED_SHARED_PASSWORD.
 */

export const SEED_PASSWORD = "moonlight";
/** Authors with `sharedPassword: true` use one password for all private poems. */
export const SEED_SHARED_PASSWORD = "lanternlight";

export type SeedPoem = {
  title: string;
  body: string;
  private?: boolean;
  draft?: boolean;
  /** Days before now it was published (for ordering). */
  daysAgo?: number;
};

export type SeedAuthor = {
  penName: string;
  bio?: string;
  /** One password (SEED_SHARED_PASSWORD) for all of this author's private poems. */
  sharedPassword?: boolean;
  poems: SeedPoem[];
};

export const SEED_AUTHORS: SeedAuthor[] = [
  {
    penName: "Ines Calloway",
    bio: "Writes from a flat above a harbour chandlery.",
    poems: [
      {
        title: "Low Tide Inventory",
        daysAgo: 3,
        body: `one blue rope, frayed at the wrist,
a crab shell turned to a teacup,
the moon's thumbprint on wet sand,
and you, counting what the sea forgot
    as if it might come back for it.`,
      },
      {
        title: "Harbour Lights",
        daysAgo: 12,
        body: `The boats come in like tired dogs,
nosing the pier for a place to sleep.
Somebody's radio plays a song
my mother used to hum while ironing,
and the water holds every lamp
the way I hold her voice:
    broken up, but still bright.`,
      },
      {
        title: "Salt",
        daysAgo: 30,
        body: `It gets into everything here,
the hinges, the bread, the letters
I never send.
Even my sleep tastes of it.`,
      },
      {
        title: "What the Lighthouse Keeper Kept",
        daysAgo: 44,
        private: true,
        body: `A drawer of postcards addressed to no one.
A clock that only ran in storms.
A name she said into the lamp each night
so the ships would know which way was home.`,
      },
      {
        title: "Ferry, 6:40",
        daysAgo: 60,
        body: `Commuters with their coffee halos,
gulls doing arithmetic in the wake.
Nobody speaks. Everyone agrees
the island is closer than yesterday.`,
      },
      {
        title: "Driftwood",
        draft: true,
        body: `unfinished: something about hands
smoothed by the same water`,
      },
    ],
  },
  {
    penName: "Tomasz Reyes-Hart",
    poems: [
      {
        title: "Night Bus Psalm",
        daysAgo: 1,
        body: `Blessed is the driver who waits
for the running woman with the shopping bags.
Blessed the window fogged with breath
and the boy who draws a door in it.
Blessed the last stop,
    which is somebody's first.`,
      },
      {
        title: "Laundromat, 2 a.m.",
        daysAgo: 9,
        body: `Forty minutes of warm machinery.
A stranger's red sock in my load
like a small confession.
I fold it with the others. I keep it.`,
      },
      {
        title: "Fire Escape",
        daysAgo: 21,
        body: `We called it the balcony,
which was generous of us.
Basil in a coffee tin,
two chairs that never matched,
the whole city below like a radio
tuned slightly off the station.`,
      },
      {
        title: "Elegy for a Corner Shop",
        daysAgo: 35,
        private: true,
        body: `Mr. Adeyemi knew my tea, my mood, my rent.
When the shutters came down for good
he left the bell on the door.
I still hear it some mornings,
announcing no one.`,
      },
      {
        title: "Rooftop Antennae",
        daysAgo: 70,
        body: `A forest of listening.
Everyone tuned to a different weather.`,
      },
    ],
  },
  {
    penName: "Odalys Moon",
    bio: "Small poems, mostly before breakfast.",
    poems: [
      { title: "First Frost", daysAgo: 2, body: `the garden bench\nwears a thin grey coat —\nnobody sits` },
      { title: "Kettle", daysAgo: 4, body: `the kettle's long vowel —\nmorning\nlearning to speak` },
      { title: "Moth", daysAgo: 6, body: `against the window\na moth rehearses\nits one argument` },
      { title: "Rain on the Tin Roof", daysAgo: 8, body: `rain on the tin roof\nall night the house\ncounts its own bones` },
      { title: "Commute", daysAgo: 11, body: `crowded train —\nsomeone's daffodils\nlighting the carriage` },
      { title: "Old Letters", daysAgo: 14, private: true, body: `your handwriting\nleans toward me\nstill` },
      { title: "Late Bloom", daysAgo: 17, body: `october rose\nthe last bee\nin no hurry` },
      { title: "Snowmelt", daysAgo: 20, body: `snowmelt —\nthe gutter sings\nwhat the roof remembered` },
      { title: "Lantern", daysAgo: 24, body: `paper lantern\nthe small moon\nwe made ourselves` },
      { title: "Inheritance", daysAgo: 27, private: true, body: `grandmother's thimble —\nmy finger too large\nfor her careful life` },
      { title: "Crows", daysAgo: 31, body: `three crows on a wire\ndiscussing\nthe price of bread` },
      { title: "Solstice", daysAgo: 40, body: `shortest day —\nthe cat follows\nthe last square of sun` },
      { title: "Unwritten", draft: true, body: `blank page\nthe pen's\nlong pause` },
    ],
  },
  {
    penName: "Bram Okafor",
    poems: [
      {
        title: "My Father Peels an Orange",
        daysAgo: 5,
        body: `In one long ribbon, always,
the way his own father did,
thumb working the white seam
like a man unbuttoning a coat for a child.
He hands me the first segment.
    He always hands me the first segment.`,
      },
      {
        title: "Sunday Stew",
        daysAgo: 19,
        private: true,
        body: `Onions first, my mother said,
then patience, then everything else.
I am forty and still learning the order.`,
      },
      {
        title: "Recipe Card in My Aunt's Hand",
        daysAgo: 38,
        private: true,
        body: `"A pinch" — whose pinch?
"Until it looks right" — right to whom?
I cook it wrong every year
and every year it tastes like her.`,
      },
      {
        title: "Washing Up",
        daysAgo: 52,
        body: `Two of us at the sink,
one washing, one drying,
saying nothing important
for an hour that turned out
to be the important part.`,
      },
    ],
  },
  {
    penName: "Juniper Vale",
    poems: [
      {
        title: "How to Be a Hedgerow",
        daysAgo: 7,
        body: `Let everything in.
The wren, the bramble, the blown crisp packet.
Be thick with small business.
Be the border that is mostly a home.`,
      },
      {
        title: "Field Notes, April",
        daysAgo: 15,
        body: `Lapwing over the wet field — a tumbling, a cry.
Blackthorn white before its leaves, as if it couldn't wait.
My boots heavier on the way back,
the field coming home with me.`,
      },
      {
        title: "The Oak Is Not in a Hurry",
        daysAgo: 23,
        body: `Three hundred years to say one thing,
and it's still on the first word.`,
      },
      {
        title: "Mushrooms After Rain",
        daysAgo: 33,
        body: `Overnight, a village.
Pale roofs, no doors,
the whole wood whispering
about the new neighbours.`,
      },
      {
        title: "River in Spate",
        daysAgo: 47,
        body: `Brown and loud and certain,
carrying a whole branch like a sentence
it can't wait to finish.`,
      },
      {
        title: "Bees in the Lavender",
        daysAgo: 58,
        body: `The hum is a kind of weather.
I stand in it until I'm warm.`,
      },
      {
        title: "Owl",
        daysAgo: 66,
        private: true,
        body: `You asked what I was listening for.
That, I said. And then it didn't call again,
and we stood in the dark a long time,
    happy to be wrong together.`,
      },
    ],
  },
  {
    penName: "Theo Lindqvist",
    poems: [
      {
        title: "Winter Light, Kitchen Table",
        daysAgo: 10,
        body: `The sun gets as far as the salt cellar
and gives up.
We eat in the bright half,
pushing our plates toward it like offerings.`,
      },
      {
        title: "Sledge",
        daysAgo: 26,
        body: `My brother at the bottom of the hill,
arms up, already a man in the photograph,
still a boy in the snow.`,
      },
      {
        title: "Thaw",
        daysAgo: 49,
        body: `The icicles let go one drop at a time,
like people leaving a party,
saying goodbye to everyone.`,
      },
    ],
  },
  {
    penName: "Amara Nwosu-Bell",
    bio: "Letters, mostly unsent.",
    sharedPassword: true,
    poems: [
      {
        title: "Letter Folded Into Thirds",
        daysAgo: 6,
        private: true,
        body: `Dear you,
the first third is the weather,
the second third is what I meant,
and the last third I folded inward
    so you'd have to open me to find it.`,
      },
      {
        title: "Postscript",
        daysAgo: 13,
        body: `P.S. I lied about the weather.
It was beautiful. I wanted you to come.`,
      },
      {
        title: "Two Cups",
        daysAgo: 29,
        private: true,
        body: `I still make two.
The second goes cold on the windowsill
and I drink it anyway, at noon,
bitter and patient, like an answer.`,
      },
      {
        title: "Voicemail I Didn't Delete",
        daysAgo: 41,
        private: true,
        body: `Eleven seconds.
You say my name, then "never mind,"
then laugh at something I'll never know.
I've played it more than any song.`,
      },
      {
        title: "Return Address",
        daysAgo: 63,
        body: `Wherever you are,
write this on the back:
    a kitchen, a lamp, someone awake.`,
      },
    ],
  },
  {
    penName: "the quiet archivist",
    poems: [
      {
        title: "catalogue entry no. 114",
        daysAgo: 16,
        body: `item: one glove, left hand, child's.
condition: loved.
provenance: a bus seat, march.
notes: someone is still looking.`,
      },
      {
        title: "catalogue entry no. 207",
        daysAgo: 36,
        body: `item: a library card, expired 1998.
borrowed: eleven books about the sea.
returned: all but one.`,
      },
    ],
  },
  {
    penName: "Ren Takahashi-Moreau",
    poems: [
      {
        title: "On Being Asked at a Dinner Party What My Poems Are About and Saying 'Mostly Weather'",
        daysAgo: 18,
        body: `Which was true, and also not.
The weather is how I say
the things a dinner party
has no room for.`,
      },
      {
        title: "A Short Treatise on the Correct Way to Leave a Room You Have Loved",
        daysAgo: 39,
        body: `Turn off the lamp last.
Let your hand stay on the switch
one breath longer than it needs to.
That's the whole treatise.`,
      },
      {
        title: "Instructions for the House-Sitter, Including Several Things About the Cat That Are Not Strictly Instructions",
        daysAgo: 55,
        private: true,
        body: `Food at seven. Water always.
She will sit on the warm side of the bed
and pretend she was there first.
Let her. She was.`,
      },
      {
        title: "Untitled (Airport)",
        daysAgo: 72,
        body: `Everyone here is between two sentences.`,
      },
    ],
  },
  {
    penName: "Wren Abernathy",
    poems: [
      {
        title: "Only Poem",
        daysAgo: 25,
        body: `I wrote one poem
and put it on the board
like a single cup on a long shelf,
to see if anyone would drink from it.`,
      },
    ],
  },
];
