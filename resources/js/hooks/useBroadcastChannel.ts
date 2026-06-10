import { useEffect, useRef, useState } from 'react'
import Pusher, { type Channel } from 'pusher-js'

export interface BroadcastMessage {
    event: string
    data: Record<string, unknown>
    receivedAt: number
}

export function useBroadcastChannel(channelName: string): BroadcastMessage[] {
    const [messages, setMessages] = useState<BroadcastMessage[]>([])
    const pusherRef = useRef<Pusher | null>(null)
    const channelRef = useRef<Channel | null>(null)

    useEffect(() => {
        const { hostname, port } = window.location

        const pusher = new Pusher('local', {
            wsHost: hostname,
            wsPort: port ? Number(port) : 80,
            forceTLS: false,
            enabledTransports: ['ws'],
            cluster: 'mt1',
            wsPath: '/reverb',
        })

        pusherRef.current = pusher

        const channel = pusher.subscribe(channelName)
        channelRef.current = channel

        // Catch-all binding: listen for any event on this channel
        channel.bind_global((eventName: string, data: Record<string, unknown>) => {
            // Ignore internal Pusher lifecycle events
            if (eventName.startsWith('pusher:')) return
            setMessages(prev => [
                ...prev,
                { event: eventName, data, receivedAt: Date.now() },
            ])
        })

        return () => {
            channel.unbind_all()
            pusher.unsubscribe(channelName)
            pusher.disconnect()
            pusherRef.current = null
            channelRef.current = null
        }
    }, [channelName])

    return messages
}
