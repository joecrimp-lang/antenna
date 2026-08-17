export function signalTypeLabel(signalType: string | null | undefined): string {
  if (!signalType) return "Signal";

  return signalType
    .split("_")
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
