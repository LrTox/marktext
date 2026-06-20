/// Check whether the package is updatable at runtime.
// The flag is computed once by main on startup (see boot info) so callers can
// read it synchronously during command-center initialization without a race.
export const isUpdatable = (): boolean => {
  return Boolean(window.electron?.isUpdatable)
}
