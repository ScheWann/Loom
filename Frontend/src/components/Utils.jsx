// Convert a HEX color string like "#FF6600" to [r, g, b]
export const convertHEXToRGB = (hex) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return [r, g, b];
};

export const hexToRgb = (hex) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result
        ? [
            parseInt(result[1], 16),
            parseInt(result[2], 16),
            parseInt(result[3], 16),
        ]
        : [255, 0, 0];
};

export const COLOR_PALETTE = [
    "#1f77b4",
    "#ff7f0e",
    "#2ca02c",
    "#d62728",
    "#9467bd",
    "#8c564b",
    "#e377c2",
    "#7f7f7f",
    "#bcbd22",
    "#17becf",
    "#aec7e8",
    "#ffbb78",
    "#98df8a",
    "#ff9896",
    "#c5b0d5",
    "#c49c94",
    "#f7b6d3",
    "#c7c7c7",
    "#dbdb8d",
    "#9edae5",
];

export const COLOR_BREWER2_PALETTE = [
    // "#a6cee3",
    "#b15928",
    "#33a02c",
    "#fb9a99",
    "#e31a1c",
    "#fdbf6f",
    "#ff7f00",
    "#cab2d6",
    "#1f78b4",
    "#6a3d9a",
    "#ffff99",
    "#b2df8a",
];

export const COLOR_BREWER3_PALETTE_EXTRA = [
    "#984ea3", 
    "#377eb8", 
    "#e41a1c", 
    "#ff7f00",
    "#4daf4a", 
];

// Debounce utility function
export const debounce = (func, delay) => {
    let timeoutId;
    return (...args) => {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => func.apply(null, args), delay);
    };
};

// Interpolate between two colors
export const interpolateColor = (color1, color2, factor) => {
    const rgb1 = convertHEXToRGB(color1);
    const rgb2 = convertHEXToRGB(color2);

    const r = Math.round(rgb1[0] + factor * (rgb2[0] - rgb1[0]));
    const g = Math.round(rgb1[1] + factor * (rgb2[1] - rgb1[1]));
    const b = Math.round(rgb1[2] + factor * (rgb2[2] - rgb1[2]));

    return [r, g, b];
};

// Generate sequential color scale for gene expression (white to dark with enhanced contrast)
export const getSequentialColor = (value, minValue, maxValue, baseColor = "#b30000") => {
    if (maxValue === minValue) {
        // If all values are the same, return a middle color
        return interpolateColor("#ffffff", baseColor, 0.5);
    }

    // Normalize value
    const normalizedValue = (value - minValue) / (maxValue - minValue);

    // Makes the color transition more pronounced for smaller expression differences
    const enhancedValue = Math.pow(normalizedValue, 0.2);

    const lightColor = "#ffffff";
    return interpolateColor(lightColor, baseColor, enhancedValue);
};
