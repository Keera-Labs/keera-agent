<template>
    <span class="inline-flex items-center gap-[3px] shrink-0 relative">
        <span class="w-[3px] h-[3px] rounded-full bg-[#f59e0b] [animation:dots-bounce_1.0s_ease-in-out_infinite_0.0s]" />
        <span class="w-[3px] h-[3px] rounded-full bg-[#f59e0b] [animation:dots-bounce_1.0s_ease-in-out_infinite_0.15s]" />
        <span class="w-[3px] h-[3px] rounded-full bg-[#f59e0b] [animation:dots-bounce_1.0s_ease-in-out_infinite_0.3s]" />
        <span
            class="absolute top-1/2 -mt-0.5 w-1 h-1 rounded-full bg-[#d97706] shadow-[0_0_4px_1px_rgba(217,119,6,0.4)] [animation:dots-traveler_1.0s_linear_infinite]"
        />
    </span>
</template>

<style>
@keyframes dots-bounce { 0%, 60%, 100% { transform: translateY(0) } 30% { transform: translateY(-4px) } }
@keyframes dots-traveler {
    0%   { left: 0;    opacity: 0; }
    10%  { opacity: 1; }
    90%  { opacity: 1; }
    100% { left: 18px; opacity: 0; }
}
</style>
