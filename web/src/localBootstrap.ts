/** Runs before React: a desktop handoff ticket lives only in module RAM. */
export function takeLocalTicket(
  target: Location,
  navigation: History,
): string | undefined {
  if (!target.hash.startsWith("#local-ticket=")) return;
  const value = target.hash.slice("#local-ticket=".length);
  navigation.replaceState(null, "", target.pathname + target.search);
  if (
    target.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) ||
    target.pathname !== "/"
  )
    return;
  return /^[A-Za-z0-9_-]{22,256}$/.test(value) ? value : undefined;
}
const handoffPresent = location.hash.startsWith("#local-ticket=");
export const initialLocalTicket = takeLocalTicket(location, history);
export const initialLocalHandoffRejected =
  handoffPresent && !initialLocalTicket;
export function isLocalEntry() {
  return (
    location.protocol === "http:" &&
    ["127.0.0.1", "localhost", "[::1]"].includes(location.hostname) &&
    location.pathname === "/"
  );
}
