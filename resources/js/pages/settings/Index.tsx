import AppLayout from '@/layouts/AppLayout'
import SettingsView from '@/layouts/SettingsView'

export default function Settings() {
    return <SettingsView />
}

// Array form keeps AppLayout the same persistent instance as the project pages,
// so terminal sessions in AppLayout refs survive navigation to/from settings.
Settings.layout = [AppLayout]
