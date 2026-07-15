export function packageDescriptionLines(description: string): string[] {
  return description
    .split(/\n+/)
    .map((line) => line.trim().replace(/^[-•]\s*/, ""))
    .filter(Boolean);
}

export function findCommonPackageLines(descriptions: string[]): string[] {
  if (descriptions.length < 2) return [];

  const remainingDescriptions = descriptions.slice(1).map(
    (description) =>
      new Set(packageDescriptionLines(description).map(normalizePackageLine)),
  );

  return packageDescriptionLines(descriptions[0]).filter((line) =>
    remainingDescriptions.every((lines) => lines.has(normalizePackageLine(line))),
  );
}

export function withoutCommonPackageLines(
  description: string,
  commonPackageLines: string[],
  displayLimit = 8,
): string[] {
  const common = new Set(commonPackageLines.map(normalizePackageLine));
  return packageDescriptionLines(description)
    .filter((line) => !common.has(normalizePackageLine(line)))
    .slice(0, displayLimit);
}

function normalizePackageLine(line: string): string {
  return line.trim().toLocaleLowerCase("en-CA").replace(/\s+/g, " ");
}
