/**
 * Set by a screen that carries a bottom app bar of its own. Material stacks neither two bottom bars
 * nor a bar over a bar, so the shell drops its navigation bar for as long as one is present.
 */
export const bottomBar = $state({ present: false });
