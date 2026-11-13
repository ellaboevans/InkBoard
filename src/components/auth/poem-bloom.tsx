/**
 * A small stack of poem cards that blooms open, like petals, when the panel
 * is hovered (pure CSS, see `.poem-bloom` in globals.css). Decorative: the
 * parent panel is aria-hidden. All poems are original to InkBoard.
 */

type Petal = {
  title: string;
  lines: string;
  /** Resting tilt and the angle it opens to, in degrees. */
  rest: number;
  open: number;
  /** Board-style accent hue for the little dot. */
  hue: number;
};

// Listed outside-in; the last one is the front card in the middle.
const PETALS: Petal[] = [
  { title: "Window Seat", lines: "rain on the glass\nwrites in a language\nI almost remember", rest: -7, open: -26, hue: 210 },
  { title: "First Draft", lines: "crossed out,\ncrossed out,\nand there —\nthe word I meant", rest: 6, open: 26, hue: 145 },
  { title: "Margins", lines: "I keep the best lines\nin the margins,\nsmall enough\nto carry home", rest: -3.5, open: -13, hue: 40 },
  { title: "Lamp", lines: "one lamp, one chair,\nthe night leaning in\nto hear what the page\nwill finally say", rest: 3, open: 13, hue: 290 },
  {
    title: "Ink Hour",
    lines: "the kettle hums its one low note,\nthe lamp leans in to read,\nand every word I haven't said\n    is waiting, like a seed.",
    rest: -1.5,
    open: 0,
    hue: 25,
  },
];

export function PoemBloom() {
  return (
    <div className="poem-bloom relative h-[22rem] w-[19rem] scale-[0.82] xl:scale-100 2xl:scale-110">
      {PETALS.map((p, i) => {
        const front = i === PETALS.length - 1;
        // Inner petals open first, outer ones follow: it unfolds from the middle.
        const delay = (Math.abs(p.open) / 13) * 45;
        return (
          <figure
            key={p.title}
            className="poem-bloom-card absolute inset-0 flex flex-col rounded-2xl border bg-card p-7"
            style={
              {
                "--rest": `${p.rest}deg`,
                "--open": `${p.open}deg`,
                "--lift": front ? "-1.25rem" : "0rem",
                "--delay": `${delay}ms`,
                "--hue": p.hue,
                zIndex: i + 1,
              } as React.CSSProperties
            }
          >
            <div className="flex items-center gap-2">
              <span className="section-dot size-2 rounded-full" />
              <p className="font-serif text-xl leading-snug">{p.title}</p>
            </div>
            <blockquote className="mt-4 font-serif text-[1.05rem] leading-relaxed whitespace-pre-line text-muted-foreground">
              {p.lines}
            </blockquote>
            {front && (
              <figcaption className="mt-auto text-sm text-muted-foreground">Write it down. Pin it to the board.</figcaption>
            )}
          </figure>
        );
      })}
    </div>
  );
}
