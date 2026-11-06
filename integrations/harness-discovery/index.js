/** AnyWork discovery companion for the official Harness local carrier. */
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { publishDescriptor } from "./descriptor.js";

export const name = "anywork-harness-discovery";
export const inject = ["webServer", "connection"];

export async function apply(ctx, config = {}) {
  const descriptorPath =
    config.descriptorPath ??
    join(homedir(), ".anywork", "harness", "host.json");
  if (typeof descriptorPath !== "string" || !isAbsolute(descriptorPath)) {
    throw new Error("AnyWork discovery requires an absolute descriptorPath");
  }
  // Both services are provided by the same existing host. Inject waits for their
  // readiness, including the webServer's async listen/bind. No runner is started.
  const origin = ctx.webServer.getOrigin();
  const url = ctx.connection.authenticatedUrl(origin);
  await ctx.effect(
    () => publishDescriptor(descriptorPath, url),
    "AnyWork Harness discovery descriptor",
  );
}
