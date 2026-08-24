const PUBLIC_AI_FLAG = "PUBLIC_AI_RECOMMENDATIONS_ENABLED";

export function publicAIRecommendationsEnabled(
  value = process.env[PUBLIC_AI_FLAG],
): boolean {
  return value === "1";
}
