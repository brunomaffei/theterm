// Lightweight OS detection for label/shortcut display (no plugin needed).

const ua =
  typeof navigator !== 'undefined'
    ? `${navigator.platform ?? ''} ${navigator.userAgent ?? ''}`
    : '';

export const isMac = /mac/i.test(ua);

/** Modifier-key label for the current OS ("⌘" on macOS, "Ctrl" elsewhere). */
export const modKey = isMac ? '⌘' : 'Ctrl';
