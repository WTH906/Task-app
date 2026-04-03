"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase";

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

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // 10MB limit
    if (file.size > 10 * 1024 * 1024) {
      alert("File must be under 10MB");
      return;
    }

    setUploading(true);
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

    // Reset input
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleRemove = async () => {
    if (!fileUrl) return;
    // Extract path from URL
    const supabase = createClient();
    const urlParts = fileUrl.split("/task-files/");
    if (urlParts[1]) {
      await supabase.storage.from("task-files").remove([urlParts[1]]);
    }
    onRemoved();
  };

  const isImage = fileName?.match(/\.(jpg|jpeg|png|gif|webp|svg)$/i);

  if (fileUrl && fileName) {
    return (
      <div className="flex items-center gap-1.5 bg-surface3 rounded px-2 py-1 text-xs group">
        <span className="text-txt3">{isImage ? "🖼" : "📎"}</span>
        <a
          href={fileUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-violet2 hover:text-violet truncate max-w-[120px]"
          title={fileName}
        >
          {fileName}
        </a>
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleRemove();
          }}
          className="text-txt3 hover:text-danger transition-colors opacity-0 group-hover:opacity-100"
          title="Remove file"
        >
          ✕
        </button>
      </div>
    );
  }

  return (
    <div className="inline-block">
      <input
        ref={inputRef}
        type="file"
        onChange={handleUpload}
        className="hidden"
        accept="*/*"
      />
      <button
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-surface3 hover:bg-border text-txt3 hover:text-txt transition-colors disabled:opacity-50"
        title="Attach file"
      >
        {uploading ? (
          <span className="animate-pulse">Uploading…</span>
        ) : (
          <>
            <span>📎</span>
            <span>File</span>
          </>
        )}
      </button>
    </div>
  );
}
