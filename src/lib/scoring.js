export function calculateVisibilityScore(engines, graphSources, tasks) {
  const engineAverage =
    engines.reduce((sum, engine) => sum + engine.visibility, 0) / engines.length;
  const graphAverage =
    graphSources.reduce((sum, source) => sum + source.completeness, 0) /
    graphSources.length;
  const openRiskPenalty = tasks.filter((task) => task.severity === "High").length * 4;

  return Math.round(engineAverage * 0.58 + graphAverage * 0.42 - openRiskPenalty);
}

export function getStatusTone(value) {
  if (value >= 80) return "good";
  if (value >= 60) return "watch";
  return "risk";
}

export function countPromptMentions(prompts) {
  return prompts.reduce((total, prompt) => {
    return (
      total +
      Object.values(prompt.engines).filter((result) =>
        ["Mentioned", "Correct", "Proxy ok"].includes(result)
      ).length
    );
  }, 0);
}
