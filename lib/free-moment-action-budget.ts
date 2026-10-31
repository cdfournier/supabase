/**
 * A Free Moment's voluntary activity budget. `null` is intentionally distinct
 * from a large number: it means the Operator selected "No cap".
 */
export type FreeMomentActionLimit = number | null;

export function freeMomentActionLimit(value: number | null | undefined): FreeMomentActionLimit {
  if (value === null || value === undefined) {
    return null;
  }

  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
}

/**
 * Tool use is counted per requested tool action, rather than wall time or
 * model response. A long single action therefore remains legitimate, while a
 * multi-location sprint consumes its budget honestly.
 */
export function wouldExceedFreeMomentActionLimit(
  limit: FreeMomentActionLimit,
  actionsUsed: number,
  requestedActions: number
) {
  return limit !== null && actionsUsed + requestedActions > limit;
}

export function freeMomentActionLimitLabel(limit: FreeMomentActionLimit) {
  return limit === null ? "no cap" : String(limit);
}
