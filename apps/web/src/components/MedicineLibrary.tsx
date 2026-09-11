import { useEffect, useRef, useState } from "react";
import { api, type Medicine, type MedicineDetails } from "../lib/clinic";
import { Icon } from "./Icon";
import { Badge, Empty } from "./ui";

export function MedicineLibrary({
  onSelect,
  count = 0,
}: {
  onSelect: (medicine: Medicine) => void;
  count?: number;
}) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Medicine[]>([]);
  const [selected, setSelected] = useState<MedicineDetails | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState("Product");
  const detailRequest = useRef<AbortController | null>(null);
  useEffect(() => () => detailRequest.current?.abort(), []);
  useEffect(() => {
    const abort = new AbortController();
    setError("");
    setItems([]);
    if (query.trim().length < 2) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = window.setTimeout(() => {
      void api<{ medicines: Medicine[] }>(
        `/api/medicines/search?q=${encodeURIComponent(query)}`,
        { signal: abort.signal },
      )
        .then((r) => {
          if (!abort.signal.aborted) setItems(r.medicines);
        })
        .catch((e) => {
          if (!abort.signal.aborted) setError(e.message);
        })
        .finally(() => {
          if (!abort.signal.aborted) setLoading(false);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [query]);
  const inspect = async (id: string) => {
    detailRequest.current?.abort();
    const abort = new AbortController();
    detailRequest.current = abort;
    setError("");
    setSelected(null);
    try {
      const r = await api<{ medicine: MedicineDetails }>(
        `/api/medicines/${id}`,
        { signal: abort.signal },
      );
      if (abort.signal.aborted) return;
      setSelected(r.medicine);
      setTab("Product");
    } catch (e) {
      if (!abort.signal.aborted) setError((e as Error).message);
    }
  };
  return (
    <div className="medicine-browser">
      <div className="search-box">
        <Icon name="search" />
        <input
          aria-label="Search medicine catalog"
          autoComplete="off"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search brand, generic, strength or manufacturer…"
        />
        <kbd>{count.toLocaleString()} products</kbd>
      </div>
      <div className="source-note">
        <Icon name="info" size={16} />
        <span>
          Imported product listings. Confirm the exact product; dosing and
          safety coverage are not verified.
        </span>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="medicine-browser-grid">
        <div className="medicine-results" aria-live="polite">
          {loading ? (
            <div className="loading">Searching your medicine library…</div>
          ) : items.length ? (
            items.map((m) => (
              <button
                key={m.id}
                className={`medicine-result ${selected?.id === m.id ? "selected" : ""}`}
                onClick={() => void inspect(m.id)}
              >
                <span className="medicine-symbol">
                  <Icon name="medicine" />
                </span>
                <span>
                  <strong>
                    {m.name} <span>{m.strength}</span>
                  </strong>
                  <small>
                    {m.generic || "Generic not listed"} ·{" "}
                    {m.form || "Form not listed"}
                  </small>
                  <small>{m.manufacturer}</small>
                </span>
                <Icon name="chevron" size={16} />
              </button>
            ))
          ) : (
            <Empty
              icon="medicine"
              title={
                query.length >= 2
                  ? "No matching products"
                  : "Find the exact medicine"
              }
            >
              {query.length >= 2
                ? "Try the generic name or a different spelling. You can also author a medicine manually."
                : "Search your local catalog by brand, generic, strength or manufacturer."}
            </Empty>
          )}
          {items.length === 30 && (
            <p className="helper">
              Showing the first 30 matches. Refine your search for the exact
              product.
            </p>
          )}
        </div>
        <div className="medicine-detail">
          {selected ? (
            <>
              <Badge tone="amber">Imported · needs product review</Badge>
              <h2>{selected.name}</h2>
              <p>{selected.generic}</p>
              <div className="detail-pills">
                <Badge>{selected.strength || "Strength not listed"}</Badge>
                <Badge>{selected.form || "Form not listed"}</Badge>
              </div>
              <div className="tabs">
                {["Product", "Source text", "Coverage"].map((name) => (
                  <button
                    key={name}
                    className={tab === name ? "active" : ""}
                    onClick={() => setTab(name)}
                  >
                    {name}
                  </button>
                ))}
              </div>
              {tab === "Product" && (
                <dl className="facts">
                  {[
                    ["Manufacturer", selected.manufacturer],
                    ["Pack", selected.packSize],
                    ["Listed unit price", selected.unitPrice],
                    ["Source file", selected.sourceFile],
                    [
                      "Imported file modified",
                      new Date(selected.sourceModifiedAt).toLocaleDateString(),
                    ],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <dt>{k}</dt>
                      <dd>{v || "Not supplied"}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {tab === "Source text" && (
                <div className="reference-text">
                  <p className="helper">
                    Original imported sections may be incomplete or mislabeled.
                    These are reference text, not prescribing instructions.
                  </p>
                  {Object.entries(selected.sourceText).length ? (
                    Object.entries(selected.sourceText).map(([key, value]) => (
                      <section key={key}>
                        <h4>{key.replaceAll("_", " ")}</h4>
                        <p>{value}</p>
                      </section>
                    ))
                  ) : (
                    <p>No reference text was supplied.</p>
                  )}
                </div>
              )}
              {tab === "Coverage" && (
                <div className="notice">
                  <strong>Clinical safety has not been checked</strong>
                  <p>
                    Drug interactions, contraindications, registration and
                    substitution equivalence require reviewed reference sources.
                    An empty result does not mean a medicine is safe.
                  </p>
                </div>
              )}
              <div className="detail-actions">
                <button
                  className="button primary"
                  onClick={() => onSelect(selected)}
                >
                  <Icon name="plus" size={17} />
                  Add this product to draft
                </button>
                {selected.url && (
                  <a
                    href={selected.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-link"
                  >
                    Open original source ↗
                  </a>
                )}
              </div>
            </>
          ) : (
            <Empty icon="reader" title="A closer look">
              Select a product to inspect its identity, source and available
              reference information.
            </Empty>
          )}
        </div>
      </div>
    </div>
  );
}
