"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase";

const BUCKET = "task-files";

/** Types safe to render inline. Everything else is forced to download. */
const INLINE_SAFE = /\.(jpe?g|png|gif|webp|avif|pdf)$/i;

interface FileAttachmentProps {
  /**
   * Either a storage object path ("<userId>/<entityId>-<ts>.<ext>") for files
   * uploaded since the bucket was made private, or a legacy absolute public
   * URL from before that change.
   */
  fileUrl: string | null;
  fileName: string | null;
  onUploaded: (url: string, name: string) => void;
  onRemoved: () => void;
  userId: string;
  entityId: string;
}

const isLegacyPublicUrl = (v: string) => /^https?:\/\//i.test(v);

/** Recover the storage path from either storage format. */
const toStoragePath = (v: string) =>
  isLegacyPublicUrl(v) ? (v.split(`/${BUCKET}/`)[1] ?? "") : v;

export function FileAttachment({
  fileUrl, fileName, onUploaded, onRemoved, userId, entityId,
}: FileAttachmentProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [opening, setOpening] = useState(false);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { alert("File must be under 10MB"); return; }

    setUploading(true);
    const supabase = createClient();
    const ext = (file.name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
    const path = `${userId}/${entityId}-${Date.now()}.${ext}`;

    const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: true });
    if (error) { alert("Upload failed: " + error.message); setUploading(false); return; }

    // Store the PATH, not a public URL. The bucket is private; access goes
    // through short-lived signed URLs minted at click time.
    onUploaded(path, file.name);
    setUploading(false);
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleOpen = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!fileUrl || opening) return;

    // Legacy rows still hold an absolute public URL.
    if (isLegacyPublicUrl(fileUrl)) {
      window.open(fileUrl, "_blank", "noopener,noreferrer");
      return;
    }

    // The tab must be opened synchronously with the click, or the popup
    // blocker kills it while we wait on the signed-URL round trip.
    const tab = window.open("", "_blank");
    if (tab) tab.opener = null;

    setOpening(true);
    const supabase = createClient();
    // Anything that isn't a known-safe preview type is served as an
    // attachment, so an uploaded .svg or .html can't execute in the browser.
    const forceDownload = !INLINE_SAFE.test(fileName || "");
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(fileUrl, 3600, forceDownload ? { download: fileName || true } : undefined);
    setOpening(false);

    if (error || !data?.signedUrl) {
      tab?.close();
      alert("Couldn't open that file: " + (error?.message ?? "unknown error"));
      return;
    }
    if (tab) tab.location.href = data.signedUrl;
    else window.location.href = data.signedUrl;
  };

  const handleRemove = async () => {
    if (!fileUrl) return;
    const supabase = createClient();
    const path = toStoragePath(fileUrl);
    if (path) {
      const { error } = await supabase.storage.from(BUCKET).remove([path]);
      // Still clear the reference — a stale pointer is worse than a stray blob.
      if (error) console.error("[file:remove]", error.message);
    }
    onRemoved();
  };

  const isImage = fileName?.match(/\.(jpg|jpeg|png|gif|webp|svg)$/i);

  if (fileUrl && fileName) {
    return (
      <div className="flex items-center gap-1.5 bg-surface3 rounded px-2 py-1 text-xs group">
        <span className="text-txt3">{isImage ? "🖼" : "📎"}</span>
        <button onClick={handleOpen} disabled={opening}
          className="text-violet2 hover:text-violet truncate max-w-[120px] disabled:opacity-50"
          title={fileName}>
          {opening ? "Opening…" : fileName}
        </button>
        <button onClick={(e) => { e.stopPropagation(); handleRemove(); }}
          className="text-txt3 hover:text-danger transition-colors opacity-0 group-hover:opacity-100" title="Remove file">✕</button>
      </div>
    );
  }

  return (
    <div className="inline-block">
      <input ref={inputRef} type="file" onChange={handleUpload} className="hidden" accept="*/*" />
      <button onClick={() => inputRef.current?.click()} disabled={uploading}
        className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-surface3 hover:bg-border text-txt3 hover:text-txt transition-colors disabled:opacity-50"
        title="Attach file">
        {uploading ? <span className="animate-pulse">Uploading…</span> : <><span>📎</span><span>File</span></>}
      </button>
    </div>
  );
}
