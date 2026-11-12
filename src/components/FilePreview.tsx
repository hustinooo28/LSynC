import { useEffect, useRef, useState } from "react";
import type { PointerEvent, ReactNode } from "react";
import { AlertCircle, ChevronsDown, ChevronsUp, Download, Maximize2, ZoomIn, ZoomOut } from "lucide-react";
import { readSheet } from "read-excel-file/browser";
import type { StudentRequirementFile } from "@/types";
import Modal from "@/components/ui/Modal";
import Skeleton from "@/components/ui/Skeleton";

/** Human-readable file size, e.g. 1468006 -> "1.4 MB". */
function formatFileSize(bytes?: number): string {
  if (!bytes) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(size >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

type PreviewKind = "image" | "pdf" | "audio" | "video" | "text" | "sheet" | "office" | "unsupported";

// Checked in order: MIME prefix/fragment or file extension.
const KINDS: [PreviewKind, RegExp, RegExp][] = [
  ["image", /^image\//, /^(png|jpe?g|gif|webp|svg|bmp|avif)$/],
  ["pdf", /^application\/pdf$/, /^pdf$/],
  ["audio", /^audio\//, /^(mp3|wav|ogg|oga|aac|m4a|flac)$/],
  ["video", /^video\//, /^(mp4|webm|ogv|mov|m4v|avi)$/],
  ["text", /^text\//, /^(txt|csv|tsv|log|md)$/],
  ["office", /msword|wordprocessingml|ms-excel|spreadsheetml|ms-powerpoint|presentationml/, /^(doc|docx|xls|xlsx|ppt|pptx)$/],
];

function previewKind(file: StudentRequirementFile): PreviewKind {
  const ext = file.fileName.split(".").pop()?.toLowerCase() ?? "";
  const type = file.fileType?.toLowerCase() ?? "";
  const kind = KINDS.find(([, mime, extension]) => mime.test(type) || extension.test(ext))?.[0] ?? "unsupported";
  // .xlsx is parsed and rendered locally; other office files use Microsoft's viewer.
  return kind === "office" && ext === "xlsx" ? "sheet" : kind;
}

function PreviewMessage({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-56 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted">
      <AlertCircle className="h-8 w-8 text-brand-500" />
      <p>{children}</p>
    </div>
  );
}

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.25;

/** Pan (drag) + zoom surface. `mediaControls` keeps audio/video controls clickable. */
function InteractivePreview({ children, mediaControls = false }: { children: ReactNode; mediaControls?: boolean }) {
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [compact, setCompact] = useState(false);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const surface = useRef<HTMLDivElement>(null);

  const changeZoom = (amount: number) =>
    setZoom((current) => {
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current + amount));
      if (next === 1) setOffset({ x: 0, y: 0 });
      return next;
    });

  // React's onWheel is passive, so preventDefault there is ignored and the page
  // scrolls while zooming — attach a non-passive native listener instead.
  useEffect(() => {
    const el = surface.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      changeZoom(e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: e.pointerId, x: e.clientX - offset.x, y: e.clientY - offset.y };
    setDragging(true);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.id === e.pointerId) setOffset({ x: e.clientX - drag.current.x, y: e.clientY - drag.current.y });
  };
  const stopDragging = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.id !== e.pointerId) return;
    drag.current = null;
    setDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  return (
    <div className="w-full">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-line bg-surface-2 p-2">
        <div className="flex items-center gap-1" aria-label="Preview zoom controls">
          <button type="button" onClick={() => changeZoom(-ZOOM_STEP)} disabled={zoom <= MIN_ZOOM} className="btn btn-secondary btn-sm btn-icon" aria-label="Zoom out">
            <ZoomOut className="h-4 w-4" />
          </button>
          <span className="min-w-12 text-center text-xs font-semibold text-ink" aria-live="polite">
            {Math.round(zoom * 100)}%
          </span>
          <button type="button" onClick={() => changeZoom(ZOOM_STEP)} disabled={zoom >= MAX_ZOOM} className="btn btn-secondary btn-sm btn-icon" aria-label="Zoom in">
            <ZoomIn className="h-4 w-4" />
          </button>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => (setZoom(1), setOffset({ x: 0, y: 0 }))} className="btn btn-secondary btn-sm" title="Fit the preview to the screen">
            <Maximize2 className="h-3.5 w-3.5" /> Fit
          </button>
          <button type="button" onClick={() => setCompact((c) => !c)} className="btn btn-secondary btn-sm" aria-pressed={compact}>
            {compact ? <ChevronsDown className="h-3.5 w-3.5" /> : <ChevronsUp className="h-3.5 w-3.5" />}
            {compact ? "Expand" : "Compact"}
          </button>
        </div>
      </div>

      <div
        ref={surface}
        className={`relative w-full touch-none overflow-hidden rounded-2xl border border-line bg-surface-2 ${
          compact ? "h-[28vh] min-h-48 sm:h-[34vh]" : "h-[46vh] min-h-64 sm:h-[52vh]"
        } ${dragging ? "cursor-grabbing" : "cursor-grab"}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={stopDragging}
        onPointerCancel={stopDragging}
        role="application"
        aria-label="Interactive file preview. Drag to pan and use the controls to zoom."
      >
        <div
          className={`absolute inset-0 flex items-center justify-center p-3 sm:p-5 ${mediaControls ? "" : "pointer-events-none"} ${
            dragging ? "" : "transition-transform duration-200 ease-out"
          }`}
          style={{ transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${zoom})` }}
        >
          {children}
        </div>
      </div>
      <p className="mt-1.5 text-center text-[11px] text-muted">Drag to pan · Scroll or use + / − to zoom · Fit resets the view</p>
    </div>
  );
}

/** Inline preview for any requirement file (image, PDF, media, text, spreadsheet, office). */
function FilePreview({ file }: { file: StudentRequirementFile }) {
  const kind = previewKind(file);
  const needsFetch = kind === "text" || kind === "sheet";
  // Tagged with the URL it was loaded from, so a stale result reads as "loading".
  const [loaded, setLoaded] = useState<{ url: string; text?: string; rows?: unknown[][]; error?: string } | null>(null);
  const content = loaded?.url === file.fileUrl ? loaded : null;

  useEffect(() => {
    if (!needsFetch) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(file.fileUrl);
        if (!response.ok) throw new Error(`Request failed with status ${response.status}`);
        const next = kind === "text" ? { text: await response.text() } : { rows: (await readSheet(await response.blob())) as unknown[][] };
        if (!cancelled) setLoaded({ url: file.fileUrl, ...next });
      } catch (error) {
        console.error("Error loading file preview:", error);
        if (!cancelled) setLoaded({ url: file.fileUrl, error: `This ${kind === "text" ? "text file" : "spreadsheet"} could not be loaded for preview.` });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file.fileUrl, kind, needsFetch]);

  if (needsFetch && !content) {
    return (
      <div className="space-y-3 rounded-2xl bg-surface-2 p-5" role="status" aria-label="Loading preview">
        {["w-1/3", "w-5/6", "w-2/3", "w-3/4"].map((w) => (
          <Skeleton key={w} className={`h-4 ${w}`} />
        ))}
      </div>
    );
  }
  if (content?.error) return <PreviewMessage>{content.error}</PreviewMessage>;

  const stop = (e: PointerEvent) => e.stopPropagation();
  switch (kind) {
    case "image":
      return (
        <InteractivePreview>
          <img src={file.fileUrl} alt={file.title} className="max-h-full max-w-full rounded-lg object-contain" />
        </InteractivePreview>
      );
    case "pdf":
    case "office":
      return (
        <InteractivePreview>
          <iframe
            src={kind === "pdf" ? file.fileUrl : `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(file.fileUrl)}`}
            title={file.title}
            className="h-full w-full rounded-lg"
          />
        </InteractivePreview>
      );
    case "audio":
      return (
        <InteractivePreview mediaControls>
          <div className="flex w-full max-w-xl items-center justify-center p-6" onPointerDown={stop}>
            <audio src={file.fileUrl} controls className="w-full" />
          </div>
        </InteractivePreview>
      );
    case "video":
      return (
        <InteractivePreview mediaControls>
          <video src={file.fileUrl} controls className="max-h-full max-w-full rounded-lg bg-black" onPointerDown={stop} />
        </InteractivePreview>
      );
    case "text":
      return (
        <InteractivePreview>
          <pre className="max-h-full max-w-full overflow-auto whitespace-pre-wrap break-words rounded-lg bg-surface p-5 text-left font-mono text-sm text-ink shadow-soft">
            {content?.text}
          </pre>
        </InteractivePreview>
      );
    case "sheet":
      return (
        <InteractivePreview>
          <div className="max-h-full max-w-full overflow-auto rounded-lg bg-surface shadow-soft">
            {content?.rows?.length ? (
              <table className="min-w-full border-collapse text-left text-sm">
                <tbody>
                  {content.rows.map((row, r) => (
                    <tr key={r} className={r === 0 ? "bg-brand-500/10 font-semibold" : ""}>
                      {row.map((cell, c) => (
                        <td key={c} className="border border-line px-3 py-2 align-top text-ink">
                          {cell == null ? "" : String(cell)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <PreviewMessage>This spreadsheet is empty.</PreviewMessage>
            )}
          </div>
        </InteractivePreview>
      );
    default:
      return (
        <InteractivePreview>
          <PreviewMessage>Preview not supported for this file type. Use Download to save the file and open it with a compatible application.</PreviewMessage>
        </InteractivePreview>
      );
  }
}

/** File size label for a byte count. */
export function FileSize({ bytes }: { bytes?: number }) {
  return <>{formatFileSize(bytes)}</>;
}

/** Download link styled as a button. */
export function DownloadLink({ file, className = "btn btn-secondary btn-sm" }: { file: StudentRequirementFile; className?: string }) {
  return (
    <a href={file.fileUrl} download={file.fileName} target="_blank" rel="noopener noreferrer" className={className}>
      <Download className="h-4 w-4" /> Download
    </a>
  );
}

/** Shared preview dialog used by the student record and the admin files page. */
export function FilePreviewModal({ file, onClose }: { file: StudentRequirementFile | null; onClose: () => void }) {
  return (
    <Modal
      open={!!file}
      onClose={onClose}
      size="2xl"
      title={file?.title}
      description={file?.description}
      footer={
        file && (
          <div className="flex w-full flex-wrap items-center justify-between gap-3">
            <span className="min-w-0 truncate text-xs text-muted">
              {file.fileName} · {formatFileSize(file.fileSize)}
            </span>
            <DownloadLink file={file} className="btn btn-primary" />
          </div>
        )
      }
    >
      {file && <FilePreview file={file} />}
    </Modal>
  );
}
