interface SessionTagsProps {
  tags: string[];
  /** Show at most this many, then "+N". */
  limit?: number;
}

/** A session's tags as small labels (set in the extension). */
export function SessionTags({ tags, limit = tags.length }: SessionTagsProps) {
  return (
    <span className="flex flex-wrap gap-1 pt-0.5">
      <span className="sr-only">Tags: </span>
      {tags.slice(0, limit).map((tag) => (
        <span key={tag} className="max-w-40 truncate rounded bg-surface-muted px-1.5 text-[11px] font-semibold text-fg-muted">
          {tag}
        </span>
      ))}
      {tags.length > limit && <span className="text-[11px] text-fg-muted">+{tags.length - limit}</span>}
    </span>
  );
}
