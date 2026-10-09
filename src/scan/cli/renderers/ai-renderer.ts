import { styleText } from "node:util";

export function renderAiAdvisory(adviceText: string | null): void {
  if (!adviceText) return;

  console.log("│");
  console.log(
    `├  ${styleText(["bgCyan", "black"], " Muraqib AI Advice ⚡ ")} ${styleText("dim", "◈ Contextual Remediation")}`
  );
  console.log("│");

  const lines = adviceText.split("\n").filter((l) => l.trim() !== "");
  lines.forEach((line) => {
    console.log(`│  ${line}`);
  });

  console.log("│");
}
