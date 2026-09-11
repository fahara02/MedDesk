import { useState } from "react";
import { reviewIssues, type ConsultationInput } from "../lib/clinic";
import { Icon } from "./Icon";
import { Badge } from "./ui";
export function Assistant({
  draft,
  navigate,
}: {
  draft: ConsultationInput;
  navigate: (page: string) => void;
}) {
  const [question, setQuestion] = useState(""),
    [check, setCheck] = useState(false);
  const issues = reviewIssues(draft);
  return (
    <>
      <div className="assistant-welcome">
        <span className="ai-orb">
          <Icon name="spark" size={26} />
        </span>
        <h2>A thoughtful second look.</h2>
        <p>
          Review what is recorded, find missing information, and keep the source
          in view.
        </p>
      </div>
      <Badge tone="amber">AI provider not configured</Badge>
      <p className="helper">
        Clinical text is not being sent to an AI service. Local record checks
        work without a provider.
      </p>
      <div className="suggestion-list">
        <button onClick={() => setCheck(true)}>
          <Icon name="check" />
          Review missing information
          <Icon name="arrow" size={16} />
        </button>
        <button
          onClick={() => {
            setCheck(false);
            setQuestion(
              "Explain the written instructions in this prescription.",
            );
          }}
        >
          <Icon name="reader" />
          Explain this prescription
          <Icon name="arrow" size={16} />
        </button>
        <button onClick={() => navigate("history")}>
          <Icon name="history" />
          Open previous visits
          <Icon name="arrow" size={16} />
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
              This checks field presence only. It does not establish clinical
              correctness or safety.
            </p>
          )}
          <button className="text-link" onClick={() => navigate("studio")}>
            Return to the source fields →
          </button>
        </section>
      )}
      <div className="assistant-composer">
        <textarea
          aria-label="Question for clinical assistant"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask about the selected consultation…"
          rows={3}
        />
        <div>
          <span>
            <Icon name="evidence" size={14} />
            Current draft only
          </span>
          <button
            className="icon-button"
            disabled
            aria-label="Send question — configure an AI provider first"
          >
            <Icon name="arrow" />
          </button>
        </div>
      </div>
      <button className="text-link" onClick={() => navigate("settings")}>
        View AI connection requirements →
      </button>
    </>
  );
}
