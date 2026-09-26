import '../css/app.css'
import { createInertiaApp } from '@inertiajs/vue3'
import { PiniaColada } from '@pinia/colada'
import { createPinia } from 'pinia'
import { createApp, h, type DefineComponent } from 'vue'
import AppLayout from './layouts/AppLayout.vue'
import ProjectLayout from './layouts/ProjectLayout.vue'

const appName = import.meta.env.VITE_APP_NAME || 'Keera Agent'

const pages = import.meta.glob<DefineComponent>('./pages/**/*.vue', { eager: true, import: 'default' })

createInertiaApp({
    title: title => `${title} - ${appName}`,
    resolve: name => {
        const page = pages[`./pages/${name}.vue`]
        if (!page) throw new Error(`Unknown Inertia page "${name}": resources/js/pages/${name}.vue does not exist`)
        return page
    },
    // Pages without their own layout still render inside AppLayout, so it never
    // unmounts and the terminal sessions and their DOM survive every navigation.
    // Project-scoped pages also get ProjectLayout.
    layout: (_name, page) => (page.props.project ? [AppLayout, ProjectLayout] : AppLayout),
    setup({ el, App, props, plugin }) {
        createApp({ render: () => h(App, props) })
            .use(plugin)
            .use(createPinia())
            // Must be installed after Pinia: it stores its query cache in a Pinia store.
            .use(PiniaColada)
            .mount(el)
    },
    progress: {
        color: '#F87415',
    },
})
