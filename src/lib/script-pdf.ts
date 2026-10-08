"use client";

import { projectDuration, type MotionProject } from "./motion/types";

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

/** Production sheet: narration and timing per scene. */
export async function exportScriptPdf(project: MotionProject): Promise<void> {
  const html2pdf = (await import("html2pdf.js")).default;
  const element = document.createElement("div");
  element.innerHTML = `
    <div style="padding: 40px; font-family: sans-serif; background: white; color: black;">
      <h1 style="font-size: 32px;">${escapeHtml(project.title)}</h1>
      <p style="color: #666; text-transform: uppercase;">${escapeHtml(project.category)} • ${project.ratio} • ${projectDuration(project).toFixed(1)} s</p>
      ${project.scenes
        .map(
          (s, i) => `
        <div style="margin-top: 30px; border-top: 1px solid #eee; padding-top: 20px;">
          <p style="color: #666;">SCÈNE ${i + 1} • ${s.duration.toFixed(1)} s • transition : ${s.transition.type}</p>
          <p style="font-size: 18px;">${s.voiceOver ? `« ${escapeHtml(s.voiceOver)} »` : "<em>(silence)</em>"}</p>
          <p style="font-size: 12px; color: #888;">Fond : ${escapeHtml(s.visualPrompt)}</p>
        </div>`,
        )
        .join("")}
    </div>`;
  await html2pdf()
    .from(element)
    .set({ margin: 10, filename: "neuro-studio-script.pdf", html2canvas: { scale: 2 }, jsPDF: { unit: "mm", format: "a4" } })
    .save();
}
