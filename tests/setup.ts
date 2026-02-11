/**
 * Global test setup — suppress Pi SDK's async session persist errors.
 *
 * Pi's SessionManager._persist fires async after session.prompt() returns.
 * When tests clean up ~/.loop/sessions/ between runs, the stale persist
 * hits a deleted file path and throws ENOENT as an unhandled rejection.
 * This is harmless — the session data is ephemeral test data.
 */
process.on("unhandledRejection", (err: any) => {
  if (err?.code === "ENOENT" && err?.path?.includes(".loop/sessions")) {
    // Silently ignore — stale session persist from previous test
    return;
  }
  // Re-throw anything else
  throw err;
});
