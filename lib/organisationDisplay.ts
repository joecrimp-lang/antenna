export function organisationTypeLabel(
  organisationType: string | null | undefined
): string {
  if (!organisationType) return "Organisation";

  switch (organisationType) {
    case "buyer":
      return "Buyer";
    case "vendor":
      return "Vendor";
    case "technology_provider":
      return "Technology Provider";
    case "platform":
      return "Platform";
    default:
      return organisationType
        .split("_")
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
  }
}
