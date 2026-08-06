/**
 * SHA-256 of the EXTRACTED TEXT, matching the desktop app's computeHash()
 * (main.js) which hashes content rather than raw file bytes — so the same book
 * imported as PDF here and DOCX there is still recognised as a duplicate.
 */
export async function sha256Hex(content: string): Promise<string> {
  if (!content) return "";
  const bytes = new TextEncoder().encode(content);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
