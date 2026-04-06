"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase";

declare global {
  interface Window {
    Dropbox?: {
      choose: (options: {
        success: (files: Array<{ link: string; name: string; icon: string }>) => void;
        cancel?: () => void;
        linkType: "preview" | "direct";
        multiselect: boolean;
        extensions?: string[];
        folderselect?: boolean;
      }) => void;
    };
  }
}

interface FileAttachmentProps {
  fileUrl: string | null;
  fileName: string | null;
  onUploaded: (url: string, name: string) => void;
  onRemoved: () => void;
  userId: string;
  entityId: string;
}

export function FileAttachment({
  fileUrl,
  fileName,
  onUploaded,
  onRemoved,
  userId,
  entityId,
}: FileAttachmentProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      alert("File must be under 10MB");
      return;
    }

    setUploading(true);
    setMenuOpen(false);
    const supabase = createClient();
    const ext = file.name.split(".").pop() || "bin";
    const path = `${userId}/${entityId}-${Date.now()}.${ext}`;

    const { error } = await supabase.storage
      .from("task-files")
      .upload(path, file, { upsert: true });

    if (error) {
      alert("Upload failed: " + error.message);
      setUploading(false);
      return;
    }

    const { data: urlData } = supabase.storage
      .from("task-files")
      .getPublicUrl(path);

    onUploaded(urlData.publicUrl, file.name);
    setUploading(false);

    if (inputRef.current) inputRef.current.value = "";
  };

  const handleDropbox = () => {
    setMenuOpen(false);
    if (!window.Dropbox) {
      alert("Dropbox not loaded. Add your Dropbox app key to NEXT_PUBLIC_DROPBOX_APP_KEY in .env.local");
      return;
    }

    window.Dropbox.choose({
      success: (files) => {
        if (files.length > 0) {
          onUploaded(files[0].link, files[0].name);
        }
      },
      cancel: () => {},
      linkType: "preview",
      multiselect: false,
      extensions: ["*"],
    });
  };

  const handleRemove = async () => {
    if (!fileUrl) return;
    const supabase = createClient();
    // Only delete from Supabase storage if it's a Supabase URL
    if (fileUrl.includes("supabase")) {
      const urlParts = fileUrl.split("/task-files/");
      if (urlParts[1]) {
        await supabase.storage.from("task-files").remove([urlParts[1]]);
      }
    }
    onRemoved();
  };

  const isImage = fileName?.match(/\.(jpg|jpeg|png|gif|webp|svg)$/i);
  const isDropbox = fileUrl?.includes("dropbox");

  if (fileUrl && fileName) {
    return (
      <div className="flex items-center gap-1.5 bg-surface3 rounded px-2 py-1 text-xs group">
        <span className="text-txt3">{isDropbox ? "📦" : isImage ? "🖼" : "📎"}</span>
        <a href={fileUrl} target="_blank" rel="noopener noreferrer"
          className="text-violet2 hover:text-violet truncate max-w-[120px]" title={fileName}>
          {fileName}
        </a>
        <button onClick={(e) => { e.stopPropagation(); handleRemove(); }}
          className="text-txt3 hover:text-danger transition-colors opacity-0 group-hover:opacity-100" title="Remove file">✕</button>
      </div>
    );
  }

  return (
    <div className="relative inline-block">
      <input ref={inputRef} type="file" onChange={handleUpload} className="hidden" accept="*/*" />
      <button onClick={() => setMenuOpen(!menuOpen)} disabled={uploading}
        className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-surface3 hover:bg-border text-txt3 hover:text-txt transition-colors disabled:opacity-50"
        title="Attach file">
        {uploading ? (
          <span className="animate-pulse">Uploading…</span>
        ) : (
          <>
            <span>📎</span>
            <span>Attach</span>
            <span className="text-[8px] ml-0.5">▾</span>
          </>
        )}
      </button>
      {menuOpen && (
        <div className="absolute left-0 top-full mt-1 bg-surface2 border border-border rounded-lg shadow-xl py-1 w-40 z-30">
          <button onClick={() => { setMenuOpen(false); inputRef.current?.click(); }}
            className="w-full text-left px-3 py-1.5 text-xs text-txt2 hover:bg-surface3 hover:text-txt flex items-center gap-2">
            <span>💻</span> Local file
          </button>
          <button onClick={handleDropbox}
            className="w-full text-left px-3 py-1.5 text-xs text-txt2 hover:bg-surface3 hover:text-txt flex items-center gap-2">
            <span>📦</span> Dropbox
          </button>
        </div>
      )}
    </div>
  );
}
