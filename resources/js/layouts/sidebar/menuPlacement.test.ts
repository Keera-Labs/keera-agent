import { describe, expect, it } from 'vitest'
import { placeMenu } from './menuPlacement'

const viewport = { width: 1280, height: 600 }
// The project actions menu as rendered in the browser.
const MENU_11PX = { width: 180, height: 131 }
const MENU_18PX = { width: 217, height: 212 }

describe('placeMenu', () => {
    it('opens below the anchor when the menu fits', () => {
        expect(placeMenu({ top: 100, bottom: 130, right: 200 }, MENU_11PX, viewport)).toEqual({ top: 134, left: 20 })
    })

    it('opens above when the measured 18px menu does not fit below', () => {
        // 170px of room below: enough for the 160px the old code assumed, not for the real 212px.
        const anchor = { top: 392, bottom: 422, right: 200 }
        expect(placeMenu(anchor, MENU_11PX, viewport).top).toBe(426)
        expect(placeMenu(anchor, MENU_18PX, viewport).top).toBe(392 - 4 - 212)
    })

    it('stays inside the viewport when it fits neither below nor above', () => {
        const { top } = placeMenu({ top: 150, bottom: 180, right: 200 }, MENU_18PX, { width: 1280, height: 300 })
        expect(top).toBe(8)
    })

    it('never runs off the left edge when the menu is wider than the space before the anchor', () => {
        expect(placeMenu({ top: 100, bottom: 130, right: 202 }, MENU_18PX, viewport).left).toBe(8)
    })
})
