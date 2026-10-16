// Host side of the matrix-rain skin.
// The skin is fully procedural (no static artwork assets), so unlike artwork-based
// skins there is nothing to serve from the host: the entire presentation lives in
// the client bundle (lib/client.js), which mounts a canvas, injects scoped CSS,
// and registers every mutation for cleanup through ctx.effect().
export function apply() {
  // Intentionally empty. Returning cleanly keeps plugin activation trivially safe.
}
