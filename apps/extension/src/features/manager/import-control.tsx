import { Upload } from "lucide-react";
import { useRef, useState, type ChangeEvent } from "react";
import { IMPORT_MAX_BYTES, parseSessionExport, prepareImportedSession, SessionImportError } from "@sessionhub/core/session-import";
import { buttonClass } from "../../components/modal";
import { ImportDialog, type ImportPreview } from "./import-dialog";

type Phase = { name: "idle" } | { name: "error"; fileName: string; message: string } | { name: "preview"; preview: ImportPreview };

/**
 * Builds the preview locally with the same core functions the worker uses. The worker
 * re-validates the raw file on confirm, so this preview is never trusted for storage.
 */
const buildPreview = async (file: File): Promise<ImportPreview> => {
  if (file.size > IMPORT_MAX_BYTES) {
    throw new SessionImportError("too-large", "This file is larger than 10 MB, so it can't be imported.");
  }
  const content = await file.text();
  const { session, report } = prepareImportedSession(parseSessionExport(content), {
    now: new Date(),
    createId: () => crypto.randomUUID(),
  });
  return { fileName: file.name, content, session, report };
};

/** Manager "Import" button: pick a JSON export, preview it, then import as a new session. */
export function ImportControl({ onImported }: { onImported: (sessionId: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>({ name: "idle" });

  const onFileChosen = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = ""; // allow choosing the same file again
    if (!file) return;
    try {
      setPhase({ name: "preview", preview: await buildPreview(file) });
    } catch (error) {
      const message = error instanceof SessionImportError ? error.message : "Couldn't read this file.";
      setPhase({ name: "error", fileName: file.name, message });
    }
  };

  return (
    <>
      <button type="button" className={buttonClass.secondary} onClick={() => inputRef.current?.click()}>
        <Upload aria-hidden="true" className="size-4" />
        Import
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="application/json,.json"
        className="sr-only"
        tabIndex={-1}
        aria-label="Import a SessionHub export file"
        onChange={(event) => void onFileChosen(event)}
      />
      {phase.name !== "idle" && (
        <ImportDialog
          preview={phase.name === "preview" ? phase.preview : null}
          error={phase.name === "error" ? phase : null}
          onClose={() => setPhase({ name: "idle" })}
          onImported={(sessionId) => {
            setPhase({ name: "idle" });
            onImported(sessionId);
          }}
        />
      )}
    </>
  );
}
