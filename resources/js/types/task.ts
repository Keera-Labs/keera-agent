import { color } from '@/tokens'
import type { Task } from './type'

export const STATUS_CYCLE: Task['status'][] = ['pending', 'in_progress', 'completed', 'cancelled']

export const STATUS_COLORS: Record<Task['status'], string> = {
    pending:     color.textMuted,
    in_progress: color.accent,
    completed:   color.success,
    cancelled:   color.textFaint,
}

export const STATUS_LABELS: Record<Task['status'], string> = {
    pending:     'Backlog',
    in_progress: 'Running',
    completed:   'Done',
    cancelled:   'Cancelled',
}
