import { createContext, useContext, useLayoutEffect, useMemo, useState } from "react";

const THEME_STORAGE_KEY = "loom-color-scheme";

/**
 * Single source of truth for the app's chrome colors.
 *
 * Every key is published to CSS as `--app-<kebab-case-key>` (so plain styles and
 * inline styles can use `var(--app-surface)` and update on toggle without a
 * re-render), and handed to components as `colors.<key>` for the d3 / deck.gl
 * code that has to compute colors in JS.
 *
 * Data-encoding colors (cluster palettes, gene expression scales, tissue
 * images) intentionally live outside of this and stay the same in both themes.
 */
export const LIGHT_COLORS = {
    bg: "#ffffff",
    surface: "#ffffff",
    surfaceSubtle: "#f9f9f9",
    surfaceMuted: "#f0f0f0",
    surfaceHover: "#f5f5f5",
    surfaceAccent: "#f0f8ff",
    text: "rgba(0, 0, 0, 0.88)",
    textStrong: "#262626",
    textSecondary: "#595959",
    textMuted: "#999999",
    border: "#e8e8e8",
    borderStrong: "#d9d9d9",
    overlay: "rgba(255, 255, 255, 0.9)",
    overlaySoft: "rgba(255, 255, 255, 0.8)",
    overlayFaint: "rgba(255, 255, 255, 0.5)",
    scrim: "rgba(0, 0, 0, 0.1)",
    shadow: "rgba(0, 0, 0, 0.15)",
    shadowSoft: "rgba(0, 0, 0, 0.1)",
    tagBg: "#e6f3fe",
    tagText: "#0084f9",
    tooltipBg: "rgba(0, 0, 0, 0.9)",
    tooltipText: "#ffffff",
    tooltipTextMuted: "#cccccc",
    tooltipBorder: "rgba(255, 255, 255, 0.2)",
    chartSurface: "#ffffff",
    chartAxis: "#666666",
    chartGrid: "#e0e0e0",
    chartOutline: "#333333",
    chartMuted: "#cccccc",
    chartPlaceholder: "#d9d9d9",
};

export const DARK_COLORS = {
    bg: "#141414",
    surface: "#1f1f1f",
    surfaceSubtle: "#1a1a1a",
    surfaceMuted: "#262626",
    surfaceHover: "#303030",
    surfaceAccent: "#111d2c",
    text: "rgba(255, 255, 255, 0.88)",
    textStrong: "#e6e6e6",
    textSecondary: "#bfbfbf",
    textMuted: "#8c8c8c",
    border: "#303030",
    borderStrong: "#434343",
    overlay: "rgba(31, 31, 31, 0.92)",
    overlaySoft: "rgba(31, 31, 31, 0.85)",
    overlayFaint: "rgba(20, 20, 20, 0.5)",
    scrim: "rgba(255, 255, 255, 0.12)",
    shadow: "rgba(0, 0, 0, 0.6)",
    shadowSoft: "rgba(0, 0, 0, 0.45)",
    tagBg: "#111d2c",
    tagText: "#3c9ae8",
    tooltipBg: "rgba(20, 20, 20, 0.95)",
    tooltipText: "#ffffff",
    tooltipTextMuted: "#bfbfbf",
    tooltipBorder: "rgba(255, 255, 255, 0.25)",
    chartSurface: "#1f1f1f",
    chartAxis: "#a6a6a6",
    chartGrid: "#3a3a3a",
    chartOutline: "#d9d9d9",
    chartMuted: "#595959",
    chartPlaceholder: "#434343",
};

const toCssVar = (key) => `--app-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

// Explicit choice from localStorage first, OS preference otherwise.
const getInitialDarkMode = () => {
    try {
        const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
        if (stored === "dark" || stored === "light") {
            return stored === "dark";
        }
    } catch {
        // localStorage can be unavailable (private mode / blocked cookies)
    }
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
};

const ThemeContext = createContext({
    darkMode: false,
    setDarkMode: () => { },
    colors: LIGHT_COLORS,
});

export const useAppTheme = () => useContext(ThemeContext);

export function ThemeProvider({ children }) {
    const [darkMode, setDarkMode] = useState(getInitialDarkMode);
    const colors = darkMode ? DARK_COLORS : LIGHT_COLORS;

    // Publish the palette to CSS before paint so nothing flashes in the old theme.
    useLayoutEffect(() => {
        const root = document.documentElement;
        Object.entries(colors).forEach(([key, value]) => {
            root.style.setProperty(toCssVar(key), value);
        });
        root.dataset.theme = darkMode ? "dark" : "light";
        root.style.colorScheme = darkMode ? "dark" : "light";
        try {
            window.localStorage.setItem(THEME_STORAGE_KEY, darkMode ? "dark" : "light");
        } catch {
            // ignore write failures, the toggle still works for this session
        }
    }, [colors, darkMode]);

    const value = useMemo(() => ({ darkMode, setDarkMode, colors }), [darkMode, colors]);

    return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
