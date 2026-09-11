import { useEffect, useRef, useState } from "react";
import { loadSavedSignature } from "../lib/signature";
export function SignatureTool({
  onPlace,
  disabled,
}: {
  onPlace: (src: string) => void;
  disabled: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    drawing = useRef(false);
  const hasInk = useRef(false);
  const changes = useRef(0);
  const [saved, setSaved] = useState("");
  const [src, setSrc] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    void loadSavedSignature(abort.signal)
      .then(value => {
        if (!value || abort.signal.aborted) return;
        setSaved(value);
        if (changes.current === 0) setSrc(value);
      }).catch(() => {});
    return () => abort.abort();
  }, []);
  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) * 600) / rect.width,
      y: ((event.clientY - rect.top) * 220) / rect.height,
    };
  };
  return (
    <div className="signature-tool">
      <h3>Doctor’s signature</h3>
      <p className="helper">
        Use your saved signature, draw or upload an image, then place it in the
        signature area. You can move or delete it in the document.
      </p>
      <canvas
        ref={canvas}
        width={600}
        height={220}
        aria-label="Draw your signature"
        onPointerDown={(event) => {
          changes.current++;
          const context = canvas.current!.getContext("2d")!;
          const p = point(event);
          context.beginPath();
          context.moveTo(p.x, p.y);
          context.strokeStyle = "#172b50";
          context.lineWidth = 3;
          context.lineCap = "round";
          drawing.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!drawing.current) return;
          const p = point(event),
            context = canvas.current!.getContext("2d")!;
          context.lineTo(p.x, p.y);
          context.stroke();
          hasInk.current = true;
        }}
        onPointerUp={() => {
          drawing.current = false;
          if (hasInk.current) setSrc(canvas.current!.toDataURL("image/png"));
        }}
        onPointerCancel={() => {
          drawing.current = false;
        }}
      />
      <div className="toolbar">
        {saved && <button className="button small" onClick={() => { changes.current++; setSrc(saved); setError(""); }}>Use saved signature</button>}
        <button
          className="button small"
          onClick={() => {
            changes.current++;
            canvas.current?.getContext("2d")?.clearRect(0, 0, 600, 220);
            hasInk.current = false;
            setSrc("");
          }}
        >
          Clear
        </button>
        <label className="button small">
          Upload image
          <input
            type="file"
            accept="image/png,image/jpeg"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              changes.current++;
              if (
                !["image/png", "image/jpeg"].includes(file.type) ||
                file.size > 200000
              ) {
                setError("Choose a PNG or JPEG smaller than 200 KB.");
                return;
              }
              const reader = new FileReader();
              reader.onload = () => {
                setSrc(String(reader.result));
                setError("");
              };
              reader.readAsDataURL(file);
            }}
          />
        </label>
      </div>
      {src && (
        <img
          className="signature-preview"
          src={src}
          alt="Signature ready to place"
        />
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <button
        className="button primary full"
        disabled={!src || disabled}
        onClick={() => onPlace(src)}
      >
        Place signature
      </button>
      {disabled && (
        <p className="helper">
          Write the doctor’s name in the document before placing a signature.
        </p>
      )}
      <p className="helper">
        This places your signature image. Certificate-backed digital signing is
        a separate verification step.
      </p>
    </div>
  );
}
