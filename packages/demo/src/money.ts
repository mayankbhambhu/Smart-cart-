/** GST contained in a GST-inclusive amount, rounded half up (the API's rule). */
export const gstIncluded = (total: number, rateBp: number) =>
  rateBp === 0 ? 0 : Math.floor((total * rateBp * 2 + (10_000 + rateBp)) / (2 * (10_000 + rateBp)));

const EXIT_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
/** A six-character exit code from the same alphabet the API uses. */
export const exitCode = () =>
  Array.from({ length: 6 }, () => EXIT_ALPHABET[Math.floor(Math.random() * EXIT_ALPHABET.length)]).join("");
