import { useEffect, useState, type ReactNode } from 'react'

const defaultPanelCls = 'bg-modal border border-stroke rounded-lg p-6 w-[340px] flex flex-col gap-3.5'

/**
 * Trigger-based modal. Renders `trigger` inline; clicking it (or pressing
 * Enter/Space while focused) opens an overlay + centered panel. The modal owns
 * its own open state. `children` may be a node or a `(close) => node` render
 * prop so the body can dismiss the modal itself (e.g. after a successful
 * submit). Closes on Escape and backdrop click.
 */
export default function Modal({
    trigger,
    children,
    panelClassName = defaultPanelCls,
    onOpenChange,
    ariaLabel,
}: {
    trigger: ReactNode
    children: ReactNode | ((close: () => void) => ReactNode)
    panelClassName?: string
    onOpenChange?: (open: boolean) => void
    ariaLabel?: string
}) {
    const [open, setOpen] = useState(false)

    function setOpenState(next: boolean) {
        setOpen(next)
        onOpenChange?.(next)
    }
    const openModal = () => setOpenState(true)
    const close = () => setOpenState(false)

    useEffect(() => {
        if (!open) return
        function onKey(e: KeyboardEvent) {
            if (e.key === 'Escape') close()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open])

    return (
        <>
            <div
                role="button"
                tabIndex={0}
                aria-label={ariaLabel}
                onClick={openModal}
                onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        openModal()
                    }
                }}
            >
                {trigger}
            </div>
            {open && (
                <div
                    className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100]"
                    onClick={close}
                >
                    <div className={panelClassName} onClick={e => e.stopPropagation()}>
                        {typeof children === 'function' ? children(close) : children}
                    </div>
                </div>
            )}
        </>
    )
}
