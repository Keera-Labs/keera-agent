import AppLayout from '@/layouts/AppLayout'
import SettingsView from '@/layouts/SettingsView'

export default function Settings() {
    return <SettingsView />
}

Settings.layout = (page: React.ReactNode) => <AppLayout>{page}</AppLayout>
