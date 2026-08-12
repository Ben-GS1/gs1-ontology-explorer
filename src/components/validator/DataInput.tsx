import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import clsx from "clsx";
import { fetchRdfWithContentNegotiation } from "@/lib/shaclAdapter";

export interface LoadedInput {
  text: string;
  label: string;
  contentType?: string;
}

export function DataInput({
  onLoaded,
  busy,
}: {
  onLoaded: (input: LoadedInput) => void;
  busy: boolean;
}) {
  const { t } = useTranslation("common");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [url, setUrl] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);

  const readFile = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = () => onLoaded({ text: String(reader.result ?? ""), label: file.name });
      reader.readAsText(file);
    },
    [onLoaded]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files?.[0];
      if (file) readFile(file);
    },
    [readFile]
  );

  const handleUrlSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    setUrlError(null);
    try {
      const { text, contentType } = await fetchRdfWithContentNegotiation(url.trim());
      onLoaded({ text, label: url.trim(), contentType: contentType ?? undefined });
    } catch (err) {
      setUrlError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={clsx(
          "rounded border-2 border-dashed px-6 py-10 text-center transition",
          dragOver ? "border-signal bg-signal/5" : "border-ink-200 bg-white"
        )}
      >
        <p className="text-sm text-ink-600">{t("validator.dropHint")}</p>
        <p className="mt-1 text-xs text-ink-400">{t("validator.acceptedFormats")}</p>
        <button
          type="button"
          disabled={busy}
          onClick={() => fileInputRef.current?.click()}
          className="mt-3 rounded border border-ink-200 bg-white px-3 py-1.5 text-xs font-medium text-ink-700 hover:bg-ink-50 disabled:opacity-50"
        >
          {t("validator.chooseFile")}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".jsonld,.json,.ttl,.turtle,.nt,.n3,.rdf"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) readFile(file);
            e.target.value = "";
          }}
        />
      </div>

      <form onSubmit={handleUrlSubmit} className="flex flex-wrap gap-2">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={t("validator.urlPlaceholder") ?? ""}
          className="min-w-0 flex-1 rounded border border-ink-200 bg-white px-3 py-2 text-sm outline-none focus:border-signal"
        />
        <button
          type="submit"
          disabled={busy || !url.trim()}
          className="rounded bg-ink-900 px-4 py-2 text-sm font-medium text-ink-50 hover:bg-ink-800 disabled:opacity-50"
        >
          {t("validator.loadFromUrl")}
        </button>
      </form>
      {urlError && <p className="text-xs text-ledger-rust">{urlError}</p>}
      <p className="text-xs text-ink-400">{t("validator.urlNegotiationHint")}</p>
    </div>
  );
}
