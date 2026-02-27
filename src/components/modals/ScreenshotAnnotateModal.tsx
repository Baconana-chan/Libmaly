import { convertFileSrc } from "@tauri-apps/api/core";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "preact/hooks";

interface ScreenshotLike {
  path: string;
  filename: string;
}

export function ScreenshotAnnotateModal({
  shot,
  onSave,
  onCancel,
}: {
  shot: ScreenshotLike;
  onSave: (dataUrl: string) => void;
  onCancel: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tool, setTool] = useState<"draw" | "text">("draw");
  const [color, setColor] = useState("#ff4d4f");
  const [size, setSize] = useState(4);
  const [text, setText] = useState("note");
  const [imgSrc, setImgSrc] = useState("");
  const drawingRef = useRef(false);

  useEffect(() => {
    invoke<string>("get_screenshot_data_url", { path: shot.path })
      .then(setImgSrc)
      .catch(() => setImgSrc(convertFileSrc(shot.path)));
  }, [shot.path]);

  useEffect(() => {
    if (!imgSrc) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const img = new Image();
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
    };
    img.src = imgSrc;
  }, [imgSrc]);

  const pos = (e: PointerEvent) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width / rect.width;
    const sy = canvas.height / rect.height;
    return { x: (e.clientX - rect.left) * sx, y: (e.clientY - rect.top) * sy };
  };

  const onPointerDown = (e: PointerEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const p = pos(e);
    if (tool === "text") {
      if (!text.trim()) return;
      ctx.fillStyle = color;
      ctx.font = `${Math.max(12, size * 6)}px Arial`;
      ctx.fillText(text.trim(), p.x, p.y);
      return;
    }
    drawingRef.current = true;
    ctx.strokeStyle = color;
    ctx.lineWidth = size;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!drawingRef.current || tool !== "draw") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const p = pos(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  };

  const onPointerUp = () => {
    drawingRef.current = false;
  };

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-5"
      style={{ background: "rgba(0,0,0,0.85)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div
        className="rounded-lg overflow-hidden flex flex-col"
        style={{ width: "min(1100px, 95vw)", maxHeight: "92vh", background: "var(--color-bg)", border: "1px solid var(--color-border)" }}
      >
        <div className="flex items-center gap-2 px-3 py-2 border-b" style={{ borderColor: "var(--color-border-soft)" }}>
          <span className="text-xs font-semibold flex-1" style={{ color: "var(--color-text)" }}>
            Annotate screenshot: {shot.filename}
          </span>
          <button onClick={onCancel} className="px-2 py-1 rounded text-xs" style={{ background: "var(--color-panel-3)", color: "var(--color-text-muted)" }}>
            Cancel
          </button>
          <button
            onClick={() => {
              const canvas = canvasRef.current;
              if (!canvas) return;
              onSave(canvas.toDataURL("image/png"));
            }}
            className="px-3 py-1 rounded text-xs font-semibold"
            style={{ background: "var(--color-accent-dark)", color: "var(--color-white)" }}
          >
            Save
          </button>
        </div>
        <div className="flex items-center gap-2 px-3 py-2 border-b" style={{ borderColor: "var(--color-border-soft)" }}>
          <button onClick={() => setTool("draw")} className="px-2 py-1 rounded text-xs" style={{ background: tool === "draw" ? "var(--color-accent-dark)" : "var(--color-panel-3)", color: "var(--color-white)" }}>Draw</button>
          <button onClick={() => setTool("text")} className="px-2 py-1 rounded text-xs" style={{ background: tool === "text" ? "var(--color-accent-dark)" : "var(--color-panel-3)", color: "var(--color-white)" }}>Text</button>
          <input type="color" value={color} onChange={(e) => setColor(e.currentTarget.value)} />
          <input type="range" min="1" max="16" value={size} onChange={(e) => setSize(parseInt(e.currentTarget.value) || 4)} />
          <span className="text-[10px]" style={{ color: "var(--color-text-dim)" }}>{size}px</span>
          {tool === "text" && (
            <input
              type="text"
              value={text}
              onInput={(e) => setText((e.target as HTMLInputElement).value)}
              className="ml-2 px-2 py-1 rounded text-xs outline-none"
              style={{ background: "var(--color-panel-3)", color: "var(--color-text)", border: "1px solid var(--color-border-strong)" }}
              placeholder="Text to place"
            />
          )}
        </div>
        <div className="flex-1 overflow-auto p-3" style={{ background: "var(--color-bg-deep)" }}>
          <canvas
            ref={canvasRef}
            className="mx-auto block max-w-full h-auto rounded"
            onPointerDown={onPointerDown as any}
            onPointerMove={onPointerMove as any}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
          />
        </div>
      </div>
    </div>
  );
}
