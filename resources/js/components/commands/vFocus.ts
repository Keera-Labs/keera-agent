import type { Directive } from 'vue'

// The native autofocus attribute is ignored for elements inserted after page load.
export const vFocus: Directive<HTMLElement> = { mounted: el => el.focus() }
