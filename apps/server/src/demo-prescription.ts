import type { ConsultationInput } from "./clinical-model.js";

/** Fictional presentation fixture. Never use these values to initialize a real consultation. */
export function demoPrescription(): ConsultationInput {
  return {
    id: "ed000001-2026-4000-8000-000000000001", revision: 0, language: "en", date: "2026-09-12", synthetic: true,
    patient: { id: "ed000001-2026-4000-8000-000000000002", name: "Ayesha Rahman", age: "32 years", sex: "Female", reference: "DEMO-BD-001", address: "Dhanmondi, Dhaka, Bangladesh" },
    clinician: { name: "Dr. Farhana Sultana (Demo)", qualifications: "Demonstration prescriber", designation: "Fictional outpatient consultation", registration: "Not registered - demonstration only", clinic: "MedDesk Demonstration Clinic", address: "Dhaka, Bangladesh", phone: "" },
    complaints: "Sneezing, watery nasal discharge and itchy eyes for 3 days.\nIntermittent mild headache for 1 day.",
    history: "Symptoms followed exposure to household dust. No fever or breathing difficulty reported.\nNo known kidney or liver disease; no regular medicines. All history is fictional.",
    allergies: "No known drug allergy in this fictional scenario.",
    examination: "Alert and comfortable. Clear nasal discharge. Chest clear on auscultation. All findings are simulated.",
    assessment: "Allergic rhinitis - illustrative working diagnosis.",
    investigations: "No investigations requested in this demonstration.",
    medications: [
      { id: "ed000001-2026-4000-8000-000000000003", catalogId: "", name: "Cetirizine", generic: "Cetirizine hydrochloride", strength: "10 mg", form: "Tablet", dose: "1 tablet (10 mg)", route: "Oral", frequency: "Once daily, in the evening", duration: "5 days", quantity: "5 tablets", instructions: "May cause drowsiness. Avoid driving if drowsy." },
      { id: "ed000001-2026-4000-8000-000000000004", catalogId: "", name: "Paracetamol", generic: "Paracetamol", strength: "500 mg", form: "Tablet", dose: "1 tablet (500 mg)", route: "Oral", frequency: "Every 6 hours only if needed for headache", duration: "Up to 2 days", quantity: "8 tablets", instructions: "Maximum 4 tablets in 24 hours in this example. Do not combine with other paracetamol-containing products." },
    ],
    advice: "Avoid dust and smoke. Use a mask when cleaning.\nSeek prompt assessment if breathing difficulty, facial swelling or worsening symptoms occur.",
    nutrition: "Maintain usual meals and adequate oral fluids.",
    followUp: "Review after 5 days if symptoms persist; earlier if worsening.",
    manualVitals: { bloodPressure: "112/72 mmHg", pulse: "76/min", temperature: "36.7 C", weight: "58 kg", spo2: "99%" },
    vitalReadingIds: [], sources: [],
  };
}
