import '../css/app.css'
import { createInertiaApp } from '@inertiajs/vue3'
import { PiniaColada } from '@pinia/colada'
import { createPinia } from 'pinia'
import { createApp, h, type DefineComponent } from 'vue'
import Placeholder from './pages/Placeholder.vue'

const appName = import.meta.env.VITE_APP_NAME || 'Keera Agent'

const pages = import.meta.glob<DefineComponent>('./pages/**/*.vue', { eager: true, import: 'default' })

createInertiaApp({
    title: title => `${title} - ${appName}`,
    // Pages are ported to Vue incrementally; any page without a Vue version yet
    // renders the placeholder so the app still boots on every route.
    resolve: name => pages[`./pages/${name}.vue`] ?? Placeholder,
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
