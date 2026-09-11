import { useEffect, useState } from "react";
import { api, type Consultation } from "../lib/clinic";
import { Badge, Empty, Field } from "./ui";
import { PrescriptionPaper } from "./PrescriptionPaper";
export function RevisionHistory({ id }: { id: string }) {
  const [versions, setVersions] = useState<Consultation[]>([]),
    [compare, setCompare] = useState(1),
    [error, setError] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    void api<{ revisions: Consultation[] }>(
      `/api/consultations/${id}/history`,
      { signal: abort.signal },
    )
      .then((r) => setVersions(r.revisions))
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => abort.abort();
  }, [id]);
  return (
    <div className="panel-body">
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {versions.length > 0 ? (
        <>
          <p>
            Current revision {versions[0].revision} · {versions[0].patient.name}
            . Earlier saved versions are retained locally.
          </p>
          {versions.length > 1 ? (
            <>
              <Field label="Compare with an earlier revision">
                <select
                  value={compare}
                  onChange={(e) => setCompare(Number(e.target.value))}
                >
                  {versions.slice(1).map((v, i) => (
                    <option key={v.revision} value={i + 1}>
                      Revision {v.revision} ·{" "}
                      {new Date(v.updatedAt).toLocaleString()}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="revision-comparison">
                <div>
                  <Badge>Earlier · revision {versions[compare].revision}</Badge>
                  <PrescriptionPaper draft={versions[compare]} />
                </div>
                <div>
                  <Badge>Current · revision {versions[0].revision}</Badge>
                  <PrescriptionPaper draft={versions[0]} />
                </div>
              </div>
            </>
          ) : (
            <Empty icon="history" title="First saved revision">
              Your next saved edit will preserve this version for comparison.
            </Empty>
          )}
        </>
      ) : (
        !error && <p>Loading revision history…</p>
      )}
    </div>
  );
}
