/** Formats a sequential hawala code as the 6-digit zero-padded pickup code. */
export function formatHawalaCode(sequenceValue) {
  return String(sequenceValue).padStart(6, '0').slice(-6);
}
