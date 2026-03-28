import React, { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import DeckGL from '@deck.gl/react';
import { GeneSettings } from './GeneList';
import { CellSettings } from './CellList';
import { Collapse, Radio, Button, Input, ColorPicker, AutoComplete, Spin, Switch, message, Slider } from "antd";
import { CloseOutlined, EditOutlined, RedoOutlined, BorderOutlined } from '@ant-design/icons';
import { OrthographicView } from '@deck.gl/core';
import { BitmapLayer, ScatterplotLayer, PolygonLayer, LineLayer } from '@deck.gl/layers';
import { convertHEXToRGB, COLOR_PALETTE, getSequentialColor } from './Utils';


export const SampleViewer = ({
    selectedSamples,
    coordinatesData,
    cellTypesData,
    selectedCellTypes,
    setSelectedCellTypes,
    cellTypeColors,
    setCellTypeColors,
    umapDataSets,
    setUmapDataSets,
    umapLoading,
    setUmapLoading,
    hoveredCluster,
    clusterColorMappings,
    onImagesLoaded,
    kosaraDisplayEnabled = true,
    trajectoryGenes = [],
    trajectoryGenesSample = null,
    trajectoryGuideline = null,
    onTrajectoryAnalysisComplete,
    onAreaSaved,  // Add new callback for when areas are saved
    onAreaDeleted
}) => {
    const containerRef = useRef(null);
    const areaEditPopupRef = useRef(null);
    const lastLoadedTrajectoryRef = useRef(null); // Track the last loaded trajectory gene combination to prevent redundant API calls
    const viewStatePendingRef = useRef(null);
    const viewStateRafRef = useRef(null);
    const kosaraLoadingSamplesRef = useRef({});
    const spinnerFallbackTimeoutRef = useRef(null); // Timeout for fallback spinner hiding
    const fetchingImages = useRef(new Set()); // Track which images are currently being fetched
    const imagesLoadedCallbackCalled = useRef(false); // Track if callback has been called for current samples

    // Throttle hover-derived state updates (tooltips / hovered trajectory) to avoid re-render storms
    const hoverPendingRef = useRef(null);
    const hoverRafRef = useRef(null);
    const lastHoverKeyRef = useRef(null);

    // Keep latest values for native pointer handlers (fast clicks) without stale closures
    const mainViewStateRef = useRef(null);
    const drawingPointsRef = useRef([]);
    const currentDrawingSampleRef = useRef(null);
    const finishDrawingRef = useRef(null);

    const [mainViewState, setMainViewState] = useState(null);
    const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
    const [imageSizes, setImageSizes] = useState({});
    const [availableGenes, setAvailableGenes] = useState([]); // All genes that have been added to the list
    const [selectedGenes, setSelectedGenes] = useState([]); // Currently selected (checked) genes
    const [geneColorMap, setGeneColorMap] = useState({}); // { geneName: '#RRGGBB' }

    const [radioCellGeneModes, setRadioCellGeneModes] = useState(
        selectedSamples.reduce((acc, sample) => ({ ...acc, [sample.id]: 'cellTypes' }), {})
    );

    // Previous modes for each sample when Kosara display is toggled off
    const [previousModes, setPreviousModes] = useState(
        selectedSamples.reduce((acc, sample) => ({ ...acc, [sample.id]: 'cellTypes' }), {})
    );

    // Previous gene selections when Kosara display is toggled off
    const [previousGeneSelections, setPreviousGeneSelections] = useState({});

    const [previousKosaraData, setPreviousKosaraData] = useState({});

    // Kosara gene expression data per sample returned from backend
    const [kosaraDataBySample, setKosaraDataBySample] = useState({}); // { sampleId: [ { id, cell_x, cell_y, cell_type, total_expression, angles:{}, radius:{}, ratios:{} }, ... ] }

    // Loading state for gene mode switching
    const [isKosaraLoading, setIsKosaraLoading] = useState(false);

    // Track which samples currently have an in-flight kosara request
    const [kosaraLoadingSamples, setKosaraLoadingSamples] = useState({}); // { sampleId: true }

    // Loading state for trajectory analysis
    const [isTrajectoryAnalyzing, setIsTrajectoryAnalyzing] = useState(false);

    // Store analyzing trajectories that should persist even when window is closed
    const [analyzingTrajectories, setAnalyzingTrajectories] = useState([]); // [{ areaId, start, end, width, name }]

    // Single gene expression data per sample for sequential coloring
    const [singleGeneDataBySample, setSingleGeneDataBySample] = useState({}); // { sampleId: { geneName: string, cells: [...], min_expression: ..., max_expression: ... } }

    // Drawing state
    const [isDrawing, setIsDrawing] = useState(false);
    const [drawingPoints, setDrawingPoints] = useState([]);
    const [customAreas, setCustomAreas] = useState([]);
    const [currentDrawingSample, setCurrentDrawingSample] = useState(null);
    const [mousePosition, setMousePosition] = useState(null);
    const [hoveredCell, setHoveredCell] = useState(null);

    useEffect(() => {
        mainViewStateRef.current = mainViewState;
    }, [mainViewState]);

    useEffect(() => {
        drawingPointsRef.current = drawingPoints;
    }, [drawingPoints]);

    useEffect(() => {
        currentDrawingSampleRef.current = currentDrawingSample;
    }, [currentDrawingSample]);

    // Area customization tooltip state
    const [isAreaTooltipVisible, setIsAreaTooltipVisible] = useState(false);
    const [pendingArea, setPendingArea] = useState(null);
    const [areaName, setAreaName] = useState('');
    const [areaColor, setAreaColor] = useState('#f72585');
    const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });

    // Area edit/delete popup state
    const [isAreaEditPopupVisible, setIsAreaEditPopupVisible] = useState(false);
    const [selectedAreaForEdit, setSelectedAreaForEdit] = useState(null);
    const [editAreaName, setEditAreaName] = useState('');
    const [editAreaColor, setEditAreaColor] = useState('#f72585');
    const [editPopupPosition, setEditPopupPosition] = useState({ x: 0, y: 0 });
    const [editNeighbors, setEditNeighbors] = useState(10);
    const [editNPcas, setEditNPcas] = useState(30);
    const [editResolutions, setEditResolutions] = useState(1);

    // After the popup renders, clamp it to the viewport using its real DOM size.
    // This avoids bottom overflow when the content is taller than the estimated height.
    useEffect(() => {
        if (!isAreaEditPopupVisible) return;
        const el = areaEditPopupRef.current;
        if (!el) return;

        const margin = 10;
        let rafId = requestAnimationFrame(() => {
            const popupRect = el.getBoundingClientRect();
            let nextLeft = editPopupPosition.x;
            let nextTop = editPopupPosition.y;

            // Horizontal clamp
            if (popupRect.right > window.innerWidth - margin) {
                nextLeft -= popupRect.right - (window.innerWidth - margin);
            }
            if (popupRect.left < margin) {
                nextLeft += margin - popupRect.left;
            }

            // Vertical clamp
            if (popupRect.bottom > window.innerHeight - margin) {
                nextTop -= popupRect.bottom - (window.innerHeight - margin);
            }
            if (popupRect.top < margin) {
                nextTop += margin - popupRect.top;
            }

            // Avoid tiny update loops
            if (Math.abs(nextLeft - editPopupPosition.x) >= 0.5 || Math.abs(nextTop - editPopupPosition.y) >= 0.5) {
                setEditPopupPosition({ x: nextLeft, y: nextTop });
            }
        });

        return () => {
            cancelAnimationFrame(rafId);
        };
    }, [isAreaEditPopupVisible, editPopupPosition.x, editPopupPosition.y]);

    // Trajectory drawing state
    const [isTrajectoryMode, setIsTrajectoryMode] = useState(false);
    const [trajectoryPoints, setTrajectoryPoints] = useState([]);
    const [trajectoryStart, setTrajectoryStart] = useState(null);
    const [trajectoryEnd, setTrajectoryEnd] = useState(null);
    const [arrowWidth, setArrowWidth] = useState(15);
    const [trajectoryClickCount, setTrajectoryClickCount] = useState(0);
    const [arrowCoverageArea, setArrowCoverageArea] = useState(null);
    const [maxArrowWidth, setMaxArrowWidth] = useState(50);
    const [trajectoryName, setTrajectoryName] = useState('');
    const [hoveredTrajectory, setHoveredTrajectory] = useState(null); // Track hovered trajectory for coverage display

    // Minimap state
    const [minimapVisible, setMinimapVisible] = useState(true);
    const [minimapAnimating, setMinimapAnimating] = useState(false);
    const minimapRef = useRef(null);

    // High-definition magnifying glass state
    const [magnifierVisible, setMagnifierVisible] = useState(false);
    const [magnifierData, setMagnifierData] = useState(null);
    const [magnifierViewport, setMagnifierViewport] = useState({ x: 0.5, y: 0.5, size: 200 });
    const [magnifierMousePos, setMagnifierMousePos] = useState({ x: 0, y: 0 });
    const [keyPressed, setKeyPressed] = useState(false);

    const magnifierRef = useRef(null);
    const magnifierCanvasRef = useRef(null);

    // Track previous image URL to only reset loading state when it truly changes
    const prevMagnifierUrlRef = useRef(null);
    // Track if current magnifier image has finished loading
    const [magnifierImageLoaded, setMagnifierImageLoaded] = useState(false);
    const [magnifierImageVersion, setMagnifierImageVersion] = useState(0);

    // Add state for preloaded high-res images
    const [hiresImages, setHiresImages] = useState({}); // { sampleId: imageUrl }
    const hiresImagesRef = useRef({});
    const [decodedHiresImages, setDecodedHiresImages] = useState({}); // { sampleId: true/false }
    const preloadedImageRefs = useRef({}); // Cache actual Image objects for instant display
    const stableLayerImageBySampleRef = useRef({}); // Keep last valid layer image source per sample
    const [minimapThumbnails, setMinimapThumbnails] = useState({}); // { sampleId: dataUrl }
    const minimapThumbnailJobsRef = useRef(new Set());

    const radioOptions = [
        {
            label: 'Cell Type',
            value: 'cellTypes',
        },
        {
            label: 'Genes',
            value: 'genes',
        },
    ];

    // Main view
    const mainView = useMemo(() => new OrthographicView({
        id: 'main',
        controller: true
    }), []);

    // Stable controller instance to avoid re-initialization flashes
    const deckController = useMemo(() => {
        if (isAreaTooltipVisible) return false;
        if (isAreaEditPopupVisible && !isTrajectoryMode) return false;
        if (!isDrawing && !isTrajectoryMode) {
            // Use DeckGL defaults to avoid controller re-inits that may cause flashes
            return true;
        }
        return {
            dragPan: false,
            dragRotate: false,
            doubleClickZoom: false,
            scrollZoom: true
        };
    }, [isAreaTooltipVisible, isAreaEditPopupVisible, isDrawing, isTrajectoryMode]);

    // Calculate sample offsets based on image sizes
    const sampleOffsets = useMemo(() => {
        if (selectedSamples.length <= 1) return {};

        const offsets = {};
        let currentX = 0;

        selectedSamples.forEach((sample) => {
            offsets[sample.id] = [currentX, 0];
            if (imageSizes[sample.id]) {
                currentX += imageSizes[sample.id][0] + 500; // 500px gap between samples
            }
        });

        return offsets;
    }, [selectedSamples, imageSizes]);

    // Filter cell data for scatter plots
    const filteredCellData = useMemo(() => {
        return selectedSamples.reduce((acc, sample) => {
            const cellData = coordinatesData && coordinatesData[sample.id] ? coordinatesData[sample.id] : [];
            const offset = sampleOffsets && sampleOffsets[sample.id] ? sampleOffsets[sample.id] : [0, 0];

            acc[sample.id] = cellData.map(cell => ({
                ...cell,
                x: cell.cell_x + offset[0],
                y: cell.cell_y + offset[1]
            }));

            return acc;
        }, {});
    }, [selectedSamples, coordinatesData, sampleOffsets]);

    // Precompute single-gene world-coordinates once per data/offset change.
    // Critical for performance: during pan/zoom we should avoid rebuilding large arrays,
    // and we should not draw fully transparent (expression=0) points.
    const singleGeneWorldDataBySample = useMemo(() => {
        const all = {};
        const nonZero = {};

        selectedSamples.forEach(sample => {
            const sampleId = sample.id;
            const singleGeneData = singleGeneDataBySample[sampleId];
            const cells = singleGeneData?.cells;
            if (!Array.isArray(cells) || cells.length === 0) return;

            const offset = sampleOffsets[sampleId] || [0, 0];

            const allCells = new Array(cells.length);
            const nonZeroCells = [];

            for (let i = 0; i < cells.length; i++) {
                const cell = cells[i] || {};
                const expression = Number(cell.expression) || 0;
                const entry = {
                    ...cell,
                    expression,
                    x: (cell.cell_x || 0) + offset[0],
                    y: (cell.cell_y || 0) + offset[1]
                };
                allCells[i] = entry;
                if (expression > 0) nonZeroCells.push(entry);
            }

            all[sampleId] = allCells;
            nonZero[sampleId] = nonZeroCells;
        });

        return { all, nonZero };
    }, [selectedSamples, singleGeneDataBySample, sampleOffsets]);

    // On Retina displays, rendering dense single-gene layers at devicePixelRatio=2 can be a bottleneck.
    // Drop DPR to 1 only when single-gene mode is active and point count is large.
    const deckUseDevicePixels = useMemo(() => {
        let total = 0;
        for (const sample of selectedSamples) {
            const sampleId = sample.id;
            if (radioCellGeneModes?.[sampleId] !== 'genes') continue;
            total += (singleGeneWorldDataBySample.nonZero[sampleId]?.length || 0);
        }
        return total > 40000 ? 1 : true;
    }, [selectedSamples, radioCellGeneModes, singleGeneWorldDataBySample]);

    // Function to load Kosara data for a specific sample
    const loadKosaraDataForSample = async (sampleId, genes) => {
        if (!genes || genes.length === 0) return;

        // Check if this sample is already loading to prevent duplicate requests
        if (kosaraLoadingSamples[sampleId]) {
            return;
        }

        try {
            setIsKosaraLoading(true);
            setKosaraLoadingSamples(prev => ({ ...prev, [sampleId]: true }));

            const response = await fetch('/api/get_kosara_data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sample_ids: [sampleId],
                    gene_list: genes
                })
            });

            if (!response.ok) {
                console.error('Failed to fetch Kosara data:', response.status, response.statusText);
                return;
            }

            const data = await response.json();
            if (data && data[sampleId]) {
                setKosaraDataBySample(prev => ({
                    ...prev,
                    [sampleId]: Array.isArray(data[sampleId]) ? data[sampleId] : []
                }));

                // Set the sample to gene mode
                setRadioCellGeneModes(prev => ({ ...prev, [sampleId]: 'genes' }));
            }
        } catch (err) {
            console.error('Error fetching Kosara data:', err);
        } finally {
            setKosaraLoadingSamples(prev => {
                const next = { ...prev };
                delete next[sampleId];
                if (Object.keys(next).length === 0) {
                    setIsKosaraLoading(false);
                }
                return next;
            });
        }
    };

    // Function to load single gene expression data for sequential coloring
    const loadSingleGeneDataForSample = async (sampleId, geneName) => {
        if (!geneName) return;

        try {
            setIsKosaraLoading(true);
            setKosaraLoadingSamples(prev => ({ ...prev, [sampleId]: true }));

            const response = await fetch('/api/get_single_gene_expression', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sample_ids: [sampleId],
                    gene_name: geneName
                })
            });

            if (!response.ok) {
                console.error('Failed to fetch single gene expression data:', response.status, response.statusText);
                return;
            }

            const data = await response.json();
            if (data && data[sampleId]) {
                setSingleGeneDataBySample(prev => ({
                    ...prev,
                    [sampleId]: {
                        ...data[sampleId],
                        geneName: geneName  // Store which gene this data is for
                    }
                }));

                // Set the sample to gene mode
                setRadioCellGeneModes(prev => ({ ...prev, [sampleId]: 'genes' }));
            }
        } catch (err) {
            console.error('Error fetching single gene expression data:', err);
        } finally {
            setKosaraLoadingSamples(prev => {
                const next = { ...prev };
                delete next[sampleId];
                if (Object.keys(next).length === 0) {
                    setIsKosaraLoading(false);
                }
                return next;
            });
        }
    };

    // Change cell/gene mode for a sample
    const changeCellGeneMode = (sampleId, e) => {
        const newMode = e.target.value;

        // Update previous modes when manually changing mode
        setPreviousModes(prev => ({ ...prev, [sampleId]: radioCellGeneModes[sampleId] }));

        // If switching TO genes with existing kosara data, show spinner first, then defer the expensive mode switch
        if (newMode === 'genes' && kosaraDataBySample[sampleId]?.length) {
            // Start spinner immediately so it can paint before heavy polygon generation
            setIsKosaraLoading(true);
            // Provide a short fallback auto-hide ONLY if no real fetch starts (no sample in kosaraLoadingSamples)
            if (spinnerFallbackTimeoutRef.current) clearTimeout(spinnerFallbackTimeoutRef.current);
            spinnerFallbackTimeoutRef.current = setTimeout(() => {
                if (Object.keys(kosaraLoadingSamplesRef.current).length === 0) {
                    setIsKosaraLoading(false);
                }
            }, 400);
            // Defer the mode change to next animation frame (after spinner paints)
            const schedule = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (fn) => setTimeout(fn, 0);
            schedule(() => {
                setRadioCellGeneModes(prev => ({ ...prev, [sampleId]: newMode }));
            });
        } else {
            // Normal immediate mode change (cellTypes or genes without cached data)
            setRadioCellGeneModes(prev => ({ ...prev, [sampleId]: newMode }));
        }
    };

    // Receive data from GeneList and store & switch to gene mode
    const handleKosaraData = useCallback((sampleId, dataArray, dataType = 'kosara', geneName = null) => {
        if (dataType === 'single_gene') {
            // Handle single gene expression data
            setSingleGeneDataBySample(prev => ({
                ...prev,
                [sampleId]: {
                    ...dataArray,
                    geneName: geneName  // Store which gene this data is for
                }
            }));
            // Clear kosara data for this sample since we're using single gene mode
            setKosaraDataBySample(prev => {
                const updated = { ...prev };
                delete updated[sampleId];
                return updated;
            });
        } else {
            // Handle kosara data
            setKosaraDataBySample(prev => ({
                ...prev,
                [sampleId]: Array.isArray(dataArray) ? dataArray : []
            }));
            // Clear single gene data for this sample since we're using kosara mode
            setSingleGeneDataBySample(prev => {
                const updated = { ...prev };
                delete updated[sampleId];
                return updated;
            });
        }

        setRadioCellGeneModes(prev => ({ ...prev, [sampleId]: 'genes' }));
        // Mark this sample's request complete
        setKosaraLoadingSamples(prev => {
            const next = { ...prev };
            delete next[sampleId];
            // If no more in-flight requests, stop spinner
            if (Object.keys(next).length === 0) {
                setIsKosaraLoading(false);
            }
            return next;
        });
    }, []);

    // Start loading when confirm button is clicked (before fetching data)
    const handleKosaraLoadingStart = useCallback((sampleId) => {
        // Clear any fallback hide for cached-mode switches
        if (spinnerFallbackTimeoutRef.current) clearTimeout(spinnerFallbackTimeoutRef.current);
        setKosaraLoadingSamples(prev => ({ ...prev, [sampleId]: true }));
        setIsKosaraLoading(true);
    }, []);

    // Reset view to initial position and zoom
    const resetView = () => {
        if (!selectedSamples.length || !imageSizes[selectedSamples[0]?.id]) return;

        const firstSample = selectedSamples[0];
        const offset = sampleOffsets[firstSample.id] ?? [0, 0];
        const size = imageSizes[firstSample.id] ?? [0, 0];

        setMainViewState({
            target: [
                offset[0] + size[0] / 2,
                offset[1] + size[1] / 2,
                0
            ],
            zoom: -3,
            maxZoom: 2.5,
            minZoom: -5
        });
    };

    // Kosara path generation utilities
    const generateCirclePoints = useCallback((cx, cy, r, steps = 50) => {
        const points = [];
        const angleStep = (2 * Math.PI) / steps;
        for (let i = 0; i < steps; i++) {
            const theta = i * angleStep;
            points.push([cx + r * Math.cos(theta), cy + r * Math.sin(theta)]);
        }
        points.push(points[0]);
        return points;
    }, []);

    const generateSingleArcPoints = useCallback((startX, startY, endX, endY, r, largeArcFlag, sweepFlag) => {
        const dx = endX - startX;
        const dy = endY - startY;
        const d = Math.hypot(dx, dy);
        if (d > 2 * r) {
            return [];
        }

        const midX = (startX + endX) / 2;
        const midY = (startY + endY) / 2;
        const h = Math.sqrt(r * r - (d / 2) * (d / 2));

        const ux = -dy / d;
        const uy = dx / d;

        const cx1 = midX + h * ux;
        const cy1 = midY + h * uy;
        const cx2 = midX - h * ux;
        const cy2 = midY - h * uy;

        const computeAngles = (cx, cy) => {
            const startAngle = Math.atan2(startY - cy, startX - cx);
            const endAngle = Math.atan2(endY - cy, endX - cx);
            let delta = endAngle - startAngle;
            delta = ((delta % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
            return { startAngle, endAngle, delta };
        };

        const cand1 = computeAngles(cx1, cy1);
        const cand2 = computeAngles(cx2, cy2);

        const effectiveDelta = candidate => (sweepFlag === 1 ? candidate.delta : (2 * Math.PI - candidate.delta));
        const eff1 = effectiveDelta(cand1);
        const eff2 = effectiveDelta(cand2);

        let chosen, cx, cy;
        if (largeArcFlag === 0) {
            if (eff1 <= Math.PI && eff2 > Math.PI) {
                chosen = cand1; cx = cx1; cy = cy1;
            } else if (eff2 <= Math.PI && eff1 > Math.PI) {
                chosen = cand2; cx = cx2; cy = cy2;
            } else {
                chosen = cand1; cx = cx1; cy = cy1;
            }
        } else {
            if (eff1 >= Math.PI && eff2 < Math.PI) {
                chosen = cand1; cx = cx1; cy = cy1;
            } else if (eff2 >= Math.PI && eff1 < Math.PI) {
                chosen = cand2; cx = cx2; cy = cy2;
            } else {
                chosen = cand1; cx = cx1; cy = cy1;
            }
        }

        const deltaEffective = sweepFlag === 1 ? effectiveDelta(chosen) : -effectiveDelta(chosen);

        const steps = 20;
        const points = [];
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const theta = chosen.startAngle + t * deltaEffective;
            const x = cx + r * Math.cos(theta);
            const y = cy + r * Math.sin(theta);
            points.push([x, y]);
        }
        return points;
    }, []);

    const generateComplexArcPoints = useCallback((startX, startY, endX, endY, outerRadius, innerRadius, outerFlags = { large: 0, sweep: 1 }, innerFlags = { large: 0, sweep: 0 }) => {
        const outerArc = generateSingleArcPoints(startX, startY, endX, endY, outerRadius, outerFlags.large, outerFlags.sweep);
        const innerArc = generateSingleArcPoints(endX, endY, startX, startY, innerRadius, innerFlags.large, innerFlags.sweep);
        return [...outerArc, ...innerArc];
    }, [generateSingleArcPoints]);

    const generateKosaraPath = useCallback((pointX, pointY, angles, ratios, cal_radius) => {
        const baseRadius = 5;
        const paths = [];
        const cellTypes = selectedGenes;

        let startpointX, startpointY, endpointX, endpointY;
        let lastStartPointX, lastStartPointY, lastEndPointX, lastEndPointY, lastCircleRadius = 0;
        const originalPointX = pointX - baseRadius * Math.cos(45 * Math.PI / 180);
        const originalPointY = pointY + baseRadius * Math.sin(45 * Math.PI / 180);

        const cellIndices = ratios
            .filter(item => item[1] !== 0 && cellTypes.includes(item[0]))
            .sort((a, b) => cellTypes.indexOf(a[0]) - cellTypes.indexOf(b[0]))
            .slice(0, 9)
            .map(item => item[0]);

        // we no longer compute colors here; defer to layer accessor using gene ids
        let cellAngles = cellIndices.map(index => angles.find(item => item[0] === index));
        let cellRadius = cellIndices.map(index => cal_radius.find(item => item[0] === index));

        const ratioSum = ratios.reduce((acc, item) => acc + item[1], 0);

        if (cellAngles.length === 0) {
            const circlePoints = generateCirclePoints(pointX, pointY, baseRadius, 50);
            paths.push({ path: circlePoints, color: '#FFFFFF' });
        } else {
            cellAngles = cellAngles.map(angle => [angle[0], angle[1]]);
            cellRadius = cellRadius.map(rad => [rad[0], rad[1]]);

            cellAngles.forEach((angle, index) => {
                const cal_cell_radius = cellRadius[index][1];
                let points = [];

                startpointX = originalPointX + Math.abs(cal_cell_radius * Math.cos((angle[1] + 45) * Math.PI / 180));
                startpointY = originalPointY - Math.abs(cal_cell_radius * Math.sin((angle[1] + 45) * Math.PI / 180));
                endpointX = originalPointX + Math.abs(cal_cell_radius * Math.cos((angle[1] - 45) * Math.PI / 180));
                endpointY = originalPointY - Math.abs(cal_cell_radius * Math.sin((angle[1] - 45) * Math.PI / 180));

                if (index === 0) {
                    const isLargeArcInner = cal_cell_radius > Math.sqrt(3) * baseRadius;
                    points = generateComplexArcPoints(
                        startpointX,
                        startpointY,
                        endpointX,
                        endpointY,
                        cal_cell_radius,
                        baseRadius,
                        { large: 0, sweep: 1 },
                        { large: isLargeArcInner ? 1 : 0, sweep: 1 }
                    );
                } else if (index === cellAngles.length - 1 && ratioSum === 1) {
                    const isLargeArcInner = lastCircleRadius <= Math.sqrt(3) * baseRadius;
                    points = generateComplexArcPoints(
                        lastStartPointX,
                        lastStartPointY,
                        lastEndPointX,
                        lastEndPointY,
                        lastCircleRadius,
                        baseRadius,
                        { large: 0, sweep: 1 },
                        { large: isLargeArcInner ? 1 : 0, sweep: 0 }
                    );
                } else {
                    const pointsSegment1 = generateSingleArcPoints(
                        lastStartPointX, lastStartPointY,
                        lastEndPointX, lastEndPointY,
                        lastCircleRadius,
                        0,
                        1
                    );

                    const pointsSegment2 = generateSingleArcPoints(
                        lastEndPointX, lastEndPointY,
                        endpointX, endpointY,
                        baseRadius,
                        0,
                        0
                    );

                    const pointsSegment3 = generateSingleArcPoints(
                        endpointX, endpointY,
                        startpointX, startpointY,
                        cal_cell_radius,
                        0,
                        0
                    );

                    const pointsSegment4 = generateSingleArcPoints(
                        startpointX, startpointY,
                        lastStartPointX, lastStartPointY,
                        baseRadius,
                        0,
                        0
                    );
                    points = [...pointsSegment1, ...pointsSegment2, ...pointsSegment3, ...pointsSegment4];
                }

                paths.push({
                    path: points,
                    gene: cellIndices[index]
                });

                lastCircleRadius = cal_cell_radius;
                lastStartPointX = startpointX;
                lastStartPointY = startpointY;
                lastEndPointX = endpointX;
                lastEndPointY = endpointY;
            });

            if (ratioSum < 1) {
                const isLargeArcInner = lastCircleRadius <= Math.sqrt(3) * baseRadius;
                const points = generateComplexArcPoints(
                    lastStartPointX,
                    lastStartPointY,
                    lastEndPointX,
                    lastEndPointY,
                    lastCircleRadius,
                    baseRadius,
                    { large: 0, sweep: 1 },
                    { large: isLargeArcInner ? 1 : 0, sweep: 0 }
                );
                paths.push({ path: points, color: '#333333' });
            }
        }
        return paths;
    }, [generateCirclePoints, generateComplexArcPoints, generateSingleArcPoints, selectedGenes]);

    // Find the rightmost point of a polygon for tooltip positioning
    const findRightmostPoint = (points) => {
        if (points.length === 0) return { x: 0, y: 0 };

        const rightmost = points.reduce((max, point) => {
            return point[0] > max[0] ? point : max;
        }, points[0]);

        return {
            x: rightmost[0],
            y: rightmost[1]
        };
    };

    // Find the vertical center of a polygon for tooltip positioning
    const findVerticalCenter = (points) => {
        if (points.length === 0) return { x: 0, y: 0 };

        const yCoordinates = points.map(point => point[1]);
        const minY = Math.min(...yCoordinates);
        const maxY = Math.max(...yCoordinates);
        const centerY = (minY + maxY) / 2;

        return {
            x: 0,
            y: centerY
        };
    };

    // Convert world coordinates to screen coordinates for tooltip positioning
    const worldToScreen = (worldX, worldY) => {
        if (!mainViewState || !containerRef.current) return { x: 0, y: 0 };

        const container = containerRef.current;
        const rect = container.getBoundingClientRect();

        // Get the center of the view
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;

        // Calculate the scale based on zoom
        const scale = Math.pow(2, mainViewState.zoom);

        // Transform world coordinates to screen coordinates
        const screenX = centerX + (worldX - mainViewState.target[0]) * scale;
        const screenY = centerY + (worldY - mainViewState.target[1]) * scale; // Removed inversion

        return { x: screenX, y: screenY };
    };

    // Precompute minimap layout once per sample/image change.
    const minimapLayout = useMemo(() => {
        if (!selectedSamples.length) return null;

        let totalLeft = Infinity;
        let totalRight = -Infinity;
        let totalTop = Infinity;
        let totalBottom = -Infinity;

        selectedSamples.forEach(sample => {
            const imageSize = imageSizes[sample.id];
            const offset = sampleOffsets[sample.id] || [0, 0];
            if (imageSize) {
                totalLeft = Math.min(totalLeft, offset[0]);
                totalRight = Math.max(totalRight, offset[0] + imageSize[0]);
                totalTop = Math.min(totalTop, offset[1]);
                totalBottom = Math.max(totalBottom, offset[1] + imageSize[1]);
            }
        });

        if (totalLeft === Infinity) return null;

        const totalWidth = Math.max(1, totalRight - totalLeft);
        const totalHeight = Math.max(1, totalBottom - totalTop);

        const tiles = selectedSamples.map((sample) => {
            const imageSize = imageSizes[sample.id];
            const offset = sampleOffsets[sample.id] || [0, 0];
            if (!imageSize) return null;

            return {
                sample,
                sampleId: sample.id,
                sampleName: sample.name || sample.id,
                imageUrl: minimapThumbnails[sample.id] || null,
                relativeLeft: (offset[0] - totalLeft) / totalWidth,
                relativeTop: (offset[1] - totalTop) / totalHeight,
                relativeWidth: imageSize[0] / totalWidth,
                relativeHeight: imageSize[1] / totalHeight,
            };
        }).filter(Boolean);

        return {
            totalLeft,
            totalTop,
            totalWidth,
            totalHeight,
            tiles,
        };
    }, [selectedSamples, imageSizes, sampleOffsets, minimapThumbnails]);

    // Calculate minimap viewport bounds based on current view state
    const getMinimapViewportBounds = useCallback(() => {
        if (!mainViewState || !containerSize.width || !minimapLayout) return null;

        // Calculate the world bounds of the current viewport
        const scale = Math.pow(2, mainViewState.zoom);
        const halfWidth = containerSize.width / (2 * scale);
        const halfHeight = containerSize.height / (2 * scale);

        const viewportBounds = {
            left: mainViewState.target[0] - halfWidth,
            right: mainViewState.target[0] + halfWidth,
            top: mainViewState.target[1] - halfHeight,
            bottom: mainViewState.target[1] + halfHeight
        };

        const { totalLeft, totalTop, totalWidth, totalHeight } = minimapLayout;

        // Convert to relative coordinates within the total combined area
        const relativeBounds = {
            left: Math.max(0, (viewportBounds.left - totalLeft) / totalWidth),
            right: Math.min(1, (viewportBounds.right - totalLeft) / totalWidth),
            top: Math.max(0, (viewportBounds.top - totalTop) / totalHeight),
            bottom: Math.min(1, (viewportBounds.bottom - totalTop) / totalHeight)
        };

        return relativeBounds;
    }, [mainViewState, containerSize, minimapLayout]);

    // Function to detect which sample was clicked in the minimap
    const getSampleFromMinimapClick = useCallback((clickX, clickY) => {
        if (!minimapLayout) return null;

        // Check which sample contains the click coordinates
        for (const tile of minimapLayout.tiles) {
            const { relativeLeft, relativeTop, relativeWidth, relativeHeight } = tile;

            // Check if click is within this sample's bounds
            if (clickX >= relativeLeft && clickX <= relativeLeft + relativeWidth &&
                clickY >= relativeTop && clickY <= relativeTop + relativeHeight) {
                return tile.sample;
            }
        }

        return null;
    }, [minimapLayout]);

    // Handle minimap click to navigate
    const handleMinimapClick = useCallback((event) => {
        if (!minimapRef.current || !minimapLayout) return;

        const rect = minimapRef.current.getBoundingClientRect();
        const x = (event.clientX - rect.left) / rect.width;
        const y = (event.clientY - rect.top) / rect.height;

        // First, check if we clicked on a specific sample
        const clickedSample = getSampleFromMinimapClick(x, y);

        if (clickedSample) {
            // Center the view on the clicked sample
            const imageSize = imageSizes[clickedSample.id];
            const offset = sampleOffsets[clickedSample.id] || [0, 0];

            if (imageSize) {
                const centerX = offset[0] + imageSize[0] / 2;
                const centerY = offset[1] + imageSize[1] / 2;

                setMainViewState(prev => ({
                    ...prev,
                    target: [centerX, centerY, 0]
                }));
                return;
            }
        }

        // Fallback to original behavior: pan to clicked position
        const { totalLeft, totalTop, totalWidth, totalHeight } = minimapLayout;

        // Convert relative coordinates to world coordinates
        const worldX = totalLeft + x * totalWidth;
        const worldY = totalTop + y * totalHeight;

        // Update main view to center on clicked position
        setMainViewState(prev => ({
            ...prev,
            target: [worldX, worldY, 0]
        }));
    }, [minimapLayout, getSampleFromMinimapClick, imageSizes, sampleOffsets]);

    const minimapTilesContent = useMemo(() => {
        if (!minimapLayout) return null;

        return minimapLayout.tiles.map(tile => (
            <div
                key={tile.sampleId}
                style={{
                    position: 'absolute',
                    left: `${tile.relativeLeft * 100}%`,
                    top: `${tile.relativeTop * 100}%`,
                    width: `${tile.relativeWidth * 100}%`,
                    height: `${tile.relativeHeight * 100}%`,
                    cursor: 'pointer',
                    border: '1px solid rgba(24, 144, 255, 0.3)',
                    borderRadius: '2px',
                    overflow: 'hidden',
                    boxSizing: 'border-box'
                }}
                title={`Click to center on ${tile.sampleName}`}
            >
                {tile.imageUrl ? (
                    <img
                        src={tile.imageUrl}
                        alt={`Minimap ${tile.sampleName}`}
                        style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover',
                            display: 'block',
                            pointerEvents: 'none'
                        }}
                        draggable={false}
                        loading="lazy"
                        decoding="async"
                    />
                ) : (
                    <div style={{ width: '100%', height: '100%', backgroundColor: '#d9d9d9' }} />
                )}
                <div
                    style={{
                        position: 'absolute',
                        bottom: '2px',
                        left: '2px',
                        right: '2px',
                        fontSize: '8px',
                        fontWeight: 'bold',
                        color: 'white',
                        backgroundColor: 'rgba(0, 0, 0, 0.7)',
                        padding: '1px 3px',
                        borderRadius: '2px',
                        textAlign: 'center',
                        textShadow: '1px 1px 1px rgba(0, 0, 0, 0.8)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        pointerEvents: 'none'
                    }}
                >
                    {tile.sampleName}
                </div>
            </div>
        ));
    }, [minimapLayout]);

    // Toggle minimap with fade animation
    const toggleMinimapVisible = useCallback(() => {
        if (minimapVisible) {
            setMinimapVisible(false);
            setMinimapAnimating(true);

            // Stop animating
            setTimeout(() => {
                setMinimapAnimating(false);
            }, 300);
        } else {
            setMinimapAnimating(true);

            setTimeout(() => {
                setMinimapVisible(true);
            }, 10);

            // Reset animating state after transition completes
            setTimeout(() => {
                setMinimapAnimating(false);
            }, 310);
        }
    }, [minimapVisible]);

    // Update magnifier viewport based on mouse position
    const updateMagnifierViewport = useCallback((worldX, worldY, sampleId) => {
        if (!sampleId) return;

        const offset = sampleOffsets[sampleId] || [0, 0];
        const imageSize = imageSizes[sampleId];

        if (!imageSize) return;

        // Convert world coordinates to image coordinates
        const imageX = worldX - offset[0];
        const imageY = worldY - offset[1];

        // Calculate viewport position (as percentage of image)
        const viewportX = imageX / imageSize[0];
        const viewportY = imageY / imageSize[1];

        const clampedViewport = {
            x: Math.max(0, Math.min(1, viewportX)),
            y: Math.max(0, Math.min(1, viewportY)),
            size: 200 // Fixed viewport size in magnifier pixels
        };

        // Only update if values actually changed to avoid render → hover → setState loops
        setMagnifierViewport(prev => {
            if (
                prev &&
                Math.abs(prev.x - clampedViewport.x) < 1e-4 &&
                Math.abs(prev.y - clampedViewport.y) < 1e-4 &&
                prev.size === clampedViewport.size
            ) {
                return prev;
            }
            return clampedViewport;
        });

        setMagnifierMousePos(prev => {
            if (prev && prev.x === worldX && prev.y === worldY) return prev;
            return { x: worldX, y: worldY };
        });
    }, [sampleOffsets, imageSizes]);

    // Toggle drawing mode
    const toggleDrawingMode = () => {
        if (isDrawing) {
            // If currently drawing, finish or cancel
            if (drawingPoints.length >= 3) {
                finishDrawing();
            } else {
                cancelDrawing();
            }
        } else {
            // Start drawing mode - sample will be determined on first click
            setIsDrawing(true);
            setCurrentDrawingSample(null);
            setDrawingPoints([]);

            currentDrawingSampleRef.current = null;
            drawingPointsRef.current = [];
        }
    };

    const finishDrawing = () => {
        const points = (drawingPointsRef.current && Array.isArray(drawingPointsRef.current)) ? drawingPointsRef.current : drawingPoints;
        const sampleId = currentDrawingSampleRef.current ?? currentDrawingSample;

        if (points.length >= 3 && sampleId) {
            // Create ROI name for unique ID
            const roiName = `Custom Area ${customAreas.length + 1}`;

            // Create pending area and show tooltip for customization
            const newPendingArea = {
                id: `${roiName.replace(/\s+/g, '_')}_${sampleId}`,
                sampleId,
                points: [...points],
                name: roiName,
                color: '#f72585'
            };

            // Find the rightmost point of the drawn area for tooltip positioning
            const rightmostPoint = findRightmostPoint(points);
            // Find the vertical center of the drawn area
            const verticalCenter = findVerticalCenter(points);

            setPendingArea(newPendingArea);
            setAreaName(newPendingArea.name);
            setAreaColor(newPendingArea.color);

            // Use rightmost x-coordinate but vertical center for y-coordinate
            setTooltipPosition({ x: rightmostPoint.x, y: verticalCenter.y });
            setIsAreaTooltipVisible(true);
        } else {
            setIsDrawing(false);
            setDrawingPoints([]);
            setCurrentDrawingSample(null);

            drawingPointsRef.current = [];
            currentDrawingSampleRef.current = null;
        }
    };

    useEffect(() => {
        finishDrawingRef.current = finishDrawing;
    }, [finishDrawing]);

    const cancelDrawing = () => {
        setIsDrawing(false);
        setDrawingPoints([]);
        setCurrentDrawingSample(null);

        drawingPointsRef.current = [];
        currentDrawingSampleRef.current = null;
    };

    // Handle area tooltip actions
    const handleAreaTooltipSave = () => {
        if (pendingArea) {
            const finalAreaName = areaName || pendingArea.name;
            const finalArea = {
                ...pendingArea,
                id: `${finalAreaName.replace(/\s+/g, '_')}_${pendingArea.sampleId}`,
                name: finalAreaName,
                color: areaColor
            };
            setCustomAreas(prev => [...prev, finalArea]);
            
            // Store the region in the backend so it appears in the TrajectoryViewer
            const storeRegionData = {
                sampleId: finalArea.sampleId,
                regionName: finalArea.name
            };
            
            fetch('/api/store_region', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(storeRegionData)
            })
            .then(response => response.json())
            .then(result => {
                if (result.status === 'success') {
                    // Notify parent component that an area has been saved
                    if (onAreaSaved) {
                        onAreaSaved(finalArea.sampleId, finalArea.name);
                    }
                } else {
                    console.error('Failed to store region:', result.message);
                }
            })
            .catch(error => {
                console.error('Error storing region:', error);
            });
        }

        setIsAreaTooltipVisible(false);
        setPendingArea(null);
        setAreaName('');
        setAreaColor('#f72585');
        setIsDrawing(false);
        setDrawingPoints([]);
        setCurrentDrawingSample(null);
        setMousePosition(null);
    };

    // Clear all drawing and tooltip state without saving
    const handleAreaTooltipCancel = () => {
        setIsAreaTooltipVisible(false);
        setPendingArea(null);
        setAreaName('');
        setAreaColor('#f72585');
        setIsDrawing(false);
        setDrawingPoints([]);
        setCurrentDrawingSample(null);
        setMousePosition(null);
    };

    // Calculate tooltip position with real-time updates based on current view state
    const getTempAreaCompleteTooltipPosition = useCallback(() => {
        if (!isAreaTooltipVisible || !pendingArea || !containerRef.current || !mainViewState) {
            return { left: 0, top: 0 };
        }

        // Recalculate screen position based on current view state
        const screenPos = worldToScreen(tooltipPosition.x, tooltipPosition.y);
        const container = containerRef.current;
        const rect = container.getBoundingClientRect();

        const tooltipWidth = 280;
        const tooltipHeight = 180;

        // 20px to the right of the rightmost point
        const left = rect.left + screenPos.x + 20;
        let top = rect.top + screenPos.y - tooltipHeight / 2;

        // Only constrain the top position to stay within the viewport bounds
        if (top < 10) {
            top = 10;
        }

        if (top + tooltipHeight > window.innerHeight - 10) {
            // Force to bottom edge of viewport
            top = window.innerHeight - tooltipHeight - 10;
        }

        return { left, top };
    }, [isAreaTooltipVisible, pendingArea, tooltipPosition, mainViewState]);

    // Undo last point
    const undoLastPoint = () => {
        if (drawingPoints.length > 0) {
            setDrawingPoints(prev => prev.slice(0, -1));
        }
    };

    const handleKeyPress = useCallback((event) => {
        if (!isDrawing) return;

        if (event.key === 'Enter') {
            finishDrawing();
        } else if (event.key === 'Escape') {
            cancelDrawing();
        } else if (event.key === 'Backspace' || event.key === 'Delete') {
            event.preventDefault();
            undoLastPoint();
        }
    }, [isDrawing, drawingPoints, currentDrawingSample]);

    // Check if point should snap to first point (auto-close)
    const shouldSnapToFirst = useCallback((currentPoint) => {
        if (drawingPoints.length < 3 || !mainViewState) return false;

        const firstPoint = drawingPoints[0];

        // Calculate distance in world coordinates
        const worldDistance = Math.sqrt(
            Math.pow(currentPoint[0] - firstPoint[0], 2) +
            Math.pow(currentPoint[1] - firstPoint[1], 2)
        );

        // Dynamic snap distance based on zoom level
        // At zoom 0, snap distance is ~50 world units
        // At zoom -3, snap distance is ~400 world units
        // At zoom 2, snap distance is ~6 world units
        const baseSnapDistance = 50;
        const zoomFactor = Math.pow(2, -mainViewState.zoom);
        const dynamicSnapDistance = baseSnapDistance * zoomFactor;

        return worldDistance < dynamicSnapDistance;
    }, [drawingPoints, mainViewState]);

    // Handle area click for editing
    const handleAreaClick = useCallback((info) => {
        if (isDrawing || isAreaTooltipVisible || isTrajectoryMode) return;

        // Find which area was clicked.
        // If the click hits a spot/cell point layer inside an ROI polygon, still open the ROI popup.
        const layerId = info.layer?.id;
        let targetArea = null;

        // Case 1: Direct hit on ROI polygon layer
        if (layerId && layerId.startsWith('custom-area-')) {
            const areaId = layerId.replace('custom-area-', '');
            targetArea = customAreas.find(a => a.id === areaId) || null;
        }

        // Case 2: Clicked something else (e.g., a cell point) — fall back to point-in-polygon
        if (!targetArea && info?.coordinate && Array.isArray(info.coordinate)) {
            const [x, y] = info.coordinate;
            for (let i = customAreas.length - 1; i >= 0; i--) {
                const area = customAreas[i];
                if (area?.points?.length >= 3 && isPointInAreaPolygon([x, y], area.points)) {
                    targetArea = area;
                    break;
                }
            }
        }

        if (!targetArea) return;

        setSelectedAreaForEdit(targetArea);
        setEditAreaName(targetArea.name);
        setEditAreaColor(targetArea.color);
        setEditNeighbors(targetArea.neighbors || 10);
        setEditNPcas(targetArea.n_pcas || 30);
        setEditResolutions(targetArea.resolutions || 1);

        // Position popup near the user's click (screen space) to avoid off-screen placement when zoomed.
        // DeckGL click info provides x/y in CSS pixels relative to the canvas.
        const container = containerRef.current;
        const rect = container?.getBoundingClientRect();

        // Popup dimensions
        const popupWidth = 280;
        const popupHeight = 300;
        const margin = 10;
        const offset = 20;

        let anchorX = 0;
        let anchorY = 0;

        if (rect && typeof info?.x === 'number' && typeof info?.y === 'number') {
            anchorX = rect.left + info.x;
            anchorY = rect.top + info.y;
        } else {
            // Fallback: if click screen coords are not available, anchor to the ROI's right edge in world space.
            const rightmostPoint = findRightmostPoint(targetArea.points);
            const verticalCenter = findVerticalCenter(targetArea.points);
            const areaPosition = { x: rightmostPoint.x, y: verticalCenter.y };
            const screenPos = worldToScreen(areaPosition.x, areaPosition.y);
            anchorX = (rect?.left || 0) + screenPos.x;
            anchorY = (rect?.top || 0) + screenPos.y;
        }

        // Prefer showing to the right of the anchor; flip to left if needed.
        let left = anchorX + offset;
        let top = anchorY - popupHeight / 2;

        if (left + popupWidth > window.innerWidth - margin) {
            left = anchorX - popupWidth - offset;
        }

        // Final clamp to ensure the popup always stays within the viewport.
        left = Math.max(margin, Math.min(left, window.innerWidth - popupWidth - margin));
        top = Math.max(margin, Math.min(top, window.innerHeight - popupHeight - margin));

        setEditPopupPosition({ x: left, y: top });

        setIsAreaEditPopupVisible(true);
    }, [isDrawing, isAreaTooltipVisible, isTrajectoryMode, customAreas, worldToScreen]);

    // Handle area edit save
    const handleAreaEditSave = () => {
        if (selectedAreaForEdit) {
            setCustomAreas(prev => prev.map(area =>
                area.id === selectedAreaForEdit.id
                    ? {
                        ...area,
                        name: editAreaName,
                        color: editAreaColor,
                        neighbors: editNeighbors,
                        n_pcas: editNPcas,
                        resolutions: editResolutions
                    }
                    : area
            ));

            // Update corresponding UMAP datasets with new area color and name
            setUmapDataSets(prev => prev.map(dataset => {
                // Match by areaId first, then fallback to areaName for backward compatibility.
                const sameSample = dataset.sampleId === selectedAreaForEdit.sampleId;
                const sameArea = dataset.areaId
                    ? dataset.areaId === selectedAreaForEdit.id
                    : dataset.areaName === selectedAreaForEdit.name;

                if (sameSample && sameArea) {

                    // If the area name changed, we need to update the adata_umap_title as well
                    let newAdataUmapTitle = dataset.adata_umap_title;
                    if (editAreaName !== selectedAreaForEdit.name) {
                        // Extract the current adata_umap_title and replace the name part
                        const oldFormattedName = selectedAreaForEdit.name.split(' ').join('_');
                        const newFormattedName = editAreaName.split(' ').join('_');
                        newAdataUmapTitle = dataset.adata_umap_title.replace(oldFormattedName, newFormattedName);
                    }

                    return {
                        ...dataset,
                        areaColor: editAreaColor,
                        areaName: editAreaName,
                        adata_umap_title: newAdataUmapTitle,
                        title: `${editAreaName} (${dataset.sampleId})` // Update display title too
                    };
                }
                return dataset;
            }));
        }
        message.success('Area changes saved.');
    };

    // Handle area deletion
    const handleAreaDelete = () => {
        if (selectedAreaForEdit) {
            const deletingArea = selectedAreaForEdit;

            const relatedUmapCount = (umapDataSets || []).filter(dataset => {
                const sameSample = dataset.sampleId === deletingArea.sampleId;
                const sameArea = dataset.areaId
                    ? dataset.areaId === deletingArea.id
                    : dataset.areaName === deletingArea.name;
                return sameSample && sameArea;
            }).length;

            setCustomAreas(prev => prev.filter(area => area.id !== deletingArea.id));

            // Remove UMAP datasets tied to this area so cards and spot coloring are cleared.
            setUmapDataSets(prev => prev.filter(dataset => {
                const sameSample = dataset.sampleId === deletingArea.sampleId;
                const sameArea = dataset.areaId
                    ? dataset.areaId === deletingArea.id
                    : dataset.areaName === deletingArea.name;
                return !(sameSample && sameArea);
            }));

            // Notify parent first so we can include pseudotime cascade counts in the toast.
            const deletionSummary = onAreaDeleted
                ? onAreaDeleted(deletingArea.sampleId, deletingArea.name)
                : null;

            const relatedTrajectoryCount = (deletingArea.trajectories || []).length;
            const relatedPseudotimeCount = Number.isFinite(deletionSummary?.relatedPseudotimeCount)
                ? deletionSummary.relatedPseudotimeCount
                : 0;
            const umapWord = relatedUmapCount === 1 ? 'UMAP plot' : 'UMAP plots';
            const trajectoryWord = relatedTrajectoryCount === 1 ? 'trajectory' : 'trajectories';
            const pseudotimeWord = relatedPseudotimeCount === 1 ? 'pseudotime result' : 'pseudotime results';
            message.success(`Deleted area "${deletingArea.name}" and removed ${relatedUmapCount} related ${umapWord}, ${relatedTrajectoryCount} related ${trajectoryWord}, and ${relatedPseudotimeCount} related ${pseudotimeWord}.`);
        }
        handleAreaEditCancel();
    };

    // Cancel area edit popup
    const handleAreaEditCancel = () => {
        setIsAreaEditPopupVisible(false);
        setSelectedAreaForEdit(null);
        setEditAreaName('');
        setEditAreaColor('#f72585');
        setEditNeighbors(10);
        setEditNPcas(30);
        setEditResolutions(1);
        setIsTrajectoryMode(false);
        setTrajectoryPoints([]);
        setTrajectoryStart(null);
        setTrajectoryEnd(null);
        setTrajectoryClickCount(0);
        setArrowCoverageArea(null);
        setMaxArrowWidth(50);
        setTrajectoryName('');
    };

    // Handle trajectory mode toggle
    const handleTrajectoryModeToggle = () => {
        const newIsTrajectoryMode = !isTrajectoryMode;
        setIsTrajectoryMode(newIsTrajectoryMode);
        setTrajectoryPoints([]);
        setTrajectoryStart(null);
        setTrajectoryEnd(null);
        setTrajectoryClickCount(0);
        setArrowCoverageArea(null);
        setMaxArrowWidth(50);

        // Generate default trajectory name when entering trajectory mode
        if (newIsTrajectoryMode && selectedAreaForEdit) {
            const existingTrajectories = selectedAreaForEdit.trajectories || [];
            const trajectoryCount = existingTrajectories.length + 1;
            setTrajectoryName(`Custom Trajectory ${trajectoryCount}`);
        } else if (!newIsTrajectoryMode) {
            setTrajectoryName('');
        }
    };

    // Check if a point is inside a polygon using ray casting algorithm
    function isPointInAreaPolygon(point, polygon) {
        const [x, y] = point;
        let inside = false;
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            const [xi, yi] = polygon[i];
            const [xj, yj] = polygon[j];
            if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
                inside = !inside;
            }
        }
        return inside;
    }

    // Helper function to check if a rectangle of given width can fit entirely within the area
    const canRectangleFitInArea = useCallback((start, end, width, areaPolygon, px, py) => {
        const dx = end[0] - start[0];
        const dy = end[1] - start[1];

        const leftOffset = width / 2;
        const rightOffset = width / 2;

        // Sample points along the arrow to check if rectangle fits
        const samples = 20;

        for (let i = 0; i <= samples; i++) {
            const t = i / samples;
            const centerX = start[0] + t * dx;
            const centerY = start[1] + t * dy;

            // Check left side point
            const leftX = centerX + leftOffset * px;
            const leftY = centerY + leftOffset * py;
            if (!isPointInAreaPolygon([leftX, leftY], areaPolygon)) {
                return false;
            }

            // Check right side point
            const rightX = centerX - rightOffset * px;
            const rightY = centerY - rightOffset * py;
            if (!isPointInAreaPolygon([rightX, rightY], areaPolygon)) {
                return false;
            }
        }

        return true;
    }, []);

    // Calculate the maximum possible arrow width based on trajectory position
    const calculateMaxArrowWidth = useCallback((start, end) => {
        if (!start || !end || !selectedAreaForEdit) return 50; // Default max

        const dx = end[0] - start[0];
        const dy = end[1] - start[1];
        const length = Math.sqrt(dx * dx + dy * dy);

        if (length === 0) return 50;

        // Normalize the direction vector
        const nx = dx / length;
        const ny = dy / length;

        // Perpendicular vector
        const px = -ny;
        const py = nx;

        const areaPolygon = selectedAreaForEdit.points;

        // Binary search for maximum width that fits the entire rectangle
        let minWidth = 1;
        let maxWidth = 200; // Start with a reasonable upper bound
        let bestWidth = minWidth;

        // First, find an upper bound by expanding until we hit a boundary
        while (maxWidth <= 1000) { // Safety limit
            if (canRectangleFitInArea(start, end, maxWidth, areaPolygon, px, py)) {
                bestWidth = maxWidth;
                maxWidth *= 2;
            } else {
                break;
            }
        }

        // Now binary search between bestWidth and maxWidth
        let left = bestWidth;
        let right = maxWidth;

        while (right - left > 1) {
            const mid = Math.floor((left + right) / 2);
            if (canRectangleFitInArea(start, end, mid, areaPolygon, px, py)) {
                left = mid;
            } else {
                right = mid;
            }
        }

        // Return at least 10 pixels minimum
        return Math.max(10, left);
    }, [selectedAreaForEdit, canRectangleFitInArea]);

    // Calculate arrow coverage area for saved trajectories (similar to calculateArrowCoverageArea but for any area)
    const calculateSavedTrajectoryArrowCoverageArea = useCallback((start, end, width, areaPoints) => {
        if (!start || !end || !areaPoints) return null;

        const dx = end[0] - start[0];
        const dy = end[1] - start[1];
        const length = Math.sqrt(dx * dx + dy * dy);

        if (length === 0) return null;

        // Normalize the direction vector
        const nx = dx / length;
        const ny = dy / length;

        // Perpendicular vector
        const px = -ny;
        const py = nx;

        const leftOffset = width / 2;
        const rightOffset = width / 2;

        // Create the coverage area polygon
        const coveragePoints = [
            [start[0] + leftOffset * px, start[1] + leftOffset * py],
            [end[0] + leftOffset * px, end[1] + leftOffset * py],
            [end[0] - rightOffset * px, end[1] - rightOffset * py],
            [start[0] - rightOffset * px, start[1] - rightOffset * py]
        ];

        return {
            points: coveragePoints,
            actualLeftWidth: leftOffset,
            actualRightWidth: rightOffset,
            totalWidth: leftOffset + rightOffset
        };
    }, []);

    // Calculate arrow coverage area based on start, end points and width
    const calculateArrowCoverageArea = useCallback((start, end, width) => {
        if (!start || !end || !selectedAreaForEdit) return null;

        const dx = end[0] - start[0];
        const dy = end[1] - start[1];
        const length = Math.sqrt(dx * dx + dy * dy);

        if (length === 0) return null;

        // Normalize the direction vector
        const nx = dx / length;
        const ny = dy / length;

        // Perpendicular vector
        const px = -ny;
        const py = nx;

        const areaPolygon = selectedAreaForEdit.points;

        // Use the helper function to validate the rectangle can fit
        if (!canRectangleFitInArea(start, end, width, areaPolygon, px, py)) {
            // If the requested width doesn't fit, find the maximum width that does
            const maxFitWidth = calculateMaxArrowWidth(start, end);
            width = Math.min(width, maxFitWidth);
        }

        // Calculate the final offsets
        const leftOffset = width / 2;
        const rightOffset = width / 2;

        // Create the coverage area polygon
        const coveragePoints = [
            [start[0] + leftOffset * px, start[1] + leftOffset * py],
            [end[0] + leftOffset * px, end[1] + leftOffset * py],
            [end[0] - rightOffset * px, end[1] - rightOffset * py],
            [start[0] - rightOffset * px, start[1] - rightOffset * py]
        ];

        return {
            points: coveragePoints,
            actualLeftWidth: leftOffset,
            actualRightWidth: rightOffset,
            totalWidth: leftOffset + rightOffset
        };
    }, [selectedAreaForEdit, canRectangleFitInArea, calculateMaxArrowWidth]);

    // Handle trajectory click (double-click detection)
    const handleTrajectoryClick = useCallback((info) => {
        if (!isTrajectoryMode || !selectedAreaForEdit) return;

        const { coordinate } = info;
        if (!coordinate) return;

        // Check if the click is within the selected area
        if (!isPointInAreaPolygon(coordinate, selectedAreaForEdit.points)) {
            message.warning('Please click within the selected area');
            return;
        }

        const worldCoord = coordinate;
        const newClickCount = trajectoryClickCount + 1;

        if (newClickCount === 1) {
            // First click - set start point
            setTrajectoryStart(worldCoord);
            setTrajectoryEnd(null);
            setArrowCoverageArea(null);
            setTrajectoryClickCount(1);
            setMaxArrowWidth(50); // Reset to default
        } else if (newClickCount === 2) {
            // Second click - set end point and calculate coverage
            setTrajectoryEnd(worldCoord);
            setTrajectoryClickCount(0);

            // Calculate maximum possible width for this trajectory
            const maxWidth = calculateMaxArrowWidth(trajectoryStart, worldCoord);
            setMaxArrowWidth(maxWidth);

            // Constrain current arrow width to the new maximum
            const constrainedWidth = Math.min(arrowWidth, maxWidth);
            if (constrainedWidth !== arrowWidth) {
                setArrowWidth(constrainedWidth);
            }

            const coverage = calculateArrowCoverageArea(trajectoryStart, worldCoord, constrainedWidth);
            setArrowCoverageArea(coverage);
        }
    }, [isTrajectoryMode, selectedAreaForEdit, trajectoryClickCount, trajectoryStart, arrowWidth, calculateArrowCoverageArea, calculateMaxArrowWidth]);

    // Handle arrow width change
    const handleArrowWidthChange = useCallback((width) => {
        setArrowWidth(width);

        if (trajectoryStart && trajectoryEnd) {
            const coverage = calculateArrowCoverageArea(trajectoryStart, trajectoryEnd, width);
            setArrowCoverageArea(coverage);
        }
    }, [trajectoryStart, trajectoryEnd, calculateArrowCoverageArea]);

    // Handle trajectory analysis
    const handleAnalyzeTrajectory = useCallback(() => {
        if (!trajectoryStart || !trajectoryEnd || !selectedAreaForEdit || !trajectoryName.trim()) {
            console.error('Missing trajectory data for analysis');
            return;
        }

        // Convert world coordinates back to sample-local coordinates before sending to backend.
        // In multi-sample view, world coordinates include sampleOffsets and will otherwise break barcode lookup.
        const [offsetX, offsetY] = sampleOffsets[selectedAreaForEdit.sampleId] || [0, 0];
        const toSampleLocal = (point) => [point[0] - offsetX, point[1] - offsetY];

        // Set loading state
        setIsTrajectoryAnalyzing(true);

        // Store the analyzing trajectory so it persists even if window is closed
        const analyzingTrajectory = {
            areaId: selectedAreaForEdit.id,
            start: trajectoryStart,
            end: trajectoryEnd,
            width: arrowWidth,
            name: trajectoryName.trim()
        };
        setAnalyzingTrajectories(prev => [...prev, analyzingTrajectory]);

        const trajectoryData = {
            sampleId: selectedAreaForEdit.sampleId,
            startCoordinates: toSampleLocal(trajectoryStart),
            endCoordinates: toSampleLocal(trajectoryEnd),
            arrowWidthPixels: arrowWidth,
            drawingPoints: (selectedAreaForEdit.points || []).map(toSampleLocal),
            areaName: selectedAreaForEdit.name,
            trajectoryName: trajectoryName.trim()
        };

        fetch('/api/analyze_trajectory', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(trajectoryData)
        })
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                return response.text(); // Get as text first to handle potential JSON errors
            })
            .then(text => {
                try {
                    const result = JSON.parse(text);
                    if (result.status === 'success') {
                        const newTrajectory = {
                            id: `trajectory_${Date.now()}`,
                            name: trajectoryName.trim(),
                            start: trajectoryStart,
                            end: trajectoryEnd,
                            width: arrowWidth,
                            analysisResult: result,
                            // Store region and trajectory identifiers for chart correlation
                            region_id: selectedAreaForEdit.name, // Area name serves as region_id
                            trajectory_id: trajectoryName.trim(), // Trajectory name serves as trajectory_id
                            sample_id: selectedAreaForEdit.sampleId // Store sample_id for reference
                        };

                        // Update the area with the new trajectory using functional update to preserve any areas added during analysis
                        setCustomAreas(prevAreas => {
                            const updatedAreas = prevAreas.map(area => {
                                if (area.id === selectedAreaForEdit.id) {
                                    const trajectories = area.trajectories || [];
                                    return {
                                        ...area,
                                        trajectories: [...trajectories, newTrajectory]
                                    };
                                }
                                return area;
                            });
                            
                            // Update selected area for edit if it's still open
                            if (selectedAreaForEdit && selectedAreaForEdit.id === selectedAreaForEdit.id) {
                                const updatedSelectedArea = updatedAreas.find(area => area.id === selectedAreaForEdit.id);
                                setSelectedAreaForEdit(updatedSelectedArea);
                            }
                            
                            return updatedAreas;
                        });

                        // Exit trajectory mode and reset only after successful analysis
                        setIsTrajectoryMode(false);
                        setTrajectoryStart(null);
                        setTrajectoryEnd(null);
                        setTrajectoryName('');
                        setArrowCoverageArea(null);

                        message.success('Trajectory analysis completed successfully');

                        // Notify parent that trajectory analysis is complete
                        if (onTrajectoryAnalysisComplete) {
                            // Get the sample ID and region name from the trajectory data
                            const sampleId = trajectoryData.sampleId;
                            const regionName = trajectoryData.areaName;
                            onTrajectoryAnalysisComplete(sampleId, regionName);
                        }
                    } else {
                        console.error('Analysis failed:', result.message);
                        alert(`Analysis failed: ${result.message || 'Unknown error'}`);
                    }
                } catch (jsonError) {
                    console.error('Invalid JSON response:', text);
                    console.error('JSON Parse Error:', jsonError);
                    alert(`Server returned invalid response. Please check the backend logs.`);
                }
            })
            .catch(error => {
                console.error('Error analyzing trajectory:', error);
                alert(`Error analyzing trajectory: ${error.message}`);
            })
            .finally(() => {
                // Clear loading state and remove from analyzing trajectories
                setIsTrajectoryAnalyzing(false);
                setAnalyzingTrajectories(prev => prev.filter(t =>
                    !(t.areaId === selectedAreaForEdit.id &&
                        t.start === trajectoryStart &&
                        t.end === trajectoryEnd)
                ));
            });
    }, [trajectoryStart, trajectoryEnd, arrowWidth, selectedAreaForEdit, trajectoryName, onTrajectoryAnalysisComplete, sampleOffsets]);

    // Memoize getSampleAtCoordinate to prevent infinite effect loops
    const getSampleAtCoordinate = useCallback((x, y) => {
        for (const sample of selectedSamples) {
            const offset = sampleOffsets[sample.id] || [0, 0];
            const imageSize = imageSizes[sample.id];
            if (imageSize) {
                const [offsetX, offsetY] = offset;
                const [width, height] = imageSize;
                if (x >= offsetX && x <= offsetX + width &&
                    y >= offsetY && y <= offsetY + height) {
                    return sample.id;
                }
            }
        }
        return null;
    }, [selectedSamples, sampleOffsets, imageSizes]);

    const handleMapClick = useCallback((info) => {
        // Handle trajectory clicks if in trajectory mode
        if (isTrajectoryMode) {
            handleTrajectoryClick(info);
            return;
        }

        // First check if we clicked on a custom area (for editing)
        if (!isDrawing && !isAreaTooltipVisible) {
            handleAreaClick(info);
            return;
        }

        // Drawing uses native pointerdown handler for better fast-click reliability.
        if (isDrawing) return;

        if (!info.coordinate) return;

        const [x, y] = info.coordinate;
        const currentPoint = [x, y];

        // If this is the first point and no sample is selected, determine the sample
        if (!currentDrawingSample && drawingPoints.length === 0) {
            const sampleId = getSampleAtCoordinate(x, y);
            if (!sampleId) return; // Click outside any sample
            setCurrentDrawingSample(sampleId);
        }

        // Check for auto-close (snap to first point)
        if (shouldSnapToFirst(currentPoint)) {
            finishDrawing();
            return;
        }

        setDrawingPoints(prev => [...prev, currentPoint]);
    }, [isDrawing, isAreaTooltipVisible, shouldSnapToFirst, currentDrawingSample, drawingPoints.length, getSampleAtCoordinate, handleAreaClick, isTrajectoryMode, handleTrajectoryClick]);

    // Reliable ROI point placement on fast clicks: use native pointerdown to avoid DeckGL click suppression.
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        if (!isDrawing || isAreaTooltipVisible || isTrajectoryMode) return;

        const handlePointerDown = (event) => {
            // Only primary button / touch
            if (event.button != null && event.button !== 0) return;

            const viewState = mainViewStateRef.current;
            if (!viewState) return;

            const rect = container.getBoundingClientRect();
            const x = event.clientX - rect.left;
            const y = event.clientY - rect.top;

            if (x < 0 || y < 0 || x > rect.width || y > rect.height) return;

            let worldCoords;
            try {
                const viewport = new OrthographicView({ id: 'main' }).makeViewport({
                    width: rect.width,
                    height: rect.height,
                    viewState
                });
                worldCoords = viewport.unproject([x, y]);
            } catch {
                return;
            }

            if (!worldCoords || worldCoords.length < 2) return;

            const worldX = worldCoords[0];
            const worldY = worldCoords[1];
            const currentPoint = [worldX, worldY];

            // Determine sample on first point
            const points = drawingPointsRef.current || [];
            const activeSample = currentDrawingSampleRef.current;
            if (!activeSample && points.length === 0) {
                const sampleId = getSampleAtCoordinate(worldX, worldY);
                if (!sampleId) return;
                currentDrawingSampleRef.current = sampleId;
                setCurrentDrawingSample(sampleId);
            }

            // Snap-to-first (auto-close)
            if (points.length >= 3) {
                const firstPoint = points[0];
                const dx = currentPoint[0] - firstPoint[0];
                const dy = currentPoint[1] - firstPoint[1];
                const worldDistance = Math.sqrt(dx * dx + dy * dy);
                const baseSnapDistance = 50;
                const zoomFactor = Math.pow(2, -viewState.zoom);
                const dynamicSnapDistance = baseSnapDistance * zoomFactor;

                if (worldDistance < dynamicSnapDistance) {
                    event.preventDefault();
                    event.stopPropagation();
                    finishDrawingRef.current?.();
                    return;
                }
            }

            event.preventDefault();
            event.stopPropagation();

            setDrawingPoints(prev => {
                const next = [...prev, currentPoint];
                drawingPointsRef.current = next;
                return next;
            });
        };

        container.addEventListener('pointerdown', handlePointerDown, { capture: true });
        return () => {
            container.removeEventListener('pointerdown', handlePointerDown, { capture: true });
        };
    }, [isDrawing, isAreaTooltipVisible, isTrajectoryMode, getSampleAtCoordinate]);

    // Track mouse movement for preview
    const handleMouseMove = useCallback((info) => {
        if (isDrawing) {
            if (info.coordinate) {
                setMousePosition(info.coordinate);
            }
        } else {
            // Only track mouse position for magnifier when magnifier is actually visible.
            // Otherwise, mousemove would trigger a React re-render on every frame and cause UI jank.
            if (magnifierVisible && info.coordinate) {
                const [worldX, worldY] = info.coordinate;

                // Update mouse position for magnifier tracking
                setMagnifierMousePos(prev => {
                    if (prev && prev.x === worldX && prev.y === worldY) return prev;
                    return { x: worldX, y: worldY };
                });

                if (!isAreaTooltipVisible && !isAreaEditPopupVisible) {
                    // Determine which sample the mouse is over
                    const hoveredSample = getSampleAtCoordinate(worldX, worldY);
                    if (hoveredSample) {
                        updateMagnifierViewport(worldX, worldY, hoveredSample);
                    }
                }
            }

            // Clear drawing mousePosition when not drawing
            if (mousePosition !== null) setMousePosition(null);
        }
    }, [isDrawing, mousePosition, magnifierVisible, isAreaTooltipVisible, isAreaEditPopupVisible, getSampleAtCoordinate, updateMagnifierViewport]);

    // Create collapse items for each sample
    const collapseItems = selectedSamples.map((sample, index) => ({
        key: sample.id,
        label: sample.name,
        children: (
            <>
                <Radio.Group
                    block
                    options={radioOptions}
                    size='small'
                    value={radioCellGeneModes && radioCellGeneModes[sample.id] ? radioCellGeneModes[sample.id] : 'cellTypes'}
                    optionType="button"
                    style={{ marginBottom: 10 }}
                    onChange={(e) => changeCellGeneMode(sample.id, e)}
                />

                {(radioCellGeneModes && radioCellGeneModes[sample.id] ? radioCellGeneModes[sample.id] : 'cellTypes') === 'cellTypes' ? (
                    <CellSettings
                        cellTypesData={cellTypesData && cellTypesData[sample.id] ? cellTypesData[sample.id] : []}
                        selectedCellTypes={selectedCellTypes && selectedCellTypes[sample.id] ? selectedCellTypes[sample.id] : []}
                        setSelectedCellTypes={(newSelectedTypes) => {
                            setSelectedCellTypes(prev => ({
                                ...prev,
                                [sample.id]: newSelectedTypes
                            }));
                        }}
                        cellTypeColors={cellTypeColors}
                        setCellTypeColors={setCellTypeColors}
                    />
                ) : (
                    <GeneSettings
                        sampleId={sample.id}
                        availableGenes={availableGenes}
                        setAvailableGenes={setAvailableGenes}
                        selectedGenes={selectedGenes}
                        setSelectedGenes={setSelectedGenes}
                        geneColorMap={geneColorMap}
                        setGeneColorMap={setGeneColorMap}
                        onKosaraData={handleKosaraData}
                        onKosaraLoadingStart={handleKosaraLoadingStart}
                    />
                )}
            </>
        )
    }));

    const handleViewStateChange = useCallback(({ viewState, viewId }) => {
        if (viewId && viewId !== 'main') return;

        const nextViewState = (viewState && viewState.main) ? viewState.main : viewState;
        if (!nextViewState) return;

        // Throttle setState to animation frames to avoid flicker during zoom
        const nextState = (prev => ({
            ...prev,
            ...nextViewState,
            maxZoom: prev?.maxZoom ?? 2.5,
            minZoom: prev?.minZoom ?? -5
        }))(mainViewStateRef.current || mainViewState);

        viewStatePendingRef.current = nextState;
        if (viewStateRafRef.current == null) {
            viewStateRafRef.current = requestAnimationFrame(() => {
                viewStateRafRef.current = null;
                const pending = viewStatePendingRef.current;
                viewStatePendingRef.current = null;
                if (!pending) return;

                setMainViewState(prev => {
                    if (
                        prev &&
                        prev.zoom === pending.zoom &&
                        prev.maxZoom === pending.maxZoom &&
                        prev.minZoom === pending.minZoom &&
                        prev.target && pending.target &&
                        prev.target[0] === pending.target[0] &&
                        prev.target[1] === pending.target[1] &&
                        prev.target[2] === pending.target[2]
                    ) {
                        return prev;
                    }
                    return pending;
                });
            });
        }
    }, [mainViewState]);

    // Helper function to check if two areas are the same
    const arePointsSimilar = (points1, points2, tolerance = 1) => {
        if (!points1 || !points2 || points1.length !== points2.length) {
            return false;
        }

        // Check if all points are within tolerance distance
        return points1.every((point1, index) => {
            const point2 = points2[index];
            const dx = point1[0] - point2[0];
            const dy = point1[1] - point2[1];
            const distance = Math.sqrt(dx * dx + dy * dy);
            return distance <= tolerance;
        });
    };

    // Helper function to check for duplicate UMAP
    const findDuplicateUmap = (sampleId, areaPoints, neighbors, nPcas, resolutions) => {
        if (!umapDataSets || umapDataSets.length === 0) return null;

        return umapDataSets.find(dataset => {
            // Check if sample ID matches
            if (dataset.sampleId !== sampleId) return false;

            // Check if parameters match
            const datasetTitle = dataset.adata_umap_title || '';
            const titleParts = datasetTitle.split('_');
            if (titleParts.length >= 3) {
                const datasetNeighbors = parseInt(titleParts[titleParts.length - 3]) || 0;
                const datasetNPcas = parseInt(titleParts[titleParts.length - 2]) || 0;
                const datasetResolutions = parseFloat(titleParts[titleParts.length - 1]) || 0;

                if (datasetNeighbors !== neighbors ||
                    datasetNPcas !== nPcas ||
                    Math.abs(datasetResolutions - resolutions) > 0.001) {
                    return false;
                }
            }

            // Check if area points are similar
            return arePointsSimilar(dataset.areaPoints, areaPoints, 5); // 5 pixel tolerance
        });
    };

    const generateUmap = () => {
        if (!selectedAreaForEdit) return;

        // Get cells that are within the selected area BEFORE making the API call
        const sampleCells = coordinatesData && coordinatesData[selectedAreaForEdit.sampleId] ? coordinatesData[selectedAreaForEdit.sampleId] : [];
        const offset = sampleOffsets && sampleOffsets[selectedAreaForEdit.sampleId] ? sampleOffsets[selectedAreaForEdit.sampleId] : [0, 0];

        // Filter cells that are within the drawn polygon
        const cellsInArea = sampleCells.filter(cell => {
            const localX = cell.cell_x;
            const localY = cell.cell_y;

            // Simple point-in-polygon check
            return isPointInPolygon([localX, localY], selectedAreaForEdit.points.map(p => [p[0] - offset[0], p[1] - offset[1]]));
        });

        const cellIdsInArea = cellsInArea.map(cell => cell.id);

        // Check if we have any cells in the selected area
        if (cellIdsInArea.length === 0) {
            message.warning('No cells found in the selected area');
            return;
        }

        // Check for duplicate UMAP before generating
        const duplicateUmap = findDuplicateUmap(
            selectedAreaForEdit.sampleId,
            selectedAreaForEdit.points,
            editNeighbors,
            editNPcas,
            editResolutions
        );

        if (duplicateUmap) {
            message.warning({
                content: `A UMAP with the same parameters and area already exists. Please modify the parameters or select a different area.`,
                duration: 6, // Show for 6 seconds since it's a longer message
            });
            return;
        }

        // Generate a unique ID for this UMAP dataset
        const umapId = `${selectedAreaForEdit.sampleId}_${selectedAreaForEdit.name}_${Date.now()}`;
        const umapTitle = `${selectedAreaForEdit.name} (${selectedAreaForEdit.sampleId})`;

        const name = selectedAreaForEdit.name;
        const formattedName = name.split(' ').join('_');
        const adata_umap_title = `${formattedName}_${selectedAreaForEdit.sampleId}_${editNeighbors}_${editNPcas}_${editResolutions}`;

        // Add a new loading dataset entry
        setUmapDataSets(prev => [
            ...prev,
            {
                id: umapId,
                title: umapTitle,
                adata_umap_title: adata_umap_title,
                data: [],
                loading: true,
                sampleId: selectedAreaForEdit.sampleId,
                areaId: selectedAreaForEdit.id,
                areaPoints: selectedAreaForEdit.points,
                areaColor: selectedAreaForEdit.color,
                areaName: selectedAreaForEdit.name
            }
        ]);

        setUmapLoading(true);

        fetch('/api/get_umap_data', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sample_id: selectedAreaForEdit.sampleId,
                cell_ids: cellIdsInArea,  // Pass the cell IDs to the backend
                n_neighbors: editNeighbors,
                n_pcas: editNPcas,
                resolutions: editResolutions,
                adata_umap_title: adata_umap_title
            })
        })
            .then(res => res.json())
            .then(response => {
                if (response.status === 'success') {
                    // Success case - use the data from response.data
                    setUmapDataSets(prev =>
                        prev.map(dataset =>
                            dataset.id === umapId
                                ? { ...dataset, data: response.data, loading: false }
                                : dataset
                        )
                    );
                    message.success('UMAP analysis completed successfully');
                } else {
                    // Error case - show error message and remove failed dataset
                    console.error('UMAP generation failed:', response.message);
                    message.error(`UMAP generation failed: ${response.message}`);
                    setUmapDataSets(prev => prev.filter(dataset => dataset.id !== umapId));
                }
                setUmapLoading(false);
            })
            .catch(error => {
                console.error('Error generating UMAP:', error);
                message.error(`Error generating UMAP: ${error.message}`);

                // Remove the failed dataset entry
                setUmapDataSets(prev => prev.filter(dataset => dataset.id !== umapId));
                setUmapLoading(false);
            });
    }

    // Helper function for point-in-polygon check
    const isPointInPolygon = (point, polygon) => {
        const [x, y] = point;
        let inside = false;

        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            const [xi, yi] = polygon[i];
            const [xj, yj] = polygon[j];

            if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
                inside = !inside;
            }
        }

        return inside;
    };

    // Generate tissue image layers
    const generateImageLayers = useCallback(() => {
        const layers = selectedSamples.map(sample => {
            const imageSize = imageSizes[sample.id];
            const offset = sampleOffsets[sample.id] || [0, 0];
            const sampleId = String(sample.id);
            const resolvedImage =
                preloadedImageRefs.current[sampleId] ||
                stableLayerImageBySampleRef.current[sampleId];
            const hasImage = !!resolvedImage;

            if (!imageSize) return null;

            if (!hasImage) {
                return null;
            }

            const layer = new BitmapLayer({
                id: `tissue-image-${sample.id}`,
                image: resolvedImage,
                bounds: [
                    offset[0],
                    offset[1] + imageSize[1],
                    offset[0] + imageSize[0],
                    offset[1]
                ],
                opacity: 0.8,
                parameters: { depthTest: false },
                // Keep layer stable; no custom updateTriggers/transitions to avoid flicker on zoom
            });

            return layer;
        }).filter(Boolean);

        return layers;
    }, [selectedSamples, imageSizes, sampleOffsets, decodedHiresImages]);

    // Generate cell scatter layers and kosara polygons (gene mode)
    const kosaraPolygonsBySample = useMemo(() => {
        const result = {};
        selectedSamples.forEach(sample => {
            const sampleId = sample.id;
            const mode = radioCellGeneModes[sampleId];
            // Generate kosara polygons when in gene mode with selected genes and kosara data available
            if (mode === 'genes' && selectedGenes.length > 0 && (kosaraDataBySample[sampleId]?.length > 0)) {
                const offset = sampleOffsets[sampleId] || [0, 0];
                const optimizedPathData = kosaraDataBySample[sampleId].flatMap(d => {
                    const angles = Object.entries(d.angles || {});
                    const ratios = Object.entries(d.ratios || {});
                    const radius = Object.entries(d.radius || {});
                    return generateKosaraPath(
                        (d.cell_x || 0) + offset[0],
                        (d.cell_y || 0) + offset[1],
                        angles,
                        ratios,
                        radius
                    ).map(path => ({
                        id: d.id,
                        cell_type: d.cell_type,
                        points: path.path,
                        color: path.color,
                        gene: path.gene,
                        total_expression: d.total_expression,
                        ratios: d.ratios,
                    }));
                });
                result[sampleId] = optimizedPathData;
            }
        });
        return result;
    }, [selectedSamples, radioCellGeneModes, selectedGenes, geneColorMap, kosaraDataBySample, sampleOffsets, generateKosaraPath]);

    // Precompute hovered ID sets per sample for efficient matching
    const hoveredIdsSetBySample = useMemo(() => {
        if (!hoveredCluster || !hoveredCluster.sampleId || !Array.isArray(hoveredCluster.cellIds)) return {};
        return { [hoveredCluster.sampleId]: new Set(hoveredCluster.cellIds.map(String)) };
    }, [hoveredCluster]);

    // Precompute cluster color mappings per sample so pan/zoom does not rebuild maps.
    // Building these maps can be O(#cells) and must not happen on every viewState update.
    const clusterMapsBySample = useMemo(() => {
        const result = {};
        if (!selectedSamples || selectedSamples.length === 0) return result;

        const selectedIds = new Set(selectedSamples.map(s => s.id));
        selectedSamples.forEach(s => {
            result[s.id] = {
                cellToClusterMap: new Map(),
                clusterColorMap: new Map()
            };
        });

        if (!clusterColorMappings || !umapDataSets || umapDataSets.length === 0) return result;

        for (const umapDataSet of umapDataSets) {
            const sampleId = umapDataSet.sampleId;
            if (!selectedIds.has(sampleId)) continue;

            const mapping = clusterColorMappings[umapDataSet.adata_umap_title];
            if (!mapping || mapping.sample_id !== sampleId || !mapping.clusters) continue;

            const entry = result[sampleId];
            if (!entry) continue;

            const cellToClusterMap = entry.cellToClusterMap;
            const clusterColorMap = entry.clusterColorMap;

            const rows = Array.isArray(umapDataSet.data) ? umapDataSet.data : [];
            for (const cell of rows) {
                const cellId = String(cell?.id ?? cell?.cell_id);
                if (!cellId) continue;

                const clusterName = cell?.cluster;
                const clusterNumber = clusterName?.toString().replace(/\D/g, '');
                if (!clusterNumber) continue;

                const clusterHex = mapping.clusters[clusterNumber];
                if (!clusterHex) continue;

                cellToClusterMap.set(cellId, clusterName);
                clusterColorMap.set(cellId, clusterHex);
            }
        }

        return result;
    }, [selectedSamples, umapDataSets, clusterColorMappings]);

    const generateCellLayers = useCallback(() => {
        // While drawing/trajectory/editing, disable picking on dense cell/gene layers.
        // This prevents clicks on spots from interfering with drawing.
        const pickingEnabled = !isDrawing && !isTrajectoryMode && !isAreaTooltipVisible && !isAreaEditPopupVisible;

        const built = selectedSamples.flatMap(sample => {
            const sampleId = sample.id;
            const mode = radioCellGeneModes[sampleId];

            const clusterMaps = clusterMapsBySample[sampleId];
            const cellToClusterMap = clusterMaps?.cellToClusterMap;
            const clusterColorMap = clusterMaps?.clusterColorMap;
            const clusterCount = cellToClusterMap?.size || 0;

            // Check if sample is 16um to adjust base radius
            const is16um = sample.name && sample.name.includes('16um');
            const baseRadiusRaw = is16um ? 10 : 5;
            const baseRadius = baseRadiusRaw;

            // Cap the on-screen radius to prevent GPU overdraw at extreme zoom
            const radiusMaxRaw = is16um ? 80 : 60;
            const radiusMaxPixels = radiusMaxRaw;

            // Keep point size stable across zoom to avoid massive overdraw at high zoom
            // and to keep layers stable (no recreation) while panning/zooming.
            const dynamicRadius = baseRadius;

            // If in gene mode and single gene data available, draw single gene expression visualization
            if (mode === 'genes' && singleGeneDataBySample[sampleId]?.cells?.length > 0) {
                const singleGeneData = singleGeneDataBySample[sampleId];
                // Draw only non-zero expression points to reduce GPU load during pan/zoom.
                // Keep a separate "all cells" array for overlays that shouldn't depend on expression.
                const expressionData = singleGeneWorldDataBySample.nonZero[sampleId] || [];
                const allGeneCells = singleGeneWorldDataBySample.all[sampleId] || [];

                const layers = [new ScatterplotLayer({
                    id: `single-gene-expression-${sampleId}`,
                    data: expressionData,
                    getPosition: d => [d.x, d.y],
                    radiusScale: dynamicRadius,
                    getRadius: 1,
                    getFillColor: d => {
                        // Get the confirmed gene name from the stored data (not from selectedGenes which can change)
                        const confirmedGeneName = singleGeneData.geneName;
                        const baseColor = geneColorMap[confirmedGeneName] || "#d73027";

                        const color = getSequentialColor(
                            d.expression,
                            singleGeneData.min_expression,
                            singleGeneData.max_expression,
                            baseColor
                        );
                        // Binary opacity: low for zero expression, high for any expression
                        const opacity = d.expression === 0 ? 0 : 255;
                        return [...color, opacity];
                    },
                    pickable: pickingEnabled,
                    stroked: false,
                    radiusUnits: 'meters',
                    radiusMinPixels: 1,
                    radiusMaxPixels,
                    parameters: { depthTest: false, blend: true },
                    updateTriggers: {
                        getFillColor: [singleGeneData.min_expression, singleGeneData.max_expression, singleGeneData.geneName, geneColorMap[singleGeneData.geneName]],
                        getRadius: [sampleId]
                    },
                    transitions: {
                        getPosition: 0,
                        getFillColor: 0,
                        getRadius: 0
                    }
                })];

                // Create overlay for cells with cluster assignments
                if (clusterCount > 0 && cellToClusterMap) {
                    const clusterData = allGeneCells.filter(d => cellToClusterMap.has(String(d.id)));
                    
                    layers.push(new ScatterplotLayer({
                        id: `single-gene-clusters-${sampleId}`,
                        data: clusterData,
                        getPosition: d => [d.x, d.y],
                        radiusScale: dynamicRadius,
                        getRadius: 1.5,
                        getFillColor: d => {
                            const cellId = String(d.id);
                            const hex = clusterColorMap.get(cellId);
                            if (hex) {
                                const rgb = hex.match(/\w\w/g)?.map(x => parseInt(x, 16)) || [100, 100, 100];
                                // Lighten by blending with white (20% lighter)
                                const lightRgb = rgb.map(c => Math.min(255, Math.floor(c + (255 - c) * 0.2)));
                                return [...lightRgb, 150];
                            }
                            return [100, 100, 100, 150];
                        },
                        getLineColor: d => {
                            const cellId = String(d.id);
                            const hex = clusterColorMap.get(cellId);
                            if (hex) {
                                const rgb = hex.match(/\w\w/g)?.map(x => parseInt(x, 16)) || [80, 80, 80];
                                return [Math.floor(rgb[0] * 0.9), Math.floor(rgb[1] * 0.9), Math.floor(rgb[2] * 0.9), 200];
                            }
                            return [80, 80, 80, 200];
                        },
                        getLineWidth: 1,
                        lineWidthUnits: 'pixels',
                        radiusUnits: 'meters',
                        radiusMinPixels: 1,
                        radiusMaxPixels,
                        pickable: false,
                        stroked: true,
                        updateTriggers: {
                            data: [clusterCount, sampleId],
                            getFillColor: [clusterColorMap],
                            getLineColor: [clusterColorMap],
                        },
                        parameters: { depthTest: false }
                    }));
                }

                // Add a highlight overlay for hovered cells (on top of cluster colors)
                const hoveredSet = hoveredIdsSetBySample[sampleId] || null;
                if (hoveredSet) {
                    const highlightData = allGeneCells.filter(d => hoveredSet.has(String(d.id)));

                    layers.push(new ScatterplotLayer({
                        id: `single-gene-highlight-${sampleId}`,
                        data: highlightData,
                        getPosition: d => [d.x, d.y],
                        radiusScale: dynamicRadius,
                        getRadius: 1.8,
                        getFillColor: [255, 215, 0, 240],
                        getLineColor: [255, 140, 0, 255],
                        getLineWidth: 2,
                        lineWidthUnits: 'pixels',
                        radiusUnits: 'meters',
                        radiusMinPixels: 1,
                        radiusMaxPixels,
                        pickable: false,
                        stroked: true,
                        updateTriggers: {
                            getRadius: [sampleId, hoveredCluster],
                        },
                        parameters: { depthTest: false }
                    }));
                }

                return layers;
            }
            // If in gene mode and kosara data available, draw kosara polygons + optional highlight overlay
            else if (mode === 'genes' && kosaraPolygonsBySample[sampleId]?.length > 0) {
                const optimizedPathData = kosaraPolygonsBySample[sampleId];
                const layers = [new PolygonLayer({
                    id: `kosara-polygons-${sampleId}`,
                    data: optimizedPathData,
                    getPolygon: d => d.points,
                    getFillColor: d => {
                        // if this polygon corresponds to a gene slice, color via map/palette; otherwise use fixed color
                        if (d.gene) {
                            const hex = geneColorMap[d.gene] || (() => {
                                const pos = selectedGenes.indexOf(d.gene);
                                const fallback = COLOR_PALETTE[(pos >= 0 ? pos : 0) % COLOR_PALETTE.length];
                                return fallback;
                            })();
                            const rgbColor = convertHEXToRGB(hex);
                            return [...rgbColor, 255];
                        }
                        const rgbColor = convertHEXToRGB(d.color || '#333333');
                        return [...rgbColor, 255];
                    },
                    pickable: pickingEnabled,
                    stroked: false,
                    parameters: { depthTest: false, blend: true },
                    updateTriggers: { data: [kosaraPolygonsBySample[sampleId], sampleId], getFillColor: [geneColorMap, selectedGenes] },
                    transitions: {
                        getPolygon: 0,
                        getFillColor: 0
                    }
                })];

                // Create overlay for cells with cluster assignments
                if (clusterCount > 0 && cellToClusterMap) {
                    const cellData = (filteredCellData[sampleId] || []);
                    const clusterData = cellData.filter(d => cellToClusterMap.has(String(d.id ?? d.cell_id)));
                    
                    layers.push(new ScatterplotLayer({
                        id: `kosara-clusters-${sampleId}`,
                        data: clusterData,
                        getPosition: d => [d.x, d.y],
                        radiusScale: dynamicRadius,
                        getRadius: 1.5,
                        getFillColor: d => {
                            const cellId = String(d.id ?? d.cell_id);
                            const hex = clusterColorMap.get(cellId);
                            if (hex) {
                                const rgb = hex.match(/\w\w/g)?.map(x => parseInt(x, 16)) || [100, 100, 100];
                                // Lighten by blending with white (20% lighter)
                                const lightRgb = rgb.map(c => Math.min(255, Math.floor(c + (255 - c) * 0.2)));
                                return [...lightRgb, 150];
                            }
                            return [100, 100, 100, 150];
                        },
                        getLineColor: d => {
                            const cellId = String(d.id ?? d.cell_id);
                            const hex = clusterColorMap.get(cellId);
                            if (hex) {
                                const rgb = hex.match(/\w\w/g)?.map(x => parseInt(x, 16)) || [80, 80, 80];
                                return [Math.floor(rgb[0] * 0.9), Math.floor(rgb[1] * 0.9), Math.floor(rgb[2] * 0.9), 200];
                            }
                            return [80, 80, 80, 200];
                        },
                        getLineWidth: 1,
                        lineWidthUnits: 'pixels',
                        radiusUnits: 'meters',
                        radiusMinPixels: 1,
                        radiusMaxPixels,
                        pickable: false,
                        stroked: true,
                        updateTriggers: {
                            data: [clusterCount, sampleId],
                            getFillColor: [clusterColorMap],
                            getLineColor: [clusterColorMap],
                        },
                        parameters: { depthTest: false }
                    }));
                }

                // Add a highlight overlay for hovered cells to ensure cross-highlighting works in gene mode
                const hoveredSet = hoveredIdsSetBySample[sampleId] || null;
                if (hoveredSet) {
                    const highlightData = (filteredCellData[sampleId] || []).filter(d => hoveredSet.has(String(d.id ?? d.cell_id)));

                    layers.push(new ScatterplotLayer({
                        id: `cells-highlight-${sampleId}`,
                        data: highlightData,
                        getPosition: d => [d.x, d.y],
                        radiusScale: dynamicRadius,
                        getRadius: 1.8,
                        getFillColor: [255, 215, 0, 240],
                        getLineColor: [255, 140, 0, 255],
                        getLineWidth: 3,
                        lineWidthUnits: 'pixels',
                        radiusUnits: 'meters',
                        radiusMinPixels: 1,
                        radiusMaxPixels,
                        pickable: false,
                        stroked: true,
                        updateTriggers: {
                            getRadius: [sampleId, hoveredCluster],
                        },
                        parameters: { depthTest: false }
                    }));
                }

                return layers;
            }

            // Otherwise, default cell scatter for cell type highlighting
            const cellData = filteredCellData[sampleId] || [];
            const hoveredSet = hoveredIdsSetBySample[sampleId] || null;

            const hasConfirmedGeneData = (singleGeneDataBySample[sampleId]?.cells?.length > 0) || (kosaraDataBySample[sampleId]?.length > 0);
            const isGeneModeWithoutSelection = mode === 'genes' && (!selectedGenes || selectedGenes.length === 0);
            const isGeneModeWithoutConfirmedData = mode === 'genes' && selectedGenes.length > 0 && !hasConfirmedGeneData;
            const shouldShowCellTypes = mode === 'cellTypes' || isGeneModeWithoutSelection || isGeneModeWithoutConfirmedData;

            return [new ScatterplotLayer({
                id: `cells-${sampleId}`,
                data: cellData,
                getPosition: d => [d.x, d.y],
                radiusScale: dynamicRadius,
                getRadius: d => {
                    const localId = d.id ?? d.cell_id;
                    const isHoveredSample = !!hoveredSet;
                    if (isHoveredSample && hoveredSet.has(String(localId))) {
                        return 1.8;
                    }
                    return 1;
                },
                getFillColor: d => {
                    const localId = String(d.id ?? d.cell_id);
                    const cellType = d.cell_type;

                    // Priority 1: Hovered cells (brightest highlight)
                    if (hoveredSet && hoveredSet.has(localId)) {
                        return [255, 215, 0, 240];
                    }

                    // Priority 2: Cell type colors (if in cell type mode)
                    if (shouldShowCellTypes) {
                        const sampleSelectedCellTypes = selectedCellTypes && selectedCellTypes[sampleId] ? selectedCellTypes[sampleId] : [];
                        if (cellType && sampleSelectedCellTypes.includes(cellType)) {
                            const color = cellTypeColors[cellType];
                            if (color) {
                                const rgb = color.match(/\w\w/g)?.map(x => parseInt(x, 16)) || [100, 100, 100];
                                return [...rgb, 200];
                            }
                        }
                    }

                    // Priority 3: Cluster colors from UMAP (always show if available)
                    const clusterHex = clusterColorMap.get(localId);
                    if (clusterHex) {
                        const rgb = clusterHex.match(/\w\w/g)?.map(x => parseInt(x, 16)) || [100, 100, 100];
                        // Lighten by blending with white (20% lighter)
                        const lightRgb = rgb.map(c => Math.min(255, Math.floor(c + (255 - c) * 0.2)));
                        return [...lightRgb, 150];
                    }

                    // Priority 4: Dimmed when other cells are hovered
                    if (hoveredSet) {
                        return [150, 150, 150, 50];
                    }

                    return [0, 0, 0, 0];
                },
                getLineColor: d => {
                    const localId = String(d.id ?? d.cell_id);
                    
                    // Hovered cells get bright border
                    if (hoveredSet && hoveredSet.has(localId)) {
                        return [255, 140, 0, 255];
                    }
                    
                    // Cells with cluster assignment get slightly darker cluster color border
                    const clusterHex = clusterColorMap.get(localId);
                    if (clusterHex) {
                        const rgb = clusterHex.match(/\w\w/g)?.map(x => parseInt(x, 16)) || [80, 80, 80];
                        return [Math.floor(rgb[0] * 0.9), Math.floor(rgb[1] * 0.9), Math.floor(rgb[2] * 0.9), 200];
                    }
                    
                    if (hoveredSet) {
                        return [150, 150, 150, 100];
                    }
                    return [0, 0, 0, 0];
                },
                getLineWidth: d => {
                    const localId = String(d.id ?? d.cell_id);
                    if (hoveredSet && hoveredSet.has(localId)) {
                        return 3;
                    }
                    // Show border for cells with cluster assignment
                    if (clusterColorMap && clusterColorMap.has(localId)) {
                        return 1;
                    }
                    if (hoveredSet) {
                        return 1;
                    }
                    return 0;
                },
                lineWidthUnits: 'pixels',
                pickable: pickingEnabled,
                radiusUnits: 'meters',
                radiusMinPixels: 1,
                radiusMaxPixels,
                stroked: true,
                filled: (!!hoveredSet) || (clusterCount > 0) || (shouldShowCellTypes && selectedCellTypes && selectedCellTypes[sampleId] && selectedCellTypes[sampleId].length > 0),
                updateTriggers: {
                    getFillColor: [hoveredCluster, selectedCellTypes && selectedCellTypes[sampleId] ? selectedCellTypes[sampleId] : [], cellTypeColors, sampleId, shouldShowCellTypes, clusterColorMap, clusterCount],
                    getLineColor: [hoveredCluster, sampleId, clusterColorMap, clusterCount],
                    getRadius: [sampleId, hoveredCluster],
                    getLineWidth: [hoveredCluster, sampleId, clusterCount],
                },
                transitions: {
                    getPosition: 0,
                    getRadius: 0
                }
            })];
        }).filter(Boolean);

        return built;
    }, [selectedSamples, filteredCellData, hoveredCluster, hoveredIdsSetBySample, selectedCellTypes, cellTypeColors, radioCellGeneModes, kosaraPolygonsBySample, singleGeneDataBySample, singleGeneWorldDataBySample, clusterMapsBySample, geneColorMap, selectedGenes, kosaraDataBySample, isDrawing, isTrajectoryMode, isAreaTooltipVisible, isAreaEditPopupVisible]);

    // Generate trajectory guideline layer
    const generateTrajectoryGuidelineLayer = useCallback(() => {
        if (!trajectoryGuideline || !trajectoryGuideline.visible || !trajectoryGuideline.sampleId) {
            return [];
        }

        // Find the sample that matches the trajectory guideline
        const targetSample = selectedSamples.find(sample => sample.id === trajectoryGuideline.sampleId);
        if (!targetSample) {
            return [];
        }

        const layers = [];

        // If trajectory info is provided, highlight the specific trajectory
        if (trajectoryGuideline.trajectoryInfo) {
            const { sample_id, region_id, trajectory_id } = trajectoryGuideline.trajectoryInfo;
            
            // Find matching trajectory in custom areas
            customAreas.forEach(area => {
                if (area.sampleId === sample_id && area.trajectories && area.trajectories.length > 0) {
                    area.trajectories.forEach(trajectory => {
                        // Match trajectory by region_id and trajectory_id
                        // If these properties don't exist on the trajectory, fall back to name-based matching
                        const shouldHighlight = 
                            (trajectory.region_id === region_id && trajectory.trajectory_id === trajectory_id) ||
                            (trajectory.name && trajectory.name.includes(`Region ${region_id}`) && trajectory.name.includes(`Trajectory ${trajectory_id}`)) ||
                            // If no specific matching criteria, highlight the first trajectory in the area (temporary fallback)
                            (!trajectory.region_id && !trajectory.trajectory_id && area.trajectories.indexOf(trajectory) === 0);
                        
                        if (shouldHighlight) {
                            const areaOffset = sampleOffsets[area.sampleId] || [0, 0];
                            const startPos = [trajectory.start[0] + areaOffset[0], trajectory.start[1] + areaOffset[1]];
                            const endPos = [trajectory.end[0] + areaOffset[0], trajectory.end[1] + areaOffset[1]];

                            // Calculate arrow direction and perpendicular direction
                            const dx = endPos[0] - startPos[0];
                            const dy = endPos[1] - startPos[1];
                            const length = Math.sqrt(dx * dx + dy * dy);

                            if (length > 0) {
                                const dirX = dx / length;
                                const dirY = dy / length;
                                const perpX = -dirY; // Perpendicular direction
                                const perpY = dirX;

                                // Calculate the position along the trajectory based on the normalized position from chart
                                // trajectoryGuideline.position is between 0 and 1
                                const t = trajectoryGuideline.position; // 0 = start, 1 = end
                                const trajectoryGuidelinePosition = [
                                    startPos[0] + (endPos[0] - startPos[0]) * t,
                                    startPos[1] + (endPos[1] - startPos[1]) * t
                                ];

                                // Add yellow transparent rectangle showing the trajectory width at this specific position
                                // This represents the actual analyze_trajectory width parameter
                                const trajectoryWidth = trajectory.width || 30; // Use trajectory width or default
                                const halfWidth = trajectoryWidth / 2;
                                const rectLength = 20; // Length along the trajectory direction
                                const halfRectLength = rectLength / 2;
                                
                                const yellowRect = [
                                    [trajectoryGuidelinePosition[0] - perpX * halfWidth - dirX * halfRectLength, trajectoryGuidelinePosition[1] - perpY * halfWidth - dirY * halfRectLength],
                                    [trajectoryGuidelinePosition[0] + perpX * halfWidth - dirX * halfRectLength, trajectoryGuidelinePosition[1] + perpY * halfWidth - dirY * halfRectLength],
                                    [trajectoryGuidelinePosition[0] + perpX * halfWidth + dirX * halfRectLength, trajectoryGuidelinePosition[1] + perpY * halfWidth + dirY * halfRectLength],
                                    [trajectoryGuidelinePosition[0] - perpX * halfWidth + dirX * halfRectLength, trajectoryGuidelinePosition[1] - perpY * halfWidth + dirY * halfRectLength]
                                ];

                                layers.push(new PolygonLayer({
                                    id: `trajectory-width-highlight-${trajectory.id}`,
                                    data: [{
                                        polygon: yellowRect
                                    }],
                                    getPolygon: d => d.polygon,
                                    getFillColor: [255, 255, 0, 150], // Yellow semi-transparent fill
                                    getLineColor: [255, 255, 0, 200], // Yellow outline
                                    getLineWidth: 2,
                                    lineWidthUnits: 'pixels',
                                    pickable: false,
                                }));
                            }
                        }
                    });
                }
            });
        }

        return layers;
    }, [trajectoryGuideline, selectedSamples, imageSizes, sampleOffsets, filteredCellData, coordinatesData, customAreas]);

    // Generate custom area layers
    const generateCustomAreaLayers = useCallback(() => {
        const layers = [];

        // Completed custom areas
        customAreas.forEach(area => {
            // Use editAreaColor for preview if this area is being edited, otherwise use original color
            const colorToUse = (isAreaEditPopupVisible && selectedAreaForEdit?.id === area.id)
                ? editAreaColor
                : area.color;
            const areaColor = convertHEXToRGB(colorToUse || '#ff0000');

            layers.push(new PolygonLayer({
                id: `custom-area-${area.id}`,
                data: [{ polygon: area.points, areaId: area.id }],
                getPolygon: d => d.polygon,
                getFillColor: [...areaColor, 50],
                getLineColor: [...areaColor, 200],
                getLineWidth: 2,
                lineWidthUnits: 'pixels',
                pickable: true,
                onClick: (info) => handleAreaClick(info),
            }));
        });

        // Current drawing visualization
        if ((isDrawing || isAreaTooltipVisible) && (drawingPoints.length > 0 || pendingArea)) {
            const pointsToShow = pendingArea ? pendingArea.points : drawingPoints;

            // When tooltip is visible, show the finalized area without animation effects
            if (isAreaTooltipVisible && pendingArea) {
                const pendingAreaColor = convertHEXToRGB(areaColor || pendingArea.color);
                layers.push(new PolygonLayer({
                    id: 'pending-area-preview',
                    data: [{ polygon: pendingArea.points }],
                    getPolygon: d => d.polygon,
                    getFillColor: [...pendingAreaColor, 50],
                    getLineColor: [...pendingAreaColor, 200],
                    getLineWidth: 2,
                    lineWidthUnits: 'pixels',
                    pickable: false,
                }));

                layers.push(new ScatterplotLayer({
                    id: 'pending-area-points',
                    data: pendingArea.points.map((point, index) => ({
                        position: point,
                        index
                    })),
                    getPosition: d => d.position,
                    getRadius: 4,
                    getFillColor: pendingAreaColor,
                    getLineColor: [0, 0, 0, 150],
                    getLineWidth: 1,
                    radiusUnits: 'pixels',
                    lineWidthUnits: 'pixels',
                    pickable: false,
                }));
            } else {
                // Draw completed points
                if (pointsToShow.length > 0) {
                    layers.push(new ScatterplotLayer({
                        id: 'drawing-points',
                        data: pointsToShow.map((point, index) => ({
                            position: point,
                            index,
                            isFirst: index === 0
                        })),
                        getPosition: d => d.position,
                        getRadius: d => {
                            if (d.isFirst && pointsToShow.length >= 3) {
                                // Make first point larger and pulsing when it can be snapped to
                                const shouldSnap = mousePosition && shouldSnapToFirst(mousePosition);
                                return shouldSnap ? 10 : 4;
                            }
                            return 5;
                        },
                        getFillColor: d => {
                            if (d.isFirst && pointsToShow.length >= 3) {
                                const shouldSnap = mousePosition && shouldSnapToFirst(mousePosition);
                                return shouldSnap ? [247, 37, 133, 255] : [247, 37, 133, 255];
                            }
                            return [247, 37, 133, 240];
                        },
                        getLineColor: d => {
                            if (d.isFirst && pointsToShow.length >= 3) {
                                const shouldSnap = mousePosition && shouldSnapToFirst(mousePosition);
                                return shouldSnap ? [247, 37, 133, 255] : [247, 37, 133, 255];
                            }
                            return [247, 37, 133, 255];
                        },
                        getLineWidth: d => d.isFirst && pointsToShow.length >= 3 ? 3 : 2,
                        radiusUnits: 'pixels',
                        lineWidthUnits: 'pixels',
                        pickable: false,
                    }));
                }

                // Draw lines connecting the points
                if (pointsToShow.length > 1) {
                    const lineSegments = [];
                    for (let i = 0; i < pointsToShow.length - 1; i++) {
                        lineSegments.push({
                            sourcePosition: pointsToShow[i],
                            targetPosition: pointsToShow[i + 1]
                        });
                    }

                    layers.push(new LineLayer({
                        id: 'drawing-lines',
                        data: lineSegments,
                        getSourcePosition: d => d.sourcePosition,
                        getTargetPosition: d => d.targetPosition,
                        getColor: [247, 37, 133, 240],
                        getWidth: 2,
                        widthUnits: 'pixels',
                        pickable: false,
                    }));
                }

                // Show polygon preview when we have at least 3 points
                if (pointsToShow.length >= 3) {
                    layers.push(new PolygonLayer({
                        id: 'drawing-preview',
                        data: [{ polygon: pointsToShow }],
                        getPolygon: d => d.polygon,
                        getFillColor: [247, 37, 133, 80],
                        getLineColor: [247, 37, 133, 0],
                        getLineWidth: 0,
                        pickable: false,
                    }));
                }
            }

            // Only show mouse interactions if still actively drawing (not just showing tooltip)
            if (isDrawing && !isAreaTooltipVisible) {
                // Draw mouse cursor when hovering
                if (mousePosition) {
                    const shouldSnap = shouldSnapToFirst(mousePosition);
                    layers.push(new ScatterplotLayer({
                        id: 'drawing-cursor',
                        data: [{ position: mousePosition }],
                        getPosition: d => d.position,
                        getRadius: shouldSnap ? 8 : 5,
                        getFillColor: shouldSnap ? [247, 37, 133, 235] : [247, 37, 133, 220],
                        getLineColor: shouldSnap ? [247, 37, 133, 255] : [247, 37, 133, 245],
                        getLineWidth: shouldSnap ? 3 : 1,
                        radiusUnits: 'pixels',
                        lineWidthUnits: 'pixels',
                        pickable: false,
                    }));

                    // Draw preview line from last point to mouse
                    if (drawingPoints.length > 0) {
                        const lastPoint = drawingPoints[drawingPoints.length - 1];
                        const targetPoint = shouldSnap ? drawingPoints[0] : mousePosition;

                        layers.push(new LineLayer({
                            id: 'drawing-preview-line',
                            data: [{
                                sourcePosition: lastPoint,
                                targetPosition: targetPoint
                            }],
                            getSourcePosition: d => d.sourcePosition,
                            getTargetPosition: d => d.targetPosition,
                            getColor: shouldSnap ? [247, 37, 133, 235] : [247, 37, 133, 220],
                            getWidth: shouldSnap ? 4 : 2,
                            widthUnits: 'pixels',
                            pickable: false,
                        }));
                    }

                    // Show snap zone indicator when close to first point
                    if (shouldSnap && drawingPoints.length >= 3) {
                        const firstPoint = drawingPoints[0];
                        layers.push(new ScatterplotLayer({
                            id: 'snap-zone-indicator',
                            data: [{ position: firstPoint }],
                            getPosition: d => d.position,
                            getRadius: 15,
                            getFillColor: [247, 37, 133, 110],
                            getLineColor: [247, 37, 133, 220],
                            getLineWidth: 2,
                            radiusUnits: 'pixels',
                            lineWidthUnits: 'pixels',
                            pickable: false,
                        }));
                    }
                }
            }
        }

        // Existing trajectories visualization
        customAreas.forEach(area => {
            if (area.trajectories && area.trajectories.length > 0) {
                area.trajectories.forEach(trajectory => {
                    // Stored trajectory coordinates are already in world space.
                    const startPos = trajectory.start;
                    const endPos = trajectory.end;

                    // Calculate arrow direction
                    const dx = endPos[0] - startPos[0];
                    const dy = endPos[1] - startPos[1];
                    const length = Math.sqrt(dx * dx + dy * dy);

                    if (length > 0) {
                        const dirX = dx / length;
                        const dirY = dy / length;

                        // Arrow head parameters
                        const arrowLength = 50;
                        const arrowWidth = 15;
                        const perpX = -dirY;
                        const perpY = dirX;

                        // Arrow head points
                        const arrowTip = endPos;
                        const arrowBase1 = [
                            endPos[0] - dirX * arrowLength - perpX * arrowWidth,
                            endPos[1] - dirY * arrowLength - perpY * arrowWidth
                        ];
                        const arrowBase2 = [
                            endPos[0] - dirX * arrowLength + perpX * arrowWidth,
                            endPos[1] - dirY * arrowLength + perpY * arrowWidth
                        ];

                        // Trajectory line (with hover for coverage display)
                        layers.push(new LineLayer({
                            id: `existing-trajectory-line-${trajectory.id}`,
                            data: [{
                                sourcePosition: startPos,
                                targetPosition: [endPos[0] - dirX * arrowLength * 0.3, endPos[1] - dirY * arrowLength * 0.3],
                                trajectory: trajectory,
                                trajectoryId: trajectory.id,
                                area: area,
                                startPos: startPos,
                                endPos: endPos
                            }],
                            getSourcePosition: d => d.sourcePosition,
                            getTargetPosition: d => d.targetPosition,
                            getColor: [0, 150, 255, 200], // Blue for existing trajectories
                            getWidth: 3,
                            widthUnits: 'pixels',
                            pickable: true
                        }));

                        // Arrow head (with hover for coverage display)
                        layers.push(new PolygonLayer({
                            id: `existing-trajectory-arrow-${trajectory.id}`,
                            data: [{
                                polygon: [arrowTip, arrowBase1, arrowBase2],
                                trajectory: trajectory,
                                trajectoryId: trajectory.id,
                                area: area,
                                startPos: startPos,
                                endPos: endPos
                            }],
                            getPolygon: d => d.polygon,
                            getFillColor: [0, 150, 255, 200],
                            getLineColor: [0, 100, 200, 255],
                            getLineWidth: 1,
                            lineWidthUnits: 'pixels',
                            pickable: true
                        }));
                    }
                });
            }
        });

        // Analyzing trajectories visualization (persist even when edit window is closed)
        analyzingTrajectories.forEach(analyzingTrajectory => {
            const area = customAreas.find(a => a.id === analyzingTrajectory.areaId);
            if (area) {
                // Analyzing trajectory coordinates are stored in world space and should not be offset again.
                const startPos = analyzingTrajectory.start;
                const endPos = analyzingTrajectory.end;

                // Calculate arrow direction
                const dx = endPos[0] - startPos[0];
                const dy = endPos[1] - startPos[1];
                const length = Math.sqrt(dx * dx + dy * dy);

                if (length > 0) {
                    const dirX = dx / length;
                    const dirY = dy / length;

                    // Arrow head parameters
                    const arrowLength = 50;
                    const arrowWidth = 15;
                    const perpX = -dirY;
                    const perpY = dirX;

                    // Arrow head points
                    const arrowTip = endPos;
                    const arrowBase1 = [
                        endPos[0] - dirX * arrowLength - perpX * arrowWidth,
                        endPos[1] - dirY * arrowLength - perpY * arrowWidth
                    ];
                    const arrowBase2 = [
                        endPos[0] - dirX * arrowLength + perpX * arrowWidth,
                        endPos[1] - dirY * arrowLength + perpY * arrowWidth
                    ];

                    // Trajectory line (red for analyzing)
                    layers.push(new LineLayer({
                        id: `analyzing-trajectory-line-${analyzingTrajectory.areaId}`,
                        data: [{
                            sourcePosition: startPos,
                            targetPosition: [endPos[0] - dirX * arrowLength * 0.3, endPos[1] - dirY * arrowLength * 0.3]
                        }],
                        getSourcePosition: d => d.sourcePosition,
                        getTargetPosition: d => d.targetPosition,
                        getColor: [255, 0, 0, 200], // Red for analyzing trajectories
                        getWidth: 3,
                        widthUnits: 'pixels',
                        pickable: false
                    }));

                    // Arrow head (red for analyzing)
                    layers.push(new PolygonLayer({
                        id: `analyzing-trajectory-arrow-${analyzingTrajectory.areaId}`,
                        data: [{
                            polygon: [arrowTip, arrowBase1, arrowBase2]
                        }],
                        getPolygon: d => d.polygon,
                        getFillColor: [255, 0, 0, 200], // Red for analyzing trajectories
                        getLineColor: [200, 0, 0, 255],
                        getLineWidth: 1,
                        lineWidthUnits: 'pixels',
                        pickable: false
                    }));
                }
            }
        });

        // Trajectory visualization layers
        if (isTrajectoryMode && selectedAreaForEdit) {
            // Show trajectory start point
            if (trajectoryStart) {
                layers.push(new ScatterplotLayer({
                    id: 'trajectory-start-point',
                    data: [{ position: trajectoryStart }],
                    getPosition: d => d.position,
                    getRadius: 3,
                    getFillColor: [255, 0, 0, 200], // Green for start
                    getLineColor: [0, 200, 0, 255],
                    getLineWidth: 2,
                    radiusUnits: 'pixels',
                    lineWidthUnits: 'pixels',
                    pickable: false,
                }));
            }

            // Show trajectory end point and arrow line
            if (trajectoryStart && trajectoryEnd) {
                // Calculate arrow direction and perpendicular vectors
                const dx = trajectoryEnd[0] - trajectoryStart[0];
                const dy = trajectoryEnd[1] - trajectoryStart[1];
                const length = Math.sqrt(dx * dx + dy * dy);

                if (length > 0) {
                    // Normalize direction vector
                    const dirX = dx / length;
                    const dirY = dy / length;

                    // Perpendicular vector
                    const perpX = -dirY;
                    const perpY = dirX;

                    // Arrow parameters
                    const arrowLength = 100; // Length of arrow head
                    const arrowWidth = 30; // Half width of arrow head

                    // Calculate arrow head points
                    const arrowTip = trajectoryEnd;
                    const arrowBase1 = [
                        trajectoryEnd[0] - dirX * arrowLength - perpX * arrowWidth,
                        trajectoryEnd[1] - dirY * arrowLength - perpY * arrowWidth
                    ];
                    const arrowBase2 = [
                        trajectoryEnd[0] - dirX * arrowLength + perpX * arrowWidth,
                        trajectoryEnd[1] - dirY * arrowLength + perpY * arrowWidth
                    ];

                    // Arrow head as a polygon
                    layers.push(new PolygonLayer({
                        id: 'trajectory-arrow-head',
                        data: [{ polygon: [arrowTip, arrowBase1, arrowBase2] }],
                        getPolygon: d => d.polygon,
                        getFillColor: isTrajectoryAnalyzing ? [255, 0, 0, 200] : [255, 0, 0, 200], // Red during drawing and analysis
                        getLineColor: isTrajectoryAnalyzing ? [200, 0, 0, 255] : [200, 0, 0, 255],
                        getLineWidth: 2,
                        lineWidthUnits: 'pixels',
                        pickable: false,
                    }));

                    // Adjust the main line to stop before the arrow head
                    const lineEnd = [
                        trajectoryEnd[0] - dirX * arrowLength * 0.3,
                        trajectoryEnd[1] - dirY * arrowLength * 0.3
                    ];

                    // Arrow line
                    layers.push(new LineLayer({
                        id: 'trajectory-arrow-line',
                        data: [{
                            sourcePosition: trajectoryStart,
                            targetPosition: lineEnd
                        }],
                        getSourcePosition: d => d.sourcePosition,
                        getTargetPosition: d => d.targetPosition,
                        getColor: isTrajectoryAnalyzing ? [255, 0, 0, 200] : [255, 0, 0, 200], // Red during drawing and analysis
                        getWidth: 3,
                        widthUnits: 'pixels',
                        pickable: false,
                    }));
                }
            }

            // Show arrow coverage area
            if (arrowCoverageArea) {
                layers.push(new PolygonLayer({
                    id: 'arrow-coverage-area',
                    data: [{ polygon: arrowCoverageArea.points }],
                    getPolygon: d => d.polygon,
                    getFillColor: [255, 255, 0, 100], // Semi-transparent yellow
                    getLineColor: [255, 200, 0, 200],
                    getLineWidth: 2,
                    lineWidthUnits: 'pixels',
                    pickable: false,
                }));
            }
        }

        // Show hovered trajectory coverage area
        if (hoveredTrajectory && hoveredTrajectory.trajectory && hoveredTrajectory.startPos && hoveredTrajectory.endPos) {
            const coverageArea = calculateSavedTrajectoryArrowCoverageArea(
                hoveredTrajectory.startPos,
                hoveredTrajectory.endPos,
                hoveredTrajectory.trajectory.width,
                hoveredTrajectory.area.points
            );

            if (coverageArea) {
                layers.push(new PolygonLayer({
                    id: 'hovered-trajectory-coverage-area',
                    data: [{ polygon: coverageArea.points }],
                    getPolygon: d => d.polygon,
                    getFillColor: [255, 255, 0, 100], // Semi-transparent yellow like in trajectory mode
                    getLineColor: [255, 200, 0, 200],
                    getLineWidth: 2,
                    lineWidthUnits: 'pixels',
                    pickable: false,
                }));
            }
        }

        return layers;
    }, [customAreas, isDrawing, isAreaTooltipVisible, drawingPoints, pendingArea, areaColor, currentDrawingSample, sampleOffsets, mousePosition, shouldSnapToFirst, isAreaEditPopupVisible, selectedAreaForEdit, editAreaColor, isTrajectoryMode, trajectoryStart, trajectoryEnd, arrowCoverageArea, hoveredTrajectory, calculateSavedTrajectoryArrowCoverageArea, isTrajectoryAnalyzing, analyzingTrajectories]);

    // Combine all layers
    const layers = useMemo(() => {
        // Build layers in stable order to prevent reordering artifacts
        const imgLayers = generateImageLayers();
        const cellLayers = generateCellLayers();
        const areaLayers = generateCustomAreaLayers();
        const guidelineLayers = generateTrajectoryGuidelineLayer();
        return [...imgLayers, ...areaLayers, ...cellLayers, ...guidelineLayers];
        // return [...imgLayers, ...areaLayers, ...guidelineLayers, ...guidelineLayers];
    }, [generateImageLayers, generateCellLayers, generateCustomAreaLayers, generateTrajectoryGuidelineLayer]);

    // Keep viewState keyed by view id after initialization.
    const deckViewState = useMemo(() => (
        mainViewState ? { main: mainViewState } : undefined
    ), [mainViewState]);

    useEffect(() => { kosaraLoadingSamplesRef.current = kosaraLoadingSamples; }, [kosaraLoadingSamples]);

    // Update radioCellGeneModes when selectedSamples changes
    useEffect(() => {
        setRadioCellGeneModes(prev => {
            const newModes = { ...prev };
            selectedSamples.forEach(sample => {
                if (!(sample.id in newModes)) {
                    newModes[sample.id] = 'cellTypes';
                }
            });
            return newModes;
        });

        // Initialize previous modes for new samples
        setPreviousModes(prev => {
            const newPreviousModes = { ...prev };
            selectedSamples.forEach(sample => {
                if (!(sample.id in newPreviousModes)) {
                    newPreviousModes[sample.id] = 'cellTypes';
                }
            });
            return newPreviousModes;
        });

        // Reset trajectory tracking when samples change to allow loading for new samples
        lastLoadedTrajectoryRef.current = null;
    }, [selectedSamples]);

    // Clear gene expression data when no genes are selected
    useEffect(() => {
        if (selectedGenes.length === 0) {
            // Clear both single gene and kosara data when no genes are selected
            setSingleGeneDataBySample({});
            setKosaraDataBySample({});
        }
    }, [selectedGenes]);

    // Clean up gene data for samples that are no longer selected
    useEffect(() => {
        const currentSampleIds = new Set(selectedSamples.map(s => s.id));

        // Clean up kosara data
        setKosaraDataBySample(prev => {
            const filtered = {};
            Object.keys(prev).forEach(sampleId => {
                if (currentSampleIds.has(sampleId)) {
                    filtered[sampleId] = prev[sampleId];
                }
            });
            return filtered;
        });

        // Clean up single gene data
        setSingleGeneDataBySample(prev => {
            const filtered = {};
            Object.keys(prev).forEach(sampleId => {
                if (currentSampleIds.has(sampleId)) {
                    filtered[sampleId] = prev[sampleId];
                }
            });
            return filtered;
        });

        // Clean up custom areas for samples that are no longer selected
        setCustomAreas(prev => prev.filter(area => currentSampleIds.has(area.sampleId)));
    }, [selectedSamples]);

    // Handle Kosara display toggle changes from parent
    // NOTE: This effect has been disabled to allow gene visualization regardless of kosaraDisplayEnabled flag
    // Gene data should always be displayed when available, independent of this toggle
    /*
    useEffect(() => {
        if (!kosaraDisplayEnabled) {
            // Reset trajectory tracking when kosara is disabled
            lastLoadedTrajectoryRef.current = null;

            // When Kosara display is turned OFF, save current state and restore previous state

            // Save current gene selections
            setPreviousGeneSelections(prev => ({ ...prev, current: selectedGenes }));
            setPreviousKosaraData(prev => ({ ...prev, current: kosaraDataBySample }));

            // Save current modes as previous modes for next time
            setPreviousModes(radioCellGeneModes);

            // Restore previous state or default to cellTypes
            const restoredModes = {};
            selectedSamples.forEach(sample => {
                restoredModes[sample.id] = previousModes[sample.id] || 'cellTypes';
            });
            setRadioCellGeneModes(restoredModes);

            // Clear current gene displays when kosara is disabled
            setSelectedGenes([]);
            setGeneColorMap({});
            setKosaraDataBySample({});
            setSingleGeneDataBySample({});
        } else {
            // When Kosara display is turned ON, restore saved current state

            // Save current state as previous
            setPreviousModes(radioCellGeneModes);

            // Restore the "current" state that was saved when we turned off Kosara
            if (previousGeneSelections.current) {
                setSelectedGenes(previousGeneSelections.current);
            }

            if (previousKosaraData.current) {
                setKosaraDataBySample(previousKosaraData.current);

                // Set modes back to genes if there was kosara data
                const restoredModes = {};
                selectedSamples.forEach(sample => {
                    if (previousKosaraData.current[sample.id]?.length > 0) {
                        restoredModes[sample.id] = 'genes';
                    } else {
                        restoredModes[sample.id] = radioCellGeneModes[sample.id];
                    }
                });
                setRadioCellGeneModes(restoredModes);
            }
        }
    }, [kosaraDisplayEnabled]);
    */

    // Handle trajectory gene selection changes
    useEffect(() => {
        if (trajectoryGenes.length > 0 && trajectoryGenesSample) {
            // Create a key to track the current trajectory selection
            const currentTrajectoryKey = `${trajectoryGenesSample}:${trajectoryGenes.sort().join(',')}`;

            // Only proceed if this is a new trajectory selection
            if (lastLoadedTrajectoryRef.current === currentTrajectoryKey) {
                return; // Skip if we've already loaded this exact combination
            }

            // Check if the trajectory genes sample matches any of our selected samples
            const matchingSample = selectedSamples.find(sample => sample.id === trajectoryGenesSample);
            if (matchingSample) {
                // Update the tracking reference
                lastLoadedTrajectoryRef.current = currentTrajectoryKey;

                // Update available genes and selected genes for the trajectory sample
                setAvailableGenes(trajectoryGenes);
                setSelectedGenes(trajectoryGenes);



                // Load data for the trajectory sample - use single gene mode if only one gene
                if (trajectoryGenes.length === 1) {
                    loadSingleGeneDataForSample(trajectoryGenesSample, trajectoryGenes[0]);
                } else {
                    loadKosaraDataForSample(trajectoryGenesSample, trajectoryGenes);
                }
            }
        }
    }, [trajectoryGenes, trajectoryGenesSample, selectedSamples]);

    // Preload high-res images for all selected samples
    useEffect(() => {
        let isMounted = true;

        // Reset callback flag when samples change
        imagesLoadedCallbackCalled.current = false;

        // Clean up images that are no longer needed
        setHiresImages(prev => {
            const currentSampleIds = new Set(selectedSamples.map(s => String(s.id)));
            const filteredImages = {};
            let changed = false;
            Object.keys(prev).forEach(sampleId => {
                if (currentSampleIds.has(sampleId)) {
                    filteredImages[sampleId] = prev[sampleId];
                } else {
                    changed = true;
                    // Revoke the object URL to free memory
                    try { URL.revokeObjectURL(prev[sampleId]); } catch (e) { }
                }
            });
            return changed ? filteredImages : prev;
        });

        setDecodedHiresImages(prev => {
            const currentSampleIds = new Set(selectedSamples.map(s => String(s.id)));
            const next = {};
            let changed = false;
            Object.keys(prev).forEach(sampleId => {
                if (currentSampleIds.has(sampleId)) {
                    next[sampleId] = prev[sampleId];
                } else {
                    changed = true;
                }
            });
            return changed ? next : prev;
        });

        Object.keys(preloadedImageRefs.current).forEach(sampleId => {
            if (!selectedSamples.some(sample => String(sample.id) === sampleId)) {
                delete preloadedImageRefs.current[sampleId];
            }
        });

        Object.keys(stableLayerImageBySampleRef.current).forEach(sampleId => {
            if (!selectedSamples.some(sample => String(sample.id) === sampleId)) {
                delete stableLayerImageBySampleRef.current[sampleId];
            }
        });

        selectedSamples.forEach(sample => {
            const sampleKey = String(sample.id);
            // Check if image is already loaded or currently being fetched
            setHiresImages(prev => {
                // If image is already loaded, don't fetch again
                if (prev[sampleKey]) {
                    return prev;
                }

                // If already fetching this image, don't start another request
                if (fetchingImages.current.has(sampleKey)) {
                    return prev;
                }

                // Mark as being fetched
                fetchingImages.current.add(sampleKey);

                // Start fetching asynchronously
                fetch('/api/get_hires_image', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sample_id: sample.id })
                })
                    .then(response => {
                        return response.ok ? response.blob() : null;
                    })
                    .then(blob => {
                        if (!isMounted) return;

                        if (!blob) {
                            setDecodedHiresImages(prev => ({ ...prev, [sampleKey]: false }));
                            return;
                        }

                        // Another request may have finished first for this sample.
                        if (hiresImagesRef.current[sampleKey]) {
                            setDecodedHiresImages(prev => (
                                prev[sampleKey] === true ? prev : { ...prev, [sampleKey]: true }
                            ));
                            return;
                        }

                        const imageUrl = URL.createObjectURL(blob);

                        // Make the image URL available for magnifier/fallback flows.
                        setHiresImages(currentState => {
                            if (currentState[sampleKey]) {
                                try { URL.revokeObjectURL(imageUrl); } catch (e) { }
                                return currentState;
                            }
                            return {
                                ...currentState,
                                [sampleKey]: imageUrl
                            };
                        });

                        // Preload the image into memory for instant display
                        const img = new Image();
                        img.onload = () => {
                            if (isMounted) {
                                // Store both URL and preloaded image reference
                                preloadedImageRefs.current[sampleKey] = img;
                                setDecodedHiresImages(prev => ({ ...prev, [sampleKey]: true }));
                            }
                        };
                        img.onerror = () => {
                            console.error(`Failed to preload image for ${sample.id}`);
                            if (isMounted) {
                                setDecodedHiresImages(prev => ({ ...prev, [sampleKey]: false }));
                            }
                        };
                        img.decoding = 'async';
                        img.src = imageUrl;
                    })
                    .catch(error => {
                        console.error(`Error fetching image for ${sample.id}:`, error);
                        if (isMounted) {
                            setDecodedHiresImages(prev => ({ ...prev, [sampleKey]: false }));
                        }
                    })
                    .finally(() => {
                        // Remove from fetching set when done
                        fetchingImages.current.delete(sampleKey);
                    });

                // Return current state immediately (fetch is async)
                return prev;
            });
        });

        return () => {
            isMounted = false;
        };
    }, [selectedSamples]);

    useEffect(() => {
        hiresImagesRef.current = hiresImages;
    }, [hiresImages]);

    useEffect(() => {
        selectedSamples.forEach(sample => {
            const sampleId = String(sample.id);
            const source = preloadedImageRefs.current[sampleId];
            if (source) {
                stableLayerImageBySampleRef.current[sampleId] = source;
            }
        });
    }, [selectedSamples, hiresImages, decodedHiresImages]);

    useEffect(() => {
        const currentSampleIds = new Set(selectedSamples.map(sample => String(sample.id)));
        minimapThumbnailJobsRef.current.forEach(sampleId => {
            if (!currentSampleIds.has(sampleId)) {
                minimapThumbnailJobsRef.current.delete(sampleId);
            }
        });

        setMinimapThumbnails(prev => {
            let changed = false;
            const next = {};
            Object.entries(prev).forEach(([sampleId, dataUrl]) => {
                if (currentSampleIds.has(sampleId)) {
                    next[sampleId] = dataUrl;
                } else {
                    changed = true;
                }
            });
            return changed ? next : prev;
        });
    }, [selectedSamples]);

    useEffect(() => {
        if (typeof document === 'undefined') return;

        const schedule = (fn) => {
            if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
                window.requestIdleCallback(fn, { timeout: 120 });
            } else {
                setTimeout(fn, 0);
            }
        };

        const createThumbnail = (sampleId, sourceImage) => {
            if (!sourceImage || !sourceImage.naturalWidth || !sourceImage.naturalHeight) return;

            const maxDimension = 220;
            const scale = Math.min(1, maxDimension / Math.max(sourceImage.naturalWidth, sourceImage.naturalHeight));
            const thumbWidth = Math.max(1, Math.round(sourceImage.naturalWidth * scale));
            const thumbHeight = Math.max(1, Math.round(sourceImage.naturalHeight * scale));

            const canvas = document.createElement('canvas');
            canvas.width = thumbWidth;
            canvas.height = thumbHeight;

            const ctx = canvas.getContext('2d', { alpha: false });
            if (!ctx) return;

            ctx.drawImage(sourceImage, 0, 0, thumbWidth, thumbHeight);
            const thumbnailDataUrl = canvas.toDataURL('image/jpeg', 0.72);

            setMinimapThumbnails(prev => {
                if (prev[sampleId] === thumbnailDataUrl) return prev;
                return {
                    ...prev,
                    [sampleId]: thumbnailDataUrl,
                };
            });
        };

        selectedSamples.forEach(sample => {
            const sampleId = sample.id;
            if (!decodedHiresImages[sampleId] || minimapThumbnails[sampleId] || minimapThumbnailJobsRef.current.has(sampleId)) {
                return;
            }

            minimapThumbnailJobsRef.current.add(sampleId);

            const finishJob = () => {
                minimapThumbnailJobsRef.current.delete(sampleId);
            };

            const cachedImage = preloadedImageRefs.current[sampleId];
            if (!cachedImage || !cachedImage.complete) {
                finishJob();
                return;
            }

            schedule(() => {
                createThumbnail(sampleId, cachedImage);
                finishJob();
            });
        });
    }, [selectedSamples, decodedHiresImages, minimapThumbnails]);

    // Check if all images are loaded and call callback
    useEffect(() => {
        if (!onImagesLoaded || imagesLoadedCallbackCalled.current) return;
        if (selectedSamples.length === 0) return;

        const allImageLayersReady = selectedSamples.every((sample) => {
            const sampleId = sample.id;
            const size = imageSizes[sampleId];
            const hasSize = Array.isArray(size) && size[0] > 0 && size[1] > 0;
            const decodeStatus = decodedHiresImages[sampleId];

            // true: image fully decoded and usable
            if (decodeStatus === true) {
                return Boolean(hiresImages[sampleId]) && hasSize;
            }

            // false: image failed to load/decode; treat as terminal so global loading can stop
            if (decodeStatus === false) {
                return hasSize;
            }

            // undefined: still in progress
            return false;
        });

        const isViewReady =
            Boolean(mainViewState) &&
            containerSize.width > 0 &&
            containerSize.height > 0;

        if (!allImageLayersReady || !isViewReady) return;

        let raf1 = null;
        let raf2 = null;

        raf1 = requestAnimationFrame(() => {
            raf2 = requestAnimationFrame(() => {
                if (imagesLoadedCallbackCalled.current) return;
                imagesLoadedCallbackCalled.current = true;
                onImagesLoaded();
            });
        });

        return () => {
            if (raf1) cancelAnimationFrame(raf1);
            if (raf2) cancelAnimationFrame(raf2);
        };
    }, [onImagesLoaded, selectedSamples, hiresImages, decodedHiresImages, imageSizes, mainViewState, containerSize.width, containerSize.height]);

    // Set container size
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const { width, height } = entry.contentRect;
                setContainerSize({ width, height });
            }
        });

        resizeObserver.observe(container);
        return () => resizeObserver.disconnect();
    }, []);

    // Get image sizes for selected samples
    useEffect(() => {
        if (selectedSamples.length === 0) {
            setImageSizes({});
            return;
        }

        const sampleIds = selectedSamples.map(sample => sample.id);

        // Fetch image sizes
        fetch('/api/get_hires_image_size', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sample_ids: sampleIds })
        })
            .then(res => res.json())
            .then(data => {
                setImageSizes(data);
            });
    }, [selectedSamples]);

    // Initialize modes(cell type or genes) for samples
    useEffect(() => {
        setRadioCellGeneModes(prev => {
            const newModes = {};
            selectedSamples.forEach(sample => {
                // Preserve existing mode if sample was already selected, otherwise default to 'cellTypes'
                newModes[sample.id] = prev[sample.id] || 'cellTypes';
            });
            return newModes;
        });
    }, [selectedSamples]);

    // Set initial view state when image sizes or offsets change
    useEffect(() => {
        if (!selectedSamples.length || !imageSizes[selectedSamples[0]?.id]) return;

        const firstSample = selectedSamples[0];
        const offset = sampleOffsets[firstSample.id] ?? [0, 0];
        const size = imageSizes[firstSample.id] ?? [0, 0];

        setMainViewState({
            target: [
                offset[0] + size[0] / 2,
                offset[1] + size[1] / 2,
                0
            ],
            zoom: -3,
            maxZoom: 2.5,
            minZoom: -5
        });
    }, [selectedSamples, imageSizes, sampleOffsets]);

    // Add keyboard event listener for both drawing and magnifier
    useEffect(() => {
        const handleKeyDown = (event) => {
            // Skip if user is typing in an input field
            if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') {
                return;
            }

            // Handle drawing keys
            handleKeyPress(event);

            // Handle magnifier keys
            if ((event.code === 'Space') && !keyPressed && !isDrawing) {
                event.preventDefault();
                event.stopPropagation();
                setKeyPressed(true);
                setMagnifierVisible(true);
            }
        };

        const handleKeyUp = (event) => {
            // Skip if user is typing in an input field
            if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') {
                return;
            }

            if ((event.code === 'Space') && keyPressed) {
                event.preventDefault();
                event.stopPropagation();
                setKeyPressed(false);
                setMagnifierVisible(false);
            }
        };

        document.addEventListener('keydown', handleKeyDown, true); // Use capture phase
        document.addEventListener('keyup', handleKeyUp, true); // Use capture phase

        return () => {
            document.removeEventListener('keydown', handleKeyDown, true);
            document.removeEventListener('keyup', handleKeyUp, true);
        };
    }, [handleKeyPress, keyPressed, isDrawing]);

    // Add native mouse event listener to ensure mouse position is always tracked
    useEffect(() => {
        const handleNativeMouseMove = (event) => {
            if (!containerRef.current || !mainViewState) return;
            if (!magnifierVisible) return;

            const rect = containerRef.current.getBoundingClientRect();
            const x = event.clientX - rect.left;
            const y = event.clientY - rect.top;

            // Convert screen coordinates to world coordinates using DeckGL's viewport
            try {
                // Create a viewport from the current view state
                const viewport = new OrthographicView({ id: 'main' }).makeViewport({
                    width: rect.width,
                    height: rect.height,
                    viewState: mainViewState
                });

                const worldCoords = viewport.unproject([x, y]);

                if (worldCoords && worldCoords.length >= 2) {
                    setMagnifierMousePos(prev => {
                        if (prev && prev.x === worldCoords[0] && prev.y === worldCoords[1]) return prev;
                        return { x: worldCoords[0], y: worldCoords[1] };
                    });
                }
            } catch (error) {
                // Silently ignore projection errors
            }
        };

        // Only add listener when magnifier is visible (avoid per-frame re-renders otherwise)
        if (containerRef.current && magnifierVisible) {
            containerRef.current.addEventListener('mousemove', handleNativeMouseMove);
            return () => {
                if (containerRef.current) {
                    containerRef.current.removeEventListener('mousemove', handleNativeMouseMove);
                }
            };
        }
    }, [mainViewState, magnifierVisible]);

    // Initialize magnifier position when it becomes visible
    useEffect(() => {
        if (magnifierVisible && !isDrawing && mainViewState && selectedSamples.length > 0) {
            // Try to use current mouse position first
            if (magnifierMousePos && magnifierMousePos.x !== undefined && magnifierMousePos.y !== undefined) {
                const hoveredSample = getSampleAtCoordinate(magnifierMousePos.x, magnifierMousePos.y);
                if (hoveredSample) {
                    // Use current mouse position
                    updateMagnifierViewport(magnifierMousePos.x, magnifierMousePos.y, hoveredSample);
                    return;
                }
            }

            // Fallback: Initialize magnifier at the center of the first sample only if no mouse position
            const firstSample = selectedSamples[0];
            const offset = sampleOffsets[firstSample.id] ?? [0, 0];
            const size = imageSizes[firstSample.id] ?? [0, 0];

            if (size[0] > 0 && size[1] > 0) {
                const centerX = offset[0] + size[0] / 2;
                const centerY = offset[1] + size[1] / 2;

                // Update magnifier position
                updateMagnifierViewport(centerX, centerY, firstSample.id);
            }
        }
    }, [magnifierVisible, isDrawing, mainViewState, selectedSamples, sampleOffsets, imageSizes, updateMagnifierViewport, magnifierMousePos, getSampleAtCoordinate]);

    // Cleanup effect for magnifier and images
    useEffect(() => {
        return () => {
            Object.values(hiresImagesRef.current).forEach(url => {
                try { URL.revokeObjectURL(url); } catch (e) { }
            });

            // Clear preloaded image references
            preloadedImageRefs.current = {};

            if (viewStateRafRef.current) {
                cancelAnimationFrame(viewStateRafRef.current);
                viewStateRafRef.current = null;
            }
            viewStatePendingRef.current = null;
        };
    }, []);

    // In handleMouseMove, update magnifier logic to use hiresImages
    useEffect(() => {
        if (!magnifierVisible || isDrawing || isAreaTooltipVisible || isAreaEditPopupVisible) {
            setMagnifierData(prev => (prev === null ? prev : null));
            return;
        }

        if (!magnifierMousePos || !selectedSamples.length) {
            setMagnifierData(prev => (prev === null ? prev : null));
            return;
        }

        const { x: worldX, y: worldY } = magnifierMousePos;
        const hoveredSample = getSampleAtCoordinate(worldX, worldY);

        if (hoveredSample && imageSizes[hoveredSample]) {
            const imageUrl = hiresImages[hoveredSample];
            const size = imageSizes[hoveredSample];
            if (!imageUrl) {
                setMagnifierData(prev => (prev === null ? prev : null));
            } else {
                setMagnifierData(prev => {
                    if (
                        prev &&
                        prev.sampleId === hoveredSample &&
                        prev.imageUrl === imageUrl &&
                        prev.imageSize && size &&
                        prev.imageSize[0] === size[0] &&
                        prev.imageSize[1] === size[1]
                    ) {
                        return prev;
                    }
                    return {
                        imageUrl,
                        sampleId: hoveredSample,
                        imageSize: size
                    };
                });
            }
        } else {
            setMagnifierData(prev => (prev === null ? prev : null));
        }
    }, [magnifierVisible, magnifierMousePos, selectedSamples, hiresImages, imageSizes, isDrawing, isAreaTooltipVisible, isAreaEditPopupVisible, getSampleAtCoordinate]);

    useEffect(() => {
        const currentUrl = magnifierData?.imageUrl || null;
        const currentSampleId = magnifierData?.sampleId || null;

        if (!magnifierVisible) {
            // When hidden, clear loaded flag (spinner hidden by visibility anyway)
            if (magnifierImageLoaded) setMagnifierImageLoaded(false);
            prevMagnifierUrlRef.current = null; // Reset to force reload on next open
            return;
        }
        // Visible: reset loading state whenever URL changes OR when becoming visible for the first time
        if (prevMagnifierUrlRef.current !== currentUrl) {
            prevMagnifierUrlRef.current = currentUrl;
            if (currentUrl) {
                // Check if image is already preloaded - if so, mark as loaded immediately
                if (currentSampleId && preloadedImageRefs.current[currentSampleId]) {
                    setMagnifierImageLoaded(true);
                } else {
                    setMagnifierImageLoaded(false);
                }
                setMagnifierImageVersion(v => v + 1); // trigger remount so onLoad always fires
            }
        }
    }, [magnifierVisible, magnifierData?.imageUrl, magnifierData?.sampleId, magnifierImageLoaded]);

    // Fallback initialize magnifierData if visible but not yet set (ensures spinner/image sequence shows)
    useEffect(() => {
        if (!magnifierVisible) return;
        if (magnifierData) return;
        if (!selectedSamples.length) return;
        const firstSample = selectedSamples[0];
        const imgUrl = hiresImages[firstSample.id];
        const size = imageSizes[firstSample.id];
        if (imgUrl && size) {
            // Check if image is already preloaded - if so, mark as loaded immediately
            const isPreloaded = preloadedImageRefs.current[firstSample.id] !== undefined;
            setMagnifierImageLoaded(isPreloaded);
            setMagnifierData({ imageUrl: imgUrl, sampleId: firstSample.id, imageSize: size });
            setMagnifierImageVersion(v => v + 1);
        }
    }, [magnifierVisible, magnifierData, selectedSamples, hiresImages, imageSizes]);

    // Render preloaded image to canvas for instant display
    useEffect(() => {
        if (!magnifierVisible || !magnifierData || !magnifierCanvasRef.current) return;

        const canvas = magnifierCanvasRef.current;
        const ctx = canvas.getContext('2d');
        const { sampleId, imageSize, imageUrl } = magnifierData;
        const preloadedImg = preloadedImageRefs.current[sampleId];

        if (!imageSize) return;

        // If image is preloaded, draw it immediately
        if (preloadedImg && preloadedImg.complete) {
            // Clear canvas
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            // Calculate the portion of the image to display based on viewport
            const sourceX = magnifierViewport.x * preloadedImg.naturalWidth;
            const sourceY = magnifierViewport.y * preloadedImg.naturalHeight;
            const sourceWidth = canvas.width / 2; // Show a portion based on zoom level
            const sourceHeight = canvas.height / 2;

            // Draw the image portion to fill the entire canvas
            try {
                ctx.drawImage(
                    preloadedImg,
                    Math.max(0, sourceX - sourceWidth / 2),
                    Math.max(0, sourceY - sourceHeight / 2),
                    Math.min(sourceWidth, preloadedImg.naturalWidth),
                    Math.min(sourceHeight, preloadedImg.naturalHeight),
                    0,
                    0,
                    canvas.width,
                    canvas.height
                );

                // Mark as loaded
                setMagnifierImageLoaded(true);
            } catch (error) {
                console.error('Error drawing to canvas:', error);
            }
        } else if (imageUrl) {
            // If not preloaded, create and load the image
            const img = new Image();
            img.onload = () => {
                // Store in preloaded refs for next time
                preloadedImageRefs.current[sampleId] = img;

                // Clear canvas
                ctx.clearRect(0, 0, canvas.width, canvas.height);

                // Calculate the portion of the image to display based on viewport
                const sourceX = magnifierViewport.x * img.naturalWidth;
                const sourceY = magnifierViewport.y * img.naturalHeight;
                const sourceWidth = canvas.width / 2;
                const sourceHeight = canvas.height / 2;

                // Draw the image
                try {
                    ctx.drawImage(
                        img,
                        Math.max(0, sourceX - sourceWidth / 2),
                        Math.max(0, sourceY - sourceHeight / 2),
                        Math.min(sourceWidth, img.naturalWidth),
                        Math.min(sourceHeight, img.naturalHeight),
                        0,
                        0,
                        canvas.width,
                        canvas.height
                    );

                    // Mark as loaded
                    setMagnifierImageLoaded(true);
                } catch (error) {
                    console.error('Error drawing to canvas:', error);
                }
            };
            img.onerror = () => {
                console.error('Failed to load magnifier image');
                setMagnifierImageLoaded(true); // Hide spinner even on error
            };
            img.src = imageUrl;
        }
    }, [magnifierVisible, magnifierData, magnifierViewport]);

    return (
        <div style={{ width: '100%', height: '100%', position: 'relative' }}>
            {/* Main content */}
            <div
                ref={containerRef}
                style={{
                    width: '100%',
                    height: '100%',
                    position: 'relative',
                    overflow: 'hidden'
                }}
            >
                <DeckGL
                    layers={layers}
                    views={[mainView]}
                    viewState={deckViewState}
                    onViewStateChange={handleViewStateChange}
                    useDevicePixels={deckUseDevicePixels}
                    onClick={handleMapClick}
                    onHover={(info, event) => {
                        // Preserve existing mouse-move behavior (drawing preview / magnifier)
                        handleMouseMove(info);

                        // Avoid hover-driven React updates while dragging (pan/zoom)
                        if (event?.isDragging) {
                            hoverPendingRef.current = { hoveredCell: null, hoveredTrajectory: null, hoverKey: null };
                        } else {
                            // Trajectory hover for coverage area display
                            let nextHoveredTrajectory = null;
                            if (info && info.object && info.layer && info.layer.id) {
                                const layerId = info.layer.id;
                                if (layerId.includes('existing-trajectory-line-') || layerId.includes('existing-trajectory-arrow-')) {
                                    if (info.picked && info.object.trajectory) {
                                        nextHoveredTrajectory = {
                                            trajectory: info.object.trajectory,
                                            area: info.object.area,
                                            startPos: info.object.startPos,
                                            endPos: info.object.endPos
                                        };
                                    }
                                }
                            }

                            // Tooltip for cells and kosara polygons
                            let nextHoveredCell = null;
                            let hoverKey = null;
                            if (info && info.object && info.layer && info.layer.id && info.picked) {
                                const layerId = info.layer.id;
                                if (layerId.startsWith('kosara-polygons-')) {
                                    const sampleId = layerId.replace('kosara-polygons-', '');
                                    const { id, cell_type, ratios, total_expression } = info.object || {};
                                    nextHoveredCell = {
                                        id,
                                        sampleId,
                                        cell_type,
                                        ratios,
                                        total_expression,
                                        x: info.x,
                                        y: info.y
                                    };
                                    hoverKey = `kosara:${sampleId}:${String(id)}`;
                                } else if (layerId.startsWith('single-gene-expression-')) {
                                    const sampleId = layerId.replace('single-gene-expression-', '');
                                    const { id, cell_type, expression } = info.object || {};
                                    const geneName = singleGeneDataBySample[sampleId]?.geneName;
                                    nextHoveredCell = {
                                        id,
                                        sampleId,
                                        cell_type,
                                        expression,
                                        geneName,
                                        x: info.x,
                                        y: info.y
                                    };
                                    hoverKey = `singleGene:${sampleId}:${String(id)}:${geneName || ''}`;
                                } else if (layerId.startsWith('cells-')) {
                                    const sampleId = layerId.split('-')[1];
                                    const { id, cell_type } = info.object || {};
                                    nextHoveredCell = {
                                        id,
                                        sampleId,
                                        cell_type,
                                        x: info.x,
                                        y: info.y
                                    };
                                    hoverKey = `cell:${sampleId}:${String(id)}`;
                                }
                            }

                            hoverPendingRef.current = { hoveredCell: nextHoveredCell, hoveredTrajectory: nextHoveredTrajectory, hoverKey };
                        }

                        if (hoverRafRef.current == null) {
                            hoverRafRef.current = requestAnimationFrame(() => {
                                hoverRafRef.current = null;
                                const pending = hoverPendingRef.current;
                                hoverPendingRef.current = null;
                                if (!pending) return;

                                // Skip updating state if we're still on the same object
                                if (pending.hoverKey === lastHoverKeyRef.current) {
                                    if (pending.hoveredTrajectory === null) {
                                        setHoveredTrajectory(prev => (prev === null ? prev : null));
                                    } else {
                                        setHoveredTrajectory(prev => {
                                            if (!prev) return pending.hoveredTrajectory;
                                            const prevId = prev?.trajectory?.id;
                                            const nextId = pending.hoveredTrajectory?.trajectory?.id;
                                            if (prevId && nextId && prevId === nextId) return prev;
                                            return pending.hoveredTrajectory;
                                        });
                                    }
                                    return;
                                }

                                lastHoverKeyRef.current = pending.hoverKey;
                                setHoveredCell(pending.hoveredCell);
                                setHoveredTrajectory(pending.hoveredTrajectory);
                            });
                        }
                    }}
                    controller={deckController}
                    getCursor={({ isHovering, isDragging }) => {
                        if (isAreaTooltipVisible || isAreaEditPopupVisible) {
                            return 'default';
                        }
                        if (isTrajectoryMode) {
                            return 'crosshair';
                        }
                        if (isDrawing) {
                            if (mousePosition && shouldSnapToFirst(mousePosition)) {
                                return 'pointer';
                            }
                            return 'crosshair';
                        }
                        return isHovering ? 'pointer' : 'grab';
                    }}
                />

                {hoveredCell && (
                    <div style={{
                        position: 'absolute',
                        left: hoveredCell.x + 12,
                        top: hoveredCell.y - 40,
                        pointerEvents: 'none',
                        backgroundColor: 'rgba(255, 255, 255, 0.9)',
                        padding: 8,
                        borderRadius: 4,
                        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                        transform: 'none',
                        whiteSpace: 'nowrap',
                        willChange: 'left, top',
                        fontSize: 12,
                        zIndex: 1000,
                        textAlign: 'left'
                    }}>
                        {hoveredCell.id ? (
                            <>
                                <div><strong>Sample:</strong> {hoveredCell.sampleId}</div>
                                <div><strong>Cell Type:</strong> {hoveredCell.cell_type}</div>
                                {hoveredCell.geneName && (
                                    <div><strong>Gene:</strong> {hoveredCell.geneName}</div>
                                )}
                                {hoveredCell.expression !== undefined && (
                                    <div><strong>Expression:</strong> {Number(hoveredCell.expression).toFixed(3)}</div>
                                )}
                                {hoveredCell.total_expression !== undefined && (
                                    <div><strong>Total Expression:</strong> {Number(hoveredCell.total_expression).toFixed(3)}</div>
                                )}
                                {hoveredCell.ratios && Object.entries(hoveredCell.ratios).map(([gene, expression]) => (
                                    <div key={gene}><strong>{gene}:</strong> {Number(expression).toFixed(3) * 100}%</div>
                                ))}
                            </>
                        ) : (
                            <>
                                <div>Sample: {hoveredCell.sampleId}</div>
                                <div>Cell Type: {hoveredCell.cell_type}</div>
                            </>
                        )}
                    </div>
                )}

                {/* Sample controls */}
                <div style={{
                    position: 'absolute',
                    top: minimapVisible ? 170 : 10,
                    left: 10,
                    zIndex: 20,
                    transition: 'top 0.3s ease-in-out'
                }}>
                    <Collapse
                        items={collapseItems}
                        defaultActiveKey={[selectedSamples[0]?.id]}
                        style={{ background: '#ffffff', width: 300, opacity: 0.9 }}
                    />
                </div>

                {/* Global Drawing Control */}
                <div style={{ position: 'absolute', top: 10, right: 10, zIndex: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                        {/* Reset View Button */}
                        <Button
                            size="big"
                            onClick={resetView}
                            style={{
                                boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center'
                            }}
                            icon={<RedoOutlined style={{ fontSize: '18px' }} />}
                            title="Reset view to initial position and zoom"
                        />

                        {/* Minimap Toggle Button */}
                        <Button
                            size="big"
                            type={minimapVisible ? "primary" : "default"}
                            onClick={toggleMinimapVisible}
                            style={{
                                boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center'
                            }}
                            icon={<BorderOutlined style={{ fontSize: '18px' }} />}
                            title={minimapVisible ? 'Hide minimap' : 'Show minimap'}
                        />

                        {/* Drawing Toggle Button */}
                        <Button
                            size="big"
                            type={isDrawing ? "primary" : "default"}
                            onClick={toggleDrawingMode}
                            style={{
                                boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center'
                            }}
                            icon={<EditOutlined style={{ fontSize: '18px' }} />}
                            title={isDrawing ? 'Click to finish/cancel drawing' : 'Click to start drawing areas'}
                        />
                    </div>

                    {/* Keyboard Shortcuts Panel */}
                    <div style={{
                        opacity: isDrawing ? 1 : 0,
                        visibility: isDrawing ? 'visible' : 'hidden',
                        transform: isDrawing ? 'translateY(0)' : 'translateY(-10px)',
                        transition: 'opacity 0.3s ease-in-out, visibility 0.3s ease-in-out, transform 0.3s ease-in-out',
                        backgroundColor: 'rgba(255, 255, 255, 0.8)',
                        color: '#000000',
                        padding: '8px 12px',
                        borderRadius: 6,
                        fontSize: '12px',
                        lineHeight: '1.4',
                        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.2)',
                        minWidth: '200px',
                        textAlign: 'left'
                    }}>
                        <div style={{ fontWeight: 'bold', marginBottom: 4 }}>Drawing Shortcuts:</div>
                        <div style={{ marginBottom: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                            <kbd style={{
                                backgroundColor: 'rgba(0, 0, 0, 0.1)',
                                padding: '2px 4px',
                                borderRadius: 3,
                                fontSize: '11px',
                            }}>Enter</kbd>
                            <span>Finish drawing</span>
                        </div>
                        <div style={{ marginBottom: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                            <kbd style={{
                                backgroundColor: 'rgba(0, 0, 0, 0.1)',
                                padding: '2px 4px',
                                borderRadius: 3,
                                fontSize: '11px'
                            }}>Esc</kbd>
                            <span>Cancel drawing</span>
                        </div>
                        <div style={{ marginBottom: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                            <kbd style={{
                                backgroundColor: 'rgba(0, 0, 0, 0.1)',
                                padding: '2px 4px',
                                borderRadius: 3,
                                fontSize: '11px'
                            }}>Backspace</kbd>
                            <span>Undo last point</span>
                        </div>
                    </div>
                </div>

                {/* Area Customization Tooltip */}
                {isAreaTooltipVisible && pendingArea && (
                    <>
                        {/* Overlay to prevent interactions with the map */}
                        <div
                            style={{
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                right: 0,
                                bottom: 0,
                                zIndex: 999,
                                backgroundColor: 'rgba(0, 0, 0, 0.1)',
                                cursor: 'default',
                                pointerEvents: 'auto'
                            }}
                            onClick={(e) => e.stopPropagation()}
                        />

                        <div
                            style={{
                                position: 'fixed',
                                left: getTempAreaCompleteTooltipPosition().left,
                                top: getTempAreaCompleteTooltipPosition().top,
                                zIndex: 1000,
                                background: '#ffffff',
                                border: '1px solid #d9d9d9',
                                borderRadius: 8,
                                boxShadow: '0 6px 16px rgba(0, 0, 0, 0.12)',
                                padding: 12,
                                minWidth: 240,
                                maxWidth: 280,
                                pointerEvents: 'auto'
                            }}
                        >
                            {/* Close button */}
                            <div style={{
                                position: 'absolute',
                                top: 8,
                                right: 8,
                                cursor: 'pointer',
                                padding: 4,
                                borderRadius: 4,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center'
                            }}
                                onClick={handleAreaTooltipCancel}
                                onMouseEnter={(e) => e.target.style.backgroundColor = '#f5f5f5'}
                                onMouseLeave={(e) => e.target.style.backgroundColor = 'transparent'}
                            >
                                <CloseOutlined style={{ fontSize: 12, color: '#666' }} />
                            </div>

                            {/* Title */}
                            <div style={{
                                fontWeight: 'bold',
                                marginBottom: 5,
                                fontSize: 14,
                                color: '#262626',
                                paddingRight: 20,
                                textAlign: 'left'
                            }}>
                                Customize Area
                            </div>

                            {/* Area Name Input */}
                            <div style={{ marginBottom: 8 }}>
                                <label style={{
                                    display: 'block',
                                    marginBottom: 6,
                                    fontSize: 12,
                                    fontWeight: 500,
                                    color: '#595959',
                                    textAlign: 'left'
                                }}>
                                    Area Name:
                                </label>
                                <Input
                                    value={areaName}
                                    onChange={(e) => setAreaName(e.target.value)}
                                    placeholder="Enter area name"
                                    maxLength={50}
                                    size="small"
                                />
                            </div>

                            {/* Color Picker */}
                            <div style={{ marginBottom: 8 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <label style={{
                                        fontSize: 12,
                                        fontWeight: 500,
                                        color: '#595959',
                                        minWidth: 'fit-content'
                                    }}>
                                        Area Color:
                                    </label>
                                    <ColorPicker
                                        value={areaColor}
                                        onChange={(color) => setAreaColor(color.toHexString())}
                                        size="small"
                                    />
                                </div>
                            </div>

                            {/* Action Buttons */}
                            <div style={{ display: 'flex', gap: 5, justifyContent: 'flex-end' }}>
                                <Button
                                    size="small"
                                    color="pink"
                                    variant="solid"
                                    onClick={handleAreaTooltipSave}
                                >
                                    Save Area
                                </Button>
                            </div>
                        </div>
                    </>
                )}

                {/* Minimap */}
                {(minimapVisible || minimapAnimating) && selectedSamples.length > 0 && (
                    <div
                        style={{
                            position: 'absolute',
                            top: 10,
                            left: 10,
                            width: 296,
                            height: 150,
                            zIndex: 15,
                            backgroundColor: 'rgba(255, 255, 255, 0.9)',
                            border: '2px solid #d9d9d9',
                            borderRadius: 8,
                            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
                            overflow: 'hidden',
                            cursor: 'pointer',
                            opacity: minimapVisible ? 1 : 0,
                            transition: 'opacity 0.3s ease-in-out, transform 0.3s ease-in-out',
                            transform: minimapVisible ? 'translateY(0) scale(1)' : 'translateY(20px) scale(0.95)',
                            pointerEvents: minimapVisible ? 'auto' : 'none'
                        }}
                        ref={minimapRef}
                        onClick={handleMinimapClick}
                    >
                        {/* Minimap background - composite view for multiple samples */}
                        <div style={{
                            width: '100%',
                            height: '100%',
                            position: 'relative',
                            backgroundColor: '#f0f0f0'
                        }}>
                            {minimapTilesContent}
                        </div>

                        {/* Viewport indicator */}
                        {(() => {
                            const viewportBounds = getMinimapViewportBounds();
                            if (!viewportBounds) return null;
                            const left = viewportBounds.left * 100;
                            const top = viewportBounds.top * 100;
                            const width = (viewportBounds.right - viewportBounds.left) * 100;
                            const height = (viewportBounds.bottom - viewportBounds.top) * 100;

                            return (
                                <div
                                    style={{
                                        position: 'absolute',
                                        left: `${Math.max(0, Math.min(100, left))}%`,
                                        top: `${Math.max(0, Math.min(100, top))}%`,
                                        width: `${Math.max(0, Math.min(100 - left, width))}%`,
                                        height: `${Math.max(0, Math.min(100 - top, height))}%`,
                                        border: '2px solid #1890ff',
                                        backgroundColor: 'rgba(24, 144, 255, 0.2)',
                                        pointerEvents: 'none',
                                        boxSizing: 'border-box',
                                        zIndex: 10
                                    }}
                                />
                            );
                        })()}

                        {/* Close button */}
                        <div
                            style={{
                                position: 'absolute',
                                top: 4,
                                right: 4,
                                width: 18,
                                height: 18,
                                backgroundColor: 'rgba(255, 255, 255, 0.9)',
                                border: '1px solid #d9d9d9',
                                borderRadius: 3,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                cursor: 'pointer',
                                fontSize: 12,
                                color: '#666'
                            }}
                            onClick={(e) => {
                                e.stopPropagation();
                                toggleMinimapVisible();
                            }}
                            onMouseEnter={(e) => e.target.style.backgroundColor = 'rgba(245, 245, 245, 0.9)'}
                            onMouseLeave={(e) => e.target.style.backgroundColor = 'rgba(255, 255, 255, 0.9)'}
                        >
                            <CloseOutlined style={{ fontSize: 8, color: '#666' }} />
                        </div>
                    </div>
                )}

                {/* Magnifying Glass */}
                {magnifierVisible && (
                    <div
                        ref={magnifierRef}
                        style={{
                            position: 'absolute',
                            bottom: 10,
                            left: 10,
                            width: 300,
                            height: 300,
                            zIndex: 15,
                            backgroundColor: 'rgba(255, 255, 255, 0.95)',
                            border: '2px solid #1890ff',
                            borderRadius: 8,
                            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.2)',
                            overflow: 'hidden',
                            opacity: magnifierVisible ? 1 : 0,
                            transition: 'opacity 0.2s ease-in-out',
                            pointerEvents: 'none' // allow underlying map to keep receiving hover events
                        }}
                    >
                        {/* Header */}
                        <div style={{
                            padding: '6px 12px',
                            borderBottom: '1px solid #e8e8e8',
                            fontSize: '11px',
                            fontWeight: 'bold',
                            color: '#262626',
                            backgroundColor: '#f0f8ff',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            pointerEvents: 'auto' // header still interactive if needed
                        }}>
                            <span>Magnifier - {magnifierData?.sampleId || ''}</span>
                            <span style={{ fontSize: '9px', color: '#666' }}>
                                Hold Space
                            </span>
                        </div>

                        {/* Magnifier View */}
                        <div style={{
                            position: 'relative',
                            width: '100%',
                            height: 280,
                            overflow: 'hidden',
                            backgroundColor: '#ffffff',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                        }}>
                            {/* Canvas for instant image rendering */}
                            {magnifierData && (
                                <canvas
                                    ref={magnifierCanvasRef}
                                    width={300}
                                    height={280}
                                    style={{
                                        position: 'absolute',
                                        left: 0,
                                        top: 0,
                                        width: '100%',
                                        height: '100%',
                                        imageRendering: 'crisp-edges',
                                        opacity: magnifierImageLoaded ? 1 : 0,
                                        transition: 'opacity 0.2s'
                                    }}
                                />
                            )}

                            {/* Spinner overlay while loading */}
                            {magnifierVisible && !magnifierImageLoaded && (
                                <div style={{
                                    position: 'absolute',
                                    inset: 0,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    background: 'rgba(255,255,255,0.8)',
                                    zIndex: 9999,
                                    pointerEvents: 'none'
                                }}>
                                    <Spin />
                                </div>
                            )}

                            {/* Crosshairs always visible */}
                            <div style={{
                                position: 'absolute',
                                left: 150,
                                top: 0,
                                width: 1,
                                height: '100%',
                                backgroundColor: '#ff4d4f',
                                pointerEvents: 'none',
                                boxShadow: '0 0 2px rgba(0,0,0,0.5)',
                                zIndex: 4
                            }} />
                            <div style={{
                                position: 'absolute',
                                left: 0,
                                top: 140,
                                width: '100%',
                                height: 1,
                                backgroundColor: '#ff4d4f',
                                pointerEvents: 'none',
                                boxShadow: '0 0 2px rgba(0,0,0,0.5)',
                                zIndex: 4
                            }} />
                            <div style={{
                                position: 'absolute',
                                left: 147,
                                top: 137,
                                width: 6,
                                height: 6,
                                borderRadius: '50%',
                                backgroundColor: '#ff4d4f',
                                border: '1px solid white',
                                pointerEvents: 'none',
                                boxShadow: '0 0 4px rgba(0,0,0,0.5)',
                                zIndex: 5
                            }} />
                            {/* Coordinates indicator */}
                            <div style={{
                                position: 'absolute',
                                bottom: 15,
                                right: 5,
                                padding: '2px 6px',
                                backgroundColor: 'rgba(0, 0, 0, 0.7)',
                                color: 'white',
                                fontSize: '9px',
                                borderRadius: 3,
                                fontFamily: 'monospace'
                            }}>
                                X: {Math.round(magnifierMousePos?.x || 0)} Y: {Math.round(magnifierMousePos?.y || 0)}
                            </div>
                        </div>
                    </div>
                )}

                {/* Area Edit/Delete Popup */}
                {isAreaEditPopupVisible && selectedAreaForEdit && (
                    <>
                        {/* Overlay to prevent interactions with the map */}
                        <div
                            style={{
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                right: 0,
                                bottom: 0,
                                zIndex: 999,
                                backgroundColor: 'rgba(0, 0, 0, 0.1)',
                                cursor: 'default',
                                pointerEvents: isTrajectoryMode ? 'none' : 'auto'
                            }}
                            onClick={(e) => {
                                if (!isTrajectoryMode) {
                                    e.stopPropagation();
                                    handleAreaEditCancel();
                                }
                            }}
                        />

                        <div
                            ref={areaEditPopupRef}
                            style={{
                                position: 'fixed',
                                left: editPopupPosition.x,
                                top: editPopupPosition.y,
                                zIndex: 1000,
                                background: '#ffffff',
                                border: '1px solid #d9d9d9',
                                borderRadius: 8,
                                boxShadow: '0 6px 16px rgba(0, 0, 0, 0.12)',
                                padding: 12,
                                width: 280,
                                maxHeight: 'calc(100vh - 20px)',
                                overflowY: 'auto',
                                pointerEvents: 'auto'
                            }}
                        >
                            {/* Close button */}
                            <div style={{
                                position: 'absolute',
                                top: 8,
                                right: 8,
                                cursor: 'pointer',
                                padding: 4,
                                borderRadius: 4,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center'
                            }}
                                onClick={handleAreaEditCancel}
                                onMouseEnter={(e) => e.target.style.backgroundColor = '#f5f5f5'}
                                onMouseLeave={(e) => e.target.style.backgroundColor = 'transparent'}
                            >
                                <CloseOutlined style={{ fontSize: 12, color: '#666' }} />
                            </div>

                            {/* Title */}
                            <div style={{
                                fontWeight: 'bold',
                                marginBottom: 5,
                                fontSize: 14,
                                color: isTrajectoryMode ? '#1890ff' : '#262626',
                                paddingRight: 20,
                                textAlign: 'left'
                            }}>
                                {isTrajectoryMode ? 'Edit Area - Trajectory Mode' : 'Edit Area'}
                            </div>

                            {/* Area Name Input */}
                            <div style={{ marginBottom: 8 }}>
                                <label style={{
                                    display: 'block',
                                    marginBottom: 6,
                                    fontSize: 12,
                                    fontWeight: 500,
                                    color: '#595959',
                                    textAlign: 'left'
                                }}>
                                    Area Name:
                                </label>
                                <Input
                                    value={editAreaName}
                                    onChange={(e) => setEditAreaName(e.target.value)}
                                    placeholder="Enter area name"
                                    maxLength={50}
                                    size="small"
                                />
                            </div>

                            {/* Color Picker */}
                            <div style={{ marginBottom: 8 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <label style={{
                                        fontSize: 12,
                                        fontWeight: 500,
                                        minWidth: '70px',
                                        textAlign: 'left',
                                        color: '#595959',
                                    }}>
                                        Area Color:
                                    </label>
                                    <ColorPicker
                                        value={editAreaColor}
                                        onChange={(color) => setEditAreaColor(color.toHexString())}
                                        size="small"
                                    />
                                </div>
                            </div>

                            <div style={{ marginBottom: 8 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <Button
                                        size="small"
                                        type="primary"
                                        variant="outlined"
                                        color='blue'
                                        onClick={handleAreaEditSave}
                                        style={{ flex: 1 }}
                                    >
                                        Save
                                    </Button>
                                </div>
                            </div>

                            {/* Neighbors Input */}
                            <div style={{ marginBottom: 8, borderTop: '1px solid #e8e8e8', paddingTop: 8 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <label style={{
                                        fontSize: 12,
                                        fontWeight: 500,
                                        color: '#595959',
                                        minWidth: '70px',
                                        textAlign: 'left'
                                    }}>
                                        Neighbors:
                                    </label>
                                    <AutoComplete
                                        value={editNeighbors.toString()}
                                        onChange={(value) => setEditNeighbors(parseInt(value) || 10)}
                                        options={[
                                            { value: '5' },
                                            { value: '10' },
                                            { value: '15' },
                                            { value: '20' },
                                            { value: '25' },
                                            { value: '30' }
                                        ]}
                                        size="small"
                                        style={{ flex: 1 }}
                                        placeholder="10"
                                    />
                                </div>
                            </div>

                            {/* N PCAs Input */}
                            <div style={{ marginBottom: 8 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <label style={{
                                        fontSize: 12,
                                        fontWeight: 500,
                                        color: '#595959',
                                        minWidth: '70px',
                                        textAlign: 'left'
                                    }}>
                                        N PCAs:
                                    </label>
                                    <AutoComplete
                                        value={editNPcas.toString()}
                                        onChange={(value) => setEditNPcas(parseInt(value) || 50)}
                                        options={[
                                            { value: '10' },
                                            { value: '20' },
                                            { value: '30' },
                                            { value: '40' },
                                            { value: '50' },
                                            { value: '75' },
                                            { value: '100' }
                                        ]}
                                        size="small"
                                        style={{ flex: 1 }}
                                        placeholder="50"
                                    />
                                </div>
                            </div>

                            {/* Resolution Input */}
                            <div style={{ marginBottom: 5 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <label style={{
                                        fontSize: 12,
                                        fontWeight: 500,
                                        color: '#595959',
                                        minWidth: '70px',
                                        textAlign: 'left'
                                    }}>
                                        Resolution:
                                    </label>
                                    <AutoComplete
                                        value={editResolutions.toString()}
                                        onChange={(value) => setEditResolutions(parseFloat(value) || 0.5)}
                                        options={[
                                            { value: '0.1' },
                                            { value: '0.2' },
                                            { value: '0.3' },
                                            { value: '0.4' },
                                            { value: '0.5' },
                                            { value: '0.6' },
                                            { value: '0.7' },
                                            { value: '0.8' },
                                            { value: '0.9' },
                                            { value: '1.0' }
                                        ]}
                                        size="small"
                                        style={{ flex: 1 }}
                                        placeholder="0.5"
                                    />
                                </div>
                            </div>

                            <Button
                                size="small"
                                style={{ marginBottom: 5, width: '100%' }}
                                color="blue"
                                variant="outlined"
                                onClick={generateUmap}
                                loading={umapLoading}
                            >
                                {umapLoading ? 'Generating...' : 'Generate UMAP'}
                            </Button>

                            {/* Trajectory Controls */}
                            <div style={{ marginBottom: 5, borderTop: '1px solid #e8e8e8', paddingTop: 8 }}>
                                <label style={{
                                    display: 'block',
                                    marginBottom: 6,
                                    fontSize: 12,
                                    fontWeight: 500,
                                    color: '#595959',
                                    textAlign: 'left'
                                }}>
                                    Trajectory Controls:
                                </label>

                                {/* Add Trajectory Button */}
                                <Button
                                    size="small"
                                    type='default'
                                    variant="outlined"
                                    color='blue'
                                    onClick={handleTrajectoryModeToggle}
                                    style={{ marginBottom: 8, width: '100%' }}
                                    disabled={isTrajectoryAnalyzing}
                                >
                                    {isTrajectoryMode ? 'Cancel Trajectory' : 'Add Trajectory'}
                                </Button>

                                {/* Trajectory Name Input - shown when in trajectory mode */}
                                {isTrajectoryMode && (
                                    <div style={{ marginBottom: 8 }}>
                                        <label style={{
                                            display: 'block',
                                            marginBottom: 4,
                                            fontSize: 12,
                                            fontWeight: 500,
                                            color: '#595959',
                                            textAlign: 'left'
                                        }}>
                                            Trajectory Name:
                                        </label>
                                        <Input
                                            value={trajectoryName}
                                            onChange={(e) => setTrajectoryName(e.target.value)}
                                            placeholder="Enter trajectory name"
                                            maxLength={50}
                                            size="small"
                                        />
                                    </div>
                                )}

                                {/* Instructions when in trajectory mode */}
                                {isTrajectoryMode && (
                                    <div style={{
                                        backgroundColor: '#f0f8ff',
                                        padding: 8,
                                        borderRadius: 4,
                                        marginBottom: 8,
                                        fontSize: 11,
                                        color: '#666'
                                    }}>
                                        Click within the area to set <strong>start and end points</strong> for the trajectory arrow.
                                    </div>
                                )}

                                {/* Arrow Width Slider - hide by default, show only on hover when trajectory exists */}
                                <div style={{ marginBottom: 8 }}>
                                    <div style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 3,
                                        fontSize: 12,
                                        color: '#595959',
                                        opacity: (trajectoryStart && trajectoryEnd) ? 1 : 0.5
                                    }}>
                                        <span style={{ fontWeight: 500 }}>Arrow Width:</span> {arrowWidth}px
                                    </div>
                                    <Slider
                                        min={5}
                                        max={maxArrowWidth}
                                        value={arrowWidth}
                                        onChange={handleArrowWidthChange}
                                        style={{
                                            margin: "5px 0 10px 0",
                                            opacity: (trajectoryStart && trajectoryEnd) ? 1 : 0.5
                                        }}
                                        disabled={!isTrajectoryMode || !trajectoryStart || !trajectoryEnd}
                                    />
                                </div>

                                {/* Analyze Trajectory Button */}
                                <Button
                                    size="small"
                                    color="blue"
                                    variant="outlined"
                                    onClick={handleAnalyzeTrajectory}
                                    disabled={!trajectoryStart || !trajectoryEnd || !trajectoryName.trim() || isTrajectoryAnalyzing}
                                    loading={isTrajectoryAnalyzing}
                                    style={{ width: '100%' }}
                                >
                                    {isTrajectoryAnalyzing ? 'Analyzing...' : 'Analyze Trajectory'}
                                </Button>

                                {/* Existing Trajectories List */}
                                {/* {selectedAreaForEdit?.trajectories && selectedAreaForEdit.trajectories.length > 0 && (
                                    <div style={{ marginTop: 8, borderTop: '1px solid #e8e8e8', paddingTop: 8 }}>
                                        <label style={{
                                            display: 'block',
                                            marginBottom: 6,
                                            fontSize: 12,
                                            fontWeight: 500,
                                            color: '#595959',
                                            textAlign: 'left'
                                        }}>
                                            Existing Trajectories:
                                        </label>
                                        <div style={{ maxHeight: 100, overflowY: 'auto' }}>
                                            {selectedAreaForEdit.trajectories.map((trajectory, index) => (
                                                <div
                                                    key={trajectory.id}
                                                    style={{
                                                        fontSize: 11,
                                                        padding: '4px 8px',
                                                        marginBottom: 4,
                                                        backgroundColor: '#f9f9f9',
                                                        borderRadius: 4,
                                                        border: '1px solid #e8e8e8'
                                                    }}
                                                >
                                                    <div style={{ fontWeight: 500, color: '#262626' }}>
                                                        {trajectory.name}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )} */}
                            </div>

                            {/* Action Buttons */}
                            <div style={{ display: 'flex', gap: 5, justifyContent: 'space-between' }}>
                                <Button
                                    size="small"
                                    color="danger"
                                    variant="outlined"
                                    onClick={handleAreaDelete}
                                    style={{ flex: 1 }}
                                >
                                    Delete
                                </Button>
                            </div>
                        </div>
                    </>
                )}
            </div>

            {/* Loading overlay */}
            {isKosaraLoading && (
                <div style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    backgroundColor: 'rgba(255, 255, 255, 0.5)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 1000,
                    flexDirection: 'column',
                    gap: '16px'
                }}>
                    <Spin size="large" />
                    <div style={{ fontSize: '16px', color: '#666' }}>
                        {selectedGenes.length === 1 ? 'Loading gene expression...' : 'Loading Kosara visualization...'}
                    </div>
                </div>
            )}
        </div>
    );
};