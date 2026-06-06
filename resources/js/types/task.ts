import { color } from '@/tokens'
import type { Task } from './type'

export const STATUS_CYCLE: Task['status'][] = ['pending', 'in_progress', 'completed', 'cancelled']

export const STATUS_COLORS: Record<Task['status'], string> = {
    pending:     color.textMuted,
    in_progress: color.warning,
    completed:   color.success,
    cancelled:   color.textFaint,
}

export const STATUS_LABELS: Record<Task['status'], string> = {
    pending:     'To Do',
    in_progress: 'In Progress',
    completed:   'Done',
    cancelled:   'Cancelled',
}
