export function CenteredMessage({ text }: { text: string }) {
    return (
        <div className="flex flex-1 items-center justify-center p-12 text-zinc-400 text-[13px]">
            {text}
        </div>
    )
}
