"use client";

import {
  FeatherIcon,
  ListIcon,
  LogInIcon,
  MaximizeIcon,
  MinusIcon,
  PlusIcon,
  SearchIcon,
  UsersIcon,
  XIcon,
} from "lucide-react";
import Link from "next/link";
import { cardTitleClass, PoemCardFace } from "./poem-card-face";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import {
  layoutBoard,
  sectionHue,
  type BoardLayout,
  type Rect,
} from "@/lib/board-layout";
import type { BoardPoem, BoardSection } from "@/lib/board-types";
import type { SearchResults } from "@/lib/search-types";
import { notify } from "@/lib/notify";
import { SubscribeButton } from "@/components/feeds/subscribe-button";
import { BoardSearch } from "./board-search";
import type { BoardFilter } from "./board-view";
import { LanguageFilter, LanguageFilterStatus } from "./language-filter";
import { pluralCount } from "@/lib/plural";
import { InstallSlot, InstallToolbarButton } from "@/components/install/install-nudge";

/*
 * Infinite canvas (R1): a "world" div of absolutely positioned DOM nodes,
 * moved with a single CSS transform. Text stays real text (crisp, selectable
 * by screen readers, every card a real link), see docs/PLAN.md.
 *
 * The camera lives in a ref and is applied straight to the DOM each frame;
 * React state (`view`) is only refreshed once per frame for the zoom label
 * and minimap, so panning never re-renders the cards.
 */

type Camera = { x: number; y: number; k: number }; // screen = world * k + (x, y)

const MIN_K = 0.1;
const MAX_K = 2.5;
const OVERVIEW_K = 0.4; // below this, cards fade and author names take over
const DRAG_THRESHOLD = 4;
const INITIAL_MIN_K = 0.32;
const INITIAL_READING_K = 0.62;

const clampK = (k: number) => Math.min(MAX_K, Math.max(MIN_K, k));
const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

type Gesture =
  | { type: "pan"; id: number; startX: number; startY: number; cam: Camera; moved: boolean }
  | { type: "pinch"; dist: number; midX: number; midY: number };

export function BoardCanvas({
  sections,
  allSections,
  filter,
  feedUrl,
  onListView,
}: {
  /** What's shown: the board narrowed by the language filter. */
  sections: BoardSection[];
  /** The whole board, so search picks hidden by the filter can explain themselves. */
  allSections: BoardSection[];
  filter: BoardFilter;
  /** Absolute URL of the site feed, for the Subscribe popover. */
  feedUrl: string;
  onListView: () => void;
}) {
  const layout = useMemo(() => layoutBoard(sections), [sections]);
  const viewportRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const cam = useRef<Camera>({ x: 0, y: 0, k: 1 });
  const [view, setView] = useState({ x: 0, y: 0, k: 1, w: 0, h: 0 });
  const viewFrame = useRef(0);
  const animFrame = useRef(0);

  // ---- camera ------------------------------------------------------------

  const apply = useCallback(() => {
    const { x, y, k } = cam.current;
    const world = worldRef.current;
    const vp = viewportRef.current;
    if (!world || !vp) return;
    world.style.transform = `translate(${x}px, ${y}px) scale(${k})`;
    world.dataset.lod = k < OVERVIEW_K ? "overview" : "detail";
    // Dot grid moves with the world; double its spacing when it gets dense.
    let grid = 24 * k;
    while (grid < 14) grid *= 2;
    vp.style.backgroundSize = `${grid}px ${grid}px`;
    vp.style.backgroundPosition = `${x}px ${y}px`;
    cancelAnimationFrame(viewFrame.current);
    viewFrame.current = requestAnimationFrame(() =>
      setView({ ...cam.current, w: vp.clientWidth, h: vp.clientHeight }),
    );
  }, []);

  const moveTo = useCallback(
    (target: Camera, animate = true) => {
      cancelAnimationFrame(animFrame.current);
      if (!animate || prefersReducedMotion()) {
        cam.current = target;
        apply();
        return;
      }
      const from = { ...cam.current };
      const start = performance.now();
      const duration = 360;
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / duration);
        const e = 1 - Math.pow(1 - t, 3);
        cam.current = {
          x: from.x + (target.x - from.x) * e,
          y: from.y + (target.y - from.y) * e,
          k: from.k + (target.k - from.k) * e,
        };
        apply();
        if (t < 1) animFrame.current = requestAnimationFrame(step);
      };
      animFrame.current = requestAnimationFrame(step);
    },
    [apply],
  );

  /** Camera that fits `rect` in the viewport (leaving room for the header). */
  const fitCamera = useCallback((rect: Rect, maxK = 1): Camera => {
    const vp = viewportRef.current;
    if (!vp || rect.w === 0) return cam.current;
    const w = vp.clientWidth;
    const h = vp.clientHeight;
    const pad = Math.min(72, w * 0.06);
    const top = 72; // header overlay
    const k = clampK(
      Math.min((w - pad * 2) / rect.w, (h - top - pad * 2) / rect.h, maxK),
    );
    return {
      k,
      x: w / 2 - (rect.x + rect.w / 2) * k,
      y: top + (h - top) / 2 - (rect.y + rect.h / 2) * k,
    };
  }, []);

  const zoomAt = useCallback(
    (factor: number, sx: number, sy: number, animate = false) => {
      const c = cam.current;
      const k = clampK(c.k * factor);
      const f = k / c.k;
      moveTo({ k, x: sx - (sx - c.x) * f, y: sy - (sy - c.y) * f }, animate);
    },
    [moveTo],
  );

  const zoomCenter = useCallback(
    (factor: number) => {
      const vp = viewportRef.current;
      if (vp) zoomAt(factor, vp.clientWidth / 2, vp.clientHeight / 2, true);
    },
    [zoomAt],
  );

  const fitAll = useCallback(
    (animate = true) => moveTo(fitCamera(layout.bounds), animate),
    [fitCamera, layout.bounds, moveTo],
  );

  const zoomToSection = useCallback(
    (rect: Rect) => moveTo(fitCamera(rect, 1.15)),
    [fitCamera, moveTo],
  );

  // Position before first paint so there's no flash of an unpositioned board.
  // Fit everything if that's still readable; otherwise (big boards, phones)
  // start at a reading zoom on the first shelf, A–Z order.
  // Only when the board's extent actually changes (first render, a language
  // filter): a server refresh (e.g. unlocking a poem in the overlay) brings a
  // new but identical layout object, and must not reset the reader's pan/zoom.
  const fittedBounds = useRef<string | null>(null);
  useLayoutEffect(() => {
    const b = layout.bounds;
    const key = `${b.x},${b.y},${b.w},${b.h}`;
    if (fittedBounds.current === key) return;
    fittedBounds.current = key;
    const fit = fitCamera(layout.bounds);
    cam.current =
      fit.k >= INITIAL_MIN_K
        ? fit
        : { k: INITIAL_READING_K, x: 24 - layout.bounds.x * INITIAL_READING_K, y: 136 - layout.bounds.y * INITIAL_READING_K };
    apply();
    if (viewportRef.current) viewportRef.current.dataset.ready = "true";
  }, [apply, fitCamera, layout.bounds]);

  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const ro = new ResizeObserver(() => apply());
    ro.observe(vp);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(viewFrame.current);
      cancelAnimationFrame(animFrame.current);
    };
  }, [apply]);

  // ---- wheel / trackpad ----------------------------------------------------

  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault(); // React's onWheel is passive and can't do this
      cancelAnimationFrame(animFrame.current);
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? vp.clientHeight : 1;
      const dx = e.deltaX * unit;
      const dy = e.deltaY * unit;
      if (e.ctrlKey || e.metaKey) {
        // Trackpad pinch arrives as ctrl+wheel.
        const r = vp.getBoundingClientRect();
        zoomAt(Math.exp(-dy * 0.01), e.clientX - r.left, e.clientY - r.top);
      } else {
        const c = cam.current;
        cam.current = { ...c, x: c.x - dx, y: c.y - dy };
        apply();
      }
    };
    vp.addEventListener("wheel", onWheel, { passive: false });
    return () => vp.removeEventListener("wheel", onWheel);
  }, [apply, zoomAt]);

  // ---- pointer: drag to pan, two fingers to pinch ---------------------------

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<Gesture | null>(null);
  const suppressClick = useRef(false);

  const startPan = (id: number, x: number, y: number) => {
    gesture.current = { type: "pan", id, startX: x, startY: y, cam: { ...cam.current }, moved: false };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    cancelAnimationFrame(animFrame.current);
    suppressClick.current = false;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) {
      startPan(e.pointerId, e.clientX, e.clientY);
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const vp = e.currentTarget;
      for (const id of pointers.current.keys()) vp.setPointerCapture(id);
      gesture.current = {
        type: "pinch",
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        midX: (a.x + b.x) / 2,
        midY: (a.y + b.y) / 2,
      };
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    const vp = e.currentTarget;

    if (g?.type === "pan" && g.id === e.pointerId) {
      const dx = e.clientX - g.startX;
      const dy = e.clientY - g.startY;
      if (!g.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
        g.moved = true;
        // Capture only once it's a drag, so a plain click still reaches the card.
        vp.setPointerCapture(e.pointerId);
        vp.dataset.panning = "true";
      }
      if (g.moved) {
        cam.current = { ...cam.current, x: g.cam.x + dx, y: g.cam.y + dy };
        apply();
      }
    } else if (g?.type === "pinch" && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      const r = vp.getBoundingClientRect();
      const c = cam.current;
      const k = clampK(c.k * (dist / (g.dist || dist)));
      const f = k / c.k;
      const sx = midX - r.left;
      const sy = midY - r.top;
      cam.current = {
        k,
        x: sx - (sx - c.x) * f + (midX - g.midX),
        y: sy - (sy - c.y) * f + (midY - g.midY),
      };
      apply();
      gesture.current = { type: "pinch", dist, midX, midY };
    }
  };

  const onPointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.delete(e.pointerId)) return;
    const g = gesture.current;
    if (g?.type === "pan" && g.moved) suppressClick.current = true;
    if (g?.type === "pinch") suppressClick.current = true;
    if (pointers.current.size === 1) {
      // Lifting one finger of a pinch continues as a pan with the other.
      const [[id, p]] = [...pointers.current.entries()];
      startPan(id, p.x, p.y);
      (gesture.current as Extract<Gesture, { type: "pan" }>).moved = true;
    } else if (pointers.current.size === 0) {
      gesture.current = null;
      delete e.currentTarget.dataset.panning;
    }
  };

  const onClickCapture = (e: React.MouseEvent) => {
    if (suppressClick.current) {
      e.preventDefault();
      e.stopPropagation();
      suppressClick.current = false;
    }
  };

  // ---- keyboard --------------------------------------------------------------

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return; // leave browser zoom alone
    const step = e.shiftKey ? 320 : 96;
    const c = cam.current;
    const pan = (dx: number, dy: number) => moveTo({ ...c, x: c.x + dx, y: c.y + dy }, false);
    switch (e.key) {
      case "ArrowLeft": pan(step, 0); break;
      case "ArrowRight": pan(-step, 0); break;
      case "ArrowUp": pan(0, step); break;
      case "ArrowDown": pan(0, -step); break;
      case "+":
      case "=": zoomCenter(1.25); break;
      case "-":
      case "_": zoomCenter(0.8); break;
      case "0": fitAll(); break;
      case "1": zoomCenter(1 / c.k); break;
      default: return;
    }
    e.preventDefault();
  };

  /** Keep keyboard-focused cards and section labels on screen and readable. */
  const onFocus = (e: React.FocusEvent<HTMLDivElement>) => {
    const el = e.target as HTMLElement;
    if (!el.matches(":focus-visible") || !el.dataset.rect) return;
    const [x, y, w, h] = el.dataset.rect.split(",").map(Number);
    const vp = viewportRef.current;
    if (!vp) return;
    const c = cam.current;
    const m = 32;
    const sx = x * c.k + c.x;
    const sy = y * c.k + c.y;
    const visible =
      c.k >= 0.6 &&
      sx >= m && sy >= 72 &&
      sx + w * c.k <= vp.clientWidth - m &&
      sy + h * c.k <= vp.clientHeight - m;
    if (visible) return;
    const k = Math.max(c.k, 0.9);
    moveTo({
      k,
      x: vp.clientWidth / 2 - (x + w / 2) * k,
      y: vp.clientHeight / 2 - (y + h / 2) * k,
    });
  };

  // ---- render ----------------------------------------------------------------

  const [authorsOpen, setAuthorsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const total = sections.reduce((n, s) => n + s.poems.length, 0);
  /** "Ewe" while the board is filtered to a language, for the help text. */
  const activeLanguage = filter.options.find((o) => o.code === filter.active)?.name;
  const router = useRouter();

  // ⌘K / Ctrl+K anywhere, or "/" when not typing, opens search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement | null)?.closest("input, textarea, [contenteditable]");
      if (((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") || (e.key === "/" && !typing)) {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /** Briefly ring an element so the eye finds it after the camera moves. */
  const highlight = (el: Element | null) => {
    if (!(el instanceof HTMLElement)) return;
    delete el.dataset.highlight;
    void el.offsetWidth; // restart the animation if it's already running
    el.dataset.highlight = "true";
    setTimeout(() => delete el.dataset.highlight, 2400);
  };

  const pickAuthor = (author: SearchResults["authors"][number]) => {
    const i = sections.findIndex((s) => s.editorId === author.editorId);
    const hidden = filter.options.find((o) => o.code === filter.active);
    if (i < 0 && hidden && allSections.some((s) => s.editorId === author.editorId)) {
      // Search covers the whole board; this author has no poems in the filter.
      notify.info(`${author.penName} has no ${hidden.name} poems`, "Choose All languages to see their shelf.");
      return;
    }
    if (i < 0) {
      // Just published; this (cached) board doesn't have the section yet.
      notify.info(`${author.penName} will appear on the board shortly`, "Please refresh in a minute.");
      return;
    }
    zoomToSection(layout.sections[i]);
    highlight(worldRef.current?.querySelector(`[data-section-id="${author.editorId}"]`) ?? null);
    // Keyboard users land on the section label, ready to Tab into its poems.
    setTimeout(() => {
      worldRef.current
        ?.querySelector<HTMLElement>(`[data-section-label="${author.editorId}"]`)
        ?.focus({ preventScroll: true });
    }, 380);
  };

  const pickPoem = (poem: SearchResults["poems"][number]) => {
    const i = sections.findIndex((s) => s.editorId === poem.editorId);
    const j = i < 0 ? -1 : sections[i].poems.findIndex((p) => p.id === poem.id);
    if (j < 0) {
      // Hidden by the language filter, or published after this board was
      // cached: open it directly.
      router.push(`/p/${poem.authorSlug}/${poem.slug}`);
      return;
    }
    const card = layout.sections[i].cards[j];
    const vp = viewportRef.current;
    if (vp) {
      const k = Math.max(cam.current.k, 1);
      moveTo({ k, x: vp.clientWidth / 2 - (card.x + card.w / 2) * k, y: vp.clientHeight / 2 - (card.y + card.h / 2) * k });
    }
    const el = worldRef.current?.querySelector<HTMLElement>(`[data-poem-id="${poem.id}"]`) ?? null;
    highlight(el?.closest("[data-card]") ?? null);
    // Focus the card (Enter then opens it) once the camera has arrived.
    setTimeout(() => el?.focus({ preventScroll: true }), 380);
  };

  return (
    <div className="relative h-full w-full overflow-hidden bg-canvas">
      <div
        ref={viewportRef}
        tabIndex={0}
        role="region"
        aria-label="Poem board"
        aria-describedby="board-help"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onClickCapture={onClickCapture}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        className="absolute inset-0 cursor-grab touch-none overflow-clip opacity-0 outline-none select-none [background-image:radial-gradient(var(--canvas-dot)_1px,transparent_1px)] data-[panning=true]:cursor-grabbing data-[ready=true]:opacity-100 data-[ready=true]:transition-opacity focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <p id="board-help" className="sr-only">
          {pluralCount(total, activeLanguage ? `${activeLanguage} poem` : "poem")} by{" "}
          {pluralCount(sections.length, "author")}. Drag or use the arrow keys
          to move around, plus and minus to zoom, zero to see everything. Tab
          moves between authors and poems. A list view is also available.
        </p>
        <div
          ref={worldRef}
          data-lod="detail"
          className="group/world absolute top-0 left-0 origin-top-left"
        >
          <World sections={sections} layout={layout} onZoomToSection={zoomToSection} />
        </div>
      </div>

      {/* Overlays: siblings of the viewport so they don't pan or eat wheel events.
          The top ones share one flow column (toolbar → filter status → Authors),
          so each sits below the previous one however the toolbar wraps. Don't
          position them on their own with guessed offsets, and don't centre them
          with left-1/2 + translate: an absolute box sized to fit its content
          only gets the space right of its left edge (half the screen), so
          its text wraps word by word on phones. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-col gap-2 p-4">
      <header className="flex items-start justify-between gap-2">
        <Link
          href="/"
          className="pointer-events-auto flex shrink-0 items-center gap-2 rounded-xl border bg-background/85 px-3 py-2 shadow-sm backdrop-blur"
        >
          <FeatherIcon className="size-4 text-primary" aria-hidden />
          <span className="font-serif text-lg leading-none">InkBoard</span>
          <span className="hidden text-xs text-muted-foreground sm:inline">
            {pluralCount(sections.length, "author")} · {pluralCount(total, "poem")}
          </span>
        </Link>
        <div data-board-toolbar className="pointer-events-auto flex flex-wrap justify-end gap-2">
          <LanguageFilter id="board-language" filter={filter} />
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSearchOpen(true)}
            aria-keyshortcuts="Meta+K Control+K /"
            className="bg-background/85 backdrop-blur max-sm:w-7 max-sm:px-0 sm:min-w-52 sm:justify-start"
          >
            <SearchIcon />
            <span className="hidden text-muted-foreground sm:inline">Search authors & poems</span>
            <span className="sr-only sm:hidden">Search</span>
            <kbd className="ml-auto hidden rounded border bg-muted px-1.5 font-sans text-[10px] text-muted-foreground sm:inline">
              ⌘K
            </kbd>
          </Button>
          {/* Icon-only buttons are square on phones (28px), so the toolbar fits in two rows at 320px. */}
          <Button variant="outline" size="sm" onClick={onListView} className="bg-background/85 backdrop-blur max-sm:w-7 max-sm:px-0">
            <ListIcon />
            {/* Icon-only on phones, but still named. */}
            <span className="max-sm:sr-only">List view</span>
          </Button>
          <SubscribeButton feedUrl={feedUrl} />
          <Button asChild variant="outline" size="sm" className="bg-background/85 backdrop-blur max-[359px]:w-7 max-[359px]:px-0">
            <Link href="/sign-in">
              {/* Phones show "Sign in", and just an icon below 360px, so the toolbar
                  stays two rows with Subscribe in it; the name stays "Editor sign in". */}
              <LogInIcon aria-hidden className="hidden max-[359px]:block" />
              <span aria-hidden className="sm:hidden max-[359px]:hidden">Sign in</span>
              <span className="max-sm:sr-only">Editor sign in</span>
            </Link>
          </Button>
          {/* Last, so the install card below can point its tail at it (docs/PLAN.md, Phase 15). */}
          <InstallToolbarButton />
        </div>
      </header>

      {/* Below the toolbar: the filter status and Authors on the left, and (wide
          screens) the install card on the right, as a column of this flow, so it
          can never cover them. Nothing moves vertically when it opens; the status
          pill centres in the space left of it. The card's right edge is the
          toolbar's, so its tail points at the install button (the last item). */}
      <div className="pointer-events-none flex items-start gap-3">
      <div className="pointer-events-none flex min-w-0 flex-1 flex-col gap-2">
      <LanguageFilterStatus filter={filter} total={total} selectId="board-language" className="self-center" />

      <AuthorsPanel
        open={authorsOpen}
        onOpenChange={setAuthorsOpen}
        sections={sections}
        layout={layout}
        onPick={(rect) => {
          zoomToSection(rect);
          if (window.innerWidth < 640) setAuthorsOpen(false);
        }}
      />
      </div>
      <InstallSlot
        kind="board-top"
        className="pointer-events-none mt-0.5 w-[23.25rem] max-w-[60%] shrink-0 empty:hidden"
      />
      </div>
      </div>

      <BoardSearch
        open={searchOpen}
        onOpenChange={setSearchOpen}
        onPickAuthor={pickAuthor}
        onPickPoem={pickPoem}
      />

      {/* Centred by a full-width column, not left-1/2 (see the top overlays).
          Phones: the install card shares this column with the zoom bar, so the
          two can't overlap; on iPhone Safari it goes below, its arrow pointing
          at Safari's Share button. */}
      <div className="pointer-events-none absolute inset-x-4 bottom-4 flex flex-col items-center gap-3">
      <InstallSlot
        kind="board-bottom"
        className="flex w-full justify-center empty:hidden has-[[data-install-pointer]]:order-last has-[[data-install-pointer]]:mb-1"
      />
      <div data-zoom-bar className="pointer-events-auto flex items-center gap-1 rounded-xl border bg-background/90 p-1 shadow-sm backdrop-blur">
        <Button variant="ghost" size="icon-sm" onClick={() => zoomCenter(0.8)} aria-label="Zoom out">
          <MinusIcon />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => zoomCenter(1 / cam.current.k)}
          aria-label={`Zoom ${Math.round(view.k * 100)}%, reset to 100%`}
          className="w-14 tabular-nums"
        >
          {Math.round(view.k * 100)}%
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={() => zoomCenter(1.25)} aria-label="Zoom in">
          <PlusIcon />
        </Button>
        <span className="mx-1 h-5 w-px bg-border" aria-hidden />
        <Button variant="ghost" size="sm" onClick={() => fitAll()}>
          <MaximizeIcon />
          <span className="max-sm:sr-only">Fit</span>
        </Button>
      </div>
      </div>

      <p className="pointer-events-none absolute bottom-5 left-4 hidden text-xs text-muted-foreground lg:block">
        Drag to move · ⌘/Ctrl + scroll or pinch to zoom
      </p>

      <Minimap
        layout={layout}
        view={view}
        onJump={(wx, wy) => {
          const vp = viewportRef.current;
          if (!vp) return;
          const k = cam.current.k;
          moveTo({ k, x: vp.clientWidth / 2 - wx * k, y: vp.clientHeight / 2 - wy * k }, false);
        }}
      />
    </div>
  );
}

// ---- world contents (memoised: never re-rendered while panning) -------------

function World({
  sections,
  layout,
  onZoomToSection,
}: {
  sections: BoardSection[];
  layout: BoardLayout;
  onZoomToSection: (rect: Rect) => void;
}) {
  // Render once per data change; camera updates bypass React entirely.
  return useMemo(
    () =>
      sections.map((section, i) => {
        const box = layout.sections[i];
        const hue = sectionHue(section.editorId);
        return (
          <section
            key={section.editorId}
            aria-label={`${section.penName}, ${pluralCount(section.poems.length, "poem")}`}
            style={{ ["--hue" as string]: hue }}
          >
            <div
              data-section-id={section.editorId}
              className="section-shelf absolute rounded-3xl border"
              style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
            />
            <button
              type="button"
              data-section-label={section.editorId}
              data-rect={`${box.x},${box.y},${box.w},${box.h}`}
              onClick={() => onZoomToSection(box)}
              title="Zoom to this author"
              className="absolute flex items-baseline gap-3 rounded-lg px-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
              // Explicit width: the world is 0×0, so shrink-to-fit would truncate.
              style={{ left: box.x + 28, top: box.y + 18, width: box.w - 56 }}
            >
              <span className="size-2.5 shrink-0 self-center rounded-full section-dot" aria-hidden />
              <h2 className="min-w-0 truncate font-serif text-[28px] leading-tight">{section.penName}</h2>
              <span className="shrink-0 text-sm text-muted-foreground">
                {pluralCount(section.poems.length, "poem")}
              </span>
            </button>
            {/* Overview label: legible when zoomed far out. */}
            <div
              aria-hidden
              className="pointer-events-none absolute flex items-center justify-center p-8 text-center opacity-0 transition-opacity duration-200 group-data-[lod=overview]/world:opacity-100"
              style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
            >
              <span
                className="section-ink font-serif leading-tight"
                style={{ fontSize: Math.min(120, Math.max(56, box.w / 7)) }}
              >
                {section.penName}
              </span>
            </div>
            {section.poems.map((poem, j) => (
              <PoemCard key={poem.id} poem={poem} authorSlug={section.slug} rect={box.cards[j]} />
            ))}
          </section>
        );
      }),
    [sections, layout, onZoomToSection],
  );
}

function PoemCard({ poem, authorSlug, rect }: { poem: BoardPoem; authorSlug: string; rect: Rect }) {
  const isPrivate = poem.visibility === "private";
  return (
    <PoemCardFace
      className="absolute group-data-[lod=overview]/world:opacity-25"
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
      isPrivate={isPrivate}
      excerpt={poem.excerpt}
      lang={poem.language}
      collection={poem.collection}
      hasMore={poem.hasMore}
      title={
        <Link
          href={`/p/${authorSlug}/${poem.slug}`}
          draggable={false}
          data-poem-id={poem.id}
          data-rect={`${rect.x},${rect.y},${rect.w},${rect.h}`}
          className={cardTitleClass}
        >
          {poem.title}
          {isPrivate && <span className="sr-only"> (password protected)</span>}
        </Link>
      }
    />
  );
}

// ---- authors index ----------------------------------------------------------

function AuthorsPanel({
  open,
  onOpenChange,
  sections,
  layout,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sections: BoardSection[];
  layout: BoardLayout;
  onPick: (rect: Rect) => void;
}) {
  return (
    // In the top overlay column; only the button and the list take pointer events.
    <div className="pointer-events-none w-64 max-w-full self-start">
      <Button
        variant="outline"
        size="sm"
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
        aria-controls="authors-list"
        className="pointer-events-auto bg-background/85 backdrop-blur"
      >
        {open ? <XIcon /> : <UsersIcon />}
        Authors
        <span className="text-muted-foreground">{sections.length}</span>
      </Button>
      {open && (
        <nav
          id="authors-list"
          aria-label="Authors"
          className="pointer-events-auto mt-2 max-h-[min(60vh,28rem)] overflow-y-auto rounded-xl border bg-background/95 p-1 shadow-md backdrop-blur"
        >
          <ul>
            {sections.map((s, i) => (
              <li key={s.editorId}>
                <button
                  type="button"
                  onClick={() => onPick(layout.sections[i])}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                  style={{ ["--hue" as string]: sectionHue(s.editorId) }}
                >
                  <span className="size-2 shrink-0 rounded-full section-dot" aria-hidden />
                  <span className="truncate font-serif text-[15px]">{s.penName}</span>
                  <span className="ml-auto text-xs text-muted-foreground tabular-nums">{s.poems.length}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  );
}

// ---- minimap ------------------------------------------------------------------

const MINI_W = 180;
const MINI_H = 120;

function Minimap({
  layout,
  view,
  onJump,
}: {
  layout: BoardLayout;
  view: { x: number; y: number; k: number; w: number; h: number };
  onJump: (wx: number, wy: number) => void;
}) {
  const b = layout.bounds;
  if (b.w === 0 || view.w === 0) return null;
  const s = Math.min(MINI_W / b.w, MINI_H / b.h);
  const w = b.w * s;
  const h = b.h * s;
  // Visible world rect
  const vx = -view.x / view.k;
  const vy = -view.y / view.k;
  const vw = view.w / view.k;
  const vh = view.h / view.k;

  const jump = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    onJump((e.clientX - r.left) / s, (e.clientY - r.top) / s);
  };

  return (
    <div
      aria-hidden
      data-minimap
      className="absolute right-4 bottom-4 hidden overflow-hidden rounded-xl border bg-background/90 p-2 shadow-sm backdrop-blur md:block"
    >
      <svg
        width={w}
        height={h}
        className="block cursor-pointer touch-none"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          jump(e);
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) jump(e);
        }}
      >
        {layout.sections.map((sec) => (
          <rect
            key={sec.editorId}
            x={sec.x * s}
            y={sec.y * s}
            width={sec.w * s}
            height={sec.h * s}
            rx={3}
            fill={`oklch(0.75 0.08 ${sectionHue(sec.editorId)} / 0.55)`}
          />
        ))}
        <rect
          x={vx * s}
          y={vy * s}
          width={vw * s}
          height={vh * s}
          rx={2}
          fill="var(--primary)"
          fillOpacity={0.08}
          stroke="var(--primary)"
          strokeWidth={1.5}
        />
      </svg>
    </div>
  );
}
