import { createContext, useContext, useLayoutEffect, useMemo, useState } from "react";

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
    // Default color for a drawn ROI (and the matching bar above its charts).
    roi: "#0084F9",
    // Accent for interactive chrome drawn over the map (minimap viewport,
    // magnifier frame). Matches the antd primary color of each theme.
    accent: "#1890ff",
    accentSoft: "rgba(24, 144, 255, 0.2)",
    accentFaint: "rgba(24, 144, 255, 0.3)",
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
    tagBg: "#2b2111",
    tagText: "#e8b339",
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
    roi: "#36cfc9",
    accent: "#ffc069",
    accentSoft: "rgba(255, 192, 105, 0.22)",
    accentFaint: "rgba(255, 192, 105, 0.35)",
};

// An ROI left on the theme's default color follows the theme when it is
// toggled; one the user actually picked keeps exactly the color they picked.
const THEME_ROI_DEFAULTS = new Set(
    [LIGHT_COLORS.roi, DARK_COLORS.roi, "#13c2c2"].map((c) => c.toLowerCase())
);

export const isThemeRoiColor = (color) =>
    typeof color === "string" && THEME_ROI_DEFAULTS.has(color.toLowerCase());

export const resolveRoiColor = (color, colors) =>
    isThemeRoiColor(color) ? colors.roi : color;

const toCssVar = (key) => `--app-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

const ThemeContext = createContext({
    darkMode: false,
    setDarkMode: () => { },
    colors: LIGHT_COLORS,
});

export const useAppTheme = () => useContext(ThemeContext);

export function ThemeProvider({ children }) {
    // The app always starts in light mode: the choice lasts for the current
    // page only and is deliberately not remembered across loads, so opening
    // Loom never lands you in dark mode unexpectedly.
    const [darkMode, setDarkMode] = useState(false);
    const colors = darkMode ? DARK_COLORS : LIGHT_COLORS;

    // Publish the palette to CSS before paint so nothing flashes in the old theme.
    useLayoutEffect(() => {
        const root = document.documentElement;
        Object.entries(colors).forEach(([key, value]) => {
            root.style.setProperty(toCssVar(key), value);
        });
        root.dataset.theme = darkMode ? "dark" : "light";
        root.style.colorScheme = darkMode ? "dark" : "light";
    }, [colors, darkMode]);

    const value = useMemo(() => ({ darkMode, setDarkMode, colors }), [darkMode, colors]);

    return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
