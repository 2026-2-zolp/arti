/** One map upload/delete at a time; results from a retired view cannot update its successor. */
export function createMapOperationGate() {
  let alive = true;
  let busy = false;
  let generation = 0;
  return {
    activate() { alive = true; },
    dispose() { alive = false; busy = false; generation += 1; },
    begin(): number | null {
      if (!alive || busy) return null;
      busy = true;
      return ++generation;
    },
    isCurrent(ticket: number) { return alive && busy && ticket === generation; },
    finish(ticket: number) {
      if (ticket !== generation) return false;
      busy = false;
      return alive;
    },
  };
}
