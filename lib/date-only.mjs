function calendarDateIsValid(value) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

export function normalizeDateOnly(value, fieldName = "Date") {
  if (value == null || (typeof value === "string" && !value.trim())) return undefined;
  let candidate;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new Error(`${fieldName} must be a valid date.`);
    candidate = value.toISOString().slice(0, 10);
  } else {
    const cleaned = String(value).trim();
    const dateOnly = cleaned.match(/^(\d{4}-\d{2}-\d{2})$/);
    const isoTimestamp = cleaned.match(/^(\d{4}-\d{2}-\d{2})T.+$/);
    if (dateOnly) candidate = dateOnly[1];
    else if (isoTimestamp && Number.isFinite(Date.parse(cleaned))) candidate = isoTimestamp[1];
    else throw new Error(`${fieldName} must be a valid date.`);
  }
  if (!calendarDateIsValid(candidate)) throw new Error(`${fieldName} must be a valid date.`);
  return candidate;
}
