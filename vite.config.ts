import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import fastapi from "fastapi-vite-plugin"
import { defineConfig } from "vite"

export default defineConfig({
    plugins: [
        fastapi({
            input: "resources/js/app.tsx",
            refresh: true,
        }),
        react(),
        tailwindcss(),
    ],
})
