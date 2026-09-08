/**
 * A band of repeating text that slides sideways. The list is duplicated
 * once and the track travels exactly half its width, so the loop is seamless.
 */
export function Marquee({ items }: { items: string[] }) {
  const run = [...items, ...items];
  return (
    <div className="overflow-hidden border-b-4 border-ink bg-sun py-2">
      <div className="marquee-track">
        {run.map((text, i) => (
          <span key={i} className="flex shrink-0 items-center gap-6 px-6 text-xl uppercase tracking-[0.18em] text-ink">
            {text}
            <i className="inline-block h-2 w-2 bg-ink" aria-hidden />
          </span>
        ))}
      </div>
    </div>
  );
}
