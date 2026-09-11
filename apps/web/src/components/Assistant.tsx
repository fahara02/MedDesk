import { useEffect, useRef, useState } from "react";
import { api, reviewIssues, type ConsultationInput } from "../lib/clinic";
import { Badge } from "./ui";
import type { DrugSource } from "../../../server/src/drug-index";

interface Answer {
  answer: string;
  proposal: string;
  citations: string[];
  sources: DrugSource[];
  model: string;
  documentHash: string;
}
export function Assistant({
  draft,
  navigate,
  onInsert,
}: {
  draft: ConsultationInput;
  navigate: (page: string) => void;
  onInsert?: (text: string) => void;
}) {
  const [question, setQuestion] = useState(""),
    [check, setCheck] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [answer, setAnswer] = useState<Answer | null>(null),
    [snapshot, setSnapshot] = useState("");
  const [connection, setConnection] = useState<{
    configured: boolean;
    model: string | null;
    retrieval: { products: number };
  } | null>(null);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => {
    let active = true;
    void api<typeof connection>("/api/assistant/status")
      .then((value) => {
        if (active) setConnection(value);
      })
      .catch(() => {});
    return () => {
      active = false;
      pending.current?.abort();
    };
  }, []);
  const stale = !!answer && snapshot !== JSON.stringify(draft);
  const issues = reviewIssues(draft);
  const ask = async () => {
    setBusy(true);
    setError("");
    setAnswer(null);
    setCheck(false);
    const controller = new AbortController();
    pending.current = controller;
    const submitted = JSON.stringify(draft);
    try {
      const value = await api<Answer>("/api/assistant/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, draft }),
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setAnswer(value);
      setSnapshot(submitted);
    } catch (error) {
      if (!controller.signal.aborted) setError((error as Error).message);
    } finally {
      if (pending.current === controller) {
        setBusy(false);
        pending.current = null;
      }
    }
  };
  return (
    <div className="prescription-assistant">
      <h3>Write with your sources</h3>
      <Badge tone={connection?.configured ? "blue" : "amber"}>
        {connection?.configured
          ? "Assistant ready"
          : "Assistant unavailable"}
      </Badge>
      <p className="helper">
        Ask about this document and{" "}
        {connection?.retrieval?.products?.toLocaleString() || "your"} indexed
        drug records. Sending a question shares the current document and
        retrieved excerpts with the AI service.
      </p>
      <div className="suggestion-list">
        <button
          onClick={() => {
            setCheck(true);
            setAnswer(null);
          }}
        >
          Review missing information
        </button>
        <button
          onClick={() =>
            setQuestion(
              "Explain the written prescription using the source records. Flag missing details instead of guessing.",
            )
          }
        >
          Explain this prescription
        </button>
        <button
          onClick={() =>
            setQuestion(
              "Suggest clearer wording for the instructions already written, preserving every medicine, number and unit exactly.",
            )
          }
        >
          Improve instruction wording
        </button>
      </div>
      {check && (
        <section className="assistant-result">
          <Badge>Local completeness check</Badge>
          <h3>
            {issues.length
              ? `${issues.length} items to review`
              : "Required authoring fields are present"}
          </h3>
          {issues.length ? (
            <ul>
              {issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          ) : (
            <p>
              Field presence is checked. Clinical correctness remains the
              doctor’s review.
            </p>
          )}
        </section>
      )}
      <textarea
        aria-label="Question for clinical assistant"
        rows={4}
        value={question}
        onChange={(event) => setQuestion(event.target.value)}
        placeholder="Ask, rewrite, explain or look up a drug…"
      />
      <div className="toolbar">
        <button
          className="button primary"
          disabled={busy || !question.trim()}
          onClick={() => void ask()}
        >
          {busy ? "Reviewing your sources…" : "Ask assistant"}
        </button>
        {busy && (
          <button className="button" onClick={() => pending.current?.abort()}>
            Cancel
          </button>
        )}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {answer && (
        <section className="assistant-result">
          <Badge tone="blue">Response with sources</Badge>
          <p className="assistant-answer">{answer.answer}</p>
          {answer.proposal && (
            <>
              <h4>Proposed document text</h4>
              <pre className="speech-transcript">{answer.proposal}</pre>
              {stale ? (
                <p className="notice">
                  The document changed after this answer. Ask again before
                  inserting a proposal.
                </p>
              ) : onInsert ? (
                <button
                  className="button primary full"
                  onClick={() => onInsert(answer.proposal)}
                >
                  Insert proposal at cursor
                </button>
              ) : (
                <button className="button" onClick={() => navigate("studio")}>
                  Open the document editor to apply changes
                </button>
              )}
            </>
          )}
          <details>
            <summary>Sources ({answer.citations.length})</summary>
            {answer.citations.includes("document") && (
              <p className="helper">Current prescription document</p>
            )}
            {answer.sources
              .filter((source) => answer.citations.includes(source.id))
              .map((source) => (
                <article className="assistant-source" key={source.id}>
                  <strong>{source.title}</strong>
                  <p>{source.excerpt}</p>
                  <small>{source.sourceFile} · imported reference</small>
                  {source.url && (
                    <a
                      className="text-link"
                      href={source.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open original source ↗
                    </a>
                  )}
                </article>
              ))}
          </details>
        </section>
      )}
    </div>
  );
}
