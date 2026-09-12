import PDFDocument from 'pdfkit';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { demoPrescription } from '../apps/server/src/demo-prescription.ts';
import { parseConsultation } from '../apps/server/src/clinical-model.ts';

export async function buildDemoPdf() {
  const draft = demoPrescription();
  if (!parseConsultation(draft) || !draft.synthetic || draft.vitalReadingIds.length || draft.sources.length)
    throw new Error('The sample must be a valid, isolated fictional consultation.');
  const sourceSha256 = createHash('sha256').update(JSON.stringify(draft)).digest('hex');
  const doc = new PDFDocument({ size: 'A4', margin: 36, compress: true, info: {
    Title: 'Ayesha Rahman - fictional demonstration prescription', Author: 'MedDesk demonstration',
    Subject: `Fictional sample; not for patient use. Source SHA-256: ${sourceSha256}`,
    CreationDate: new Date('2026-09-12T00:00:00Z'), ModDate: new Date('2026-09-12T00:00:00Z'),
  } });
  const chunks = [];
  const complete = new Promise((resolve, reject) => {
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));
  });
  const ink = '#253047', muted = '#59677e', accent = '#485394', rule = '#d3d9e3';
  const text = (value, x, y, width, size = 9, bold = false, color = ink, align = 'left') => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size).fillColor(color);
    const options = { width, lineGap: 2.4, align };
    const height = doc.heightOfString(value, options);
    if (y + height > 795) throw new Error(`Sample content exceeds its one-page layout: ${value.slice(0, 40)}`);
    doc.text(value, x, y, options);
    return y + height;
  };
  const section = (title, value, x, y, width) => {
    y = text(title, x, y, width, 9, true, accent) + 3;
    return text(value, x, y, width, 9) + 13;
  };
  doc.roundedRect(36, 27, 523, 23, 4).fill('#fff4dd');
  text('FICTIONAL EXAMPLE / NOT FOR PATIENT USE', 46, 34, 503, 8, true, '#855a19', 'center');
  text('m+', 36, 67, 55, 30, true, accent);
  text('MEDDESK', 36, 103, 150, 9, true, muted);
  text(draft.clinician.designation, 36, 119, 150, 8, false, muted);
  text(draft.clinician.name, 194, 68, 365, 16, true, ink, 'right');
  text(`${draft.clinician.qualifications}\n${draft.clinician.clinic}\n${draft.clinician.registration}\n${draft.clinician.address}`, 194, 92, 365, 9, false, muted, 'right');
  doc.moveTo(36, 145).lineTo(559, 145).strokeColor(rule).lineWidth(0.8).stroke();
  text(`Name: ${draft.patient.name}`, 36, 155, 260, 10.5, true);
  text(`Age: ${draft.patient.age}   Sex: ${draft.patient.sex}`, 316, 155, 243, 9);
  text(`Patient ID: ${draft.patient.reference}   Date: ${draft.date}`, 36, 175, 523, 9);
  text(`Address: ${draft.patient.address}`, 36, 192, 523, 9);
  doc.moveTo(36, 213).lineTo(559, 213).strokeColor(rule).stroke();
  doc.moveTo(233, 230).lineTo(233, 754).strokeColor(rule).stroke();
  let notes = 233;
  for (const [label, value] of [
    ['C/C', draft.complaints], ['History', draft.history], ['Allergies', draft.allergies],
    ['O/E', draft.examination],
    ['Observations (simulated)', `BP: ${draft.manualVitals.bloodPressure}\nPulse: ${draft.manualVitals.pulse}\nTemperature: ${draft.manualVitals.temperature}\nWeight: ${draft.manualVitals.weight}\nSpO2: ${draft.manualVitals.spo2}`],
    ['Assessment / Dx', draft.assessment], ['Investigations', draft.investigations],
  ]) notes = section(label, value, 36, notes, 180);
  let rx = text('Rx', 252, 229, 307, 26, true, accent) + 14;
  for (const [index, medicine] of draft.medications.entries()) {
    rx = text(`${index + 1}. ${medicine.name} ${medicine.strength}`, 252, rx, 307, 12, true) + 5;
    rx = text(`${medicine.form} | Generic: ${medicine.generic}`, 267, rx, 292, 8.5, false, muted) + 7;
    for (const line of [`Dose: ${medicine.dose}`, `Route: ${medicine.route}`, `Frequency: ${medicine.frequency}`, `Duration: ${medicine.duration} | Quantity: ${medicine.quantity}`, medicine.instructions])
      rx = text(line, 267, rx, 292, 9) + 4;
    rx += 15;
  }
  rx = section('Advice', draft.advice, 252, rx, 307);
  rx = section('Diet', draft.nutrition, 252, rx, 307);
  rx = section('Follow-up', draft.followUp, 252, rx, 307);
  if (Math.max(notes, rx) > 753) throw new Error('The sample would overlap its footer.');
  doc.moveTo(36, 766).lineTo(559, 766).strokeColor(rule).stroke();
  text('Demo prescriber - no clinical or digital signature', 36, 776, 440, 8, false, muted);
  text('1 / 1', 507, 776, 52, 8, false, muted, 'right');
  doc.end();
  return { pdf: await complete, sourceSha256 };
}

export async function writeDemoArtifacts() {
  const { pdf, sourceSha256 } = await buildDemoPdf();
  const { encodeDemoLps } = await import('../apps/server/src/demo-lps.ts');
  const lps = encodeDemoLps(demoPrescription());
  const manifest = { fixture: 'demo-bd-001', patient: 'Ayesha Rahman', pages: 1, pdfBytes: pdf.length,
    pdfSha256: createHash('sha256').update(pdf).digest('hex'), sourceSha256, nativeLps: false,
    demoLps: true, lpsBytes: lps.length, lpsSha256: createHash('sha256').update(lps).digest('hex'),
    lpsProfile: 'meddesk-demo/1', lpsSigned: false };
  for (const folder of ['../apps/web/public/demo/', '../output/pdf/']) {
    const directory = new URL(folder, import.meta.url);
    await mkdir(directory, { recursive: true });
    await writeFile(new URL('ayesha-rahman-prescription.pdf', directory), pdf);
    await writeFile(new URL('ayesha-rahman-prescription.lps', directory), lps);
    await writeFile(new URL('manifest.json', directory), JSON.stringify(manifest, null, 2) + '\n');
  }
  console.log(JSON.stringify(manifest, null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await writeDemoArtifacts();
