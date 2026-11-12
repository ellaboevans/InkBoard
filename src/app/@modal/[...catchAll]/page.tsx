/**
 * Navigating anywhere else (admin, sign-in, back to the board) must clear
 * the overlay; otherwise the slot keeps showing the last intercepted poem.
 */
export default function NoModal() {
  return null;
}
