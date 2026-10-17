export function BrandMark({ size = "md" }: { size?: "sm" | "md" }) {
  return (
    <span
      aria-hidden="true"
      className={`grid shrink-0 place-items-center rounded-[9px] bg-brand font-extrabold tracking-tighter text-on-brand ${
        size === "sm" ? "size-7 text-sm" : "size-8 text-base"
      }`}
    >
      S
    </span>
  );
}
