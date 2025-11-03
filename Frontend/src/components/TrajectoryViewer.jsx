import React, { useRef, useEffect, useState, useCallback, useMemo, useImperativeHandle, forwardRef } from "react";
import { Select, Button, Row, Col, message, Spin, Empty, Switch } from "antd";
import { LineChart } from "./LineChart";

const { Option } = Select;

// Main trajectory viewer component
export const TrajectoryViewer = forwardRef(({ sampleId, samples, kosaraDisplayEnabled, onKosaraDisplayToggle, onGeneSelection, onTrajectoryGuidelineChange, onTrajectoryAnalysisComplete }, ref) => {
    const [samplesData, setSamplesData] = useState([]);
    const [selectedSample, setSelectedSample] = useState(null);
    const [availableRegions, setAvailableRegions] = useState([]);
    const [selectedRegion, setSelectedRegion] = useState(null);
    const [availableTrajectories, setAvailableTrajectories] = useState([]);
    const [selectedTrajectory, setSelectedTrajectory] = useState(null);
    const [availableGenes, setAvailableGenes] = useState([]);
    const [selectedGenes, setSelectedGenes] = useState([]);
    const [trajectoryData, setTrajectoryData] = useState({});
    const [loading, setLoading] = useState(false);
    const [regionsLoading, setRegionsLoading] = useState(false);
    const [trajectoriesLoading, setTrajectoriesLoading] = useState(false);
    const [genesLoading, setGenesLoading] = useState(false);
    const containerRef = useRef();
    const [containerHeight, setContainerHeight] = useState(400);

    // Throttle mouse move events to prevent excessive updates
    const lastMouseMoveRef = useRef({ time: 0, position: null, xValue: null });

    // Expose refresh function to parent
    useImperativeHandle(ref, () => ({
        refreshRegions: (sampleIdToRefresh) => {
            if (sampleIdToRefresh && selectedSample === sampleIdToRefresh) {
                fetchRegions(selectedSample);
            }
        }
    }), [selectedSample]);

    // Track container height for dynamic sizing
    useEffect(() => {
        const updateHeight = () => {
            if (containerRef.current) {
                const rect = containerRef.current.getBoundingClientRect();
                setContainerHeight(rect.height);
            }
        };

        updateHeight();
        const resizeObserver = new ResizeObserver(updateHeight);
        if (containerRef.current) {
            resizeObserver.observe(containerRef.current);
        }

        return () => resizeObserver.disconnect();
    }, []);

    // Use passed samples and update selected sample when sampleId changes
    useEffect(() => {
        if (samples) {
            setSamplesData(samples);
        }
        if (sampleId) {
            setSelectedSample(sampleId);
        }
    }, [sampleId, samples]);

    // Fetch regions when sample changes
    useEffect(() => {
        if (selectedSample) {
            // Clear downstream selections
            setSelectedRegion(null);
            setSelectedTrajectory(null);
            setSelectedGenes([]);
            setTrajectoryData({});
            fetchRegions(selectedSample);
        } else {
            setAvailableRegions([]);
            setSelectedRegion(null);
            setSelectedTrajectory(null);
            setSelectedGenes([]);
            setTrajectoryData({});
        }
    }, [selectedSample]);

    // Fetch trajectories when region changes
    useEffect(() => {
        if (selectedSample && selectedRegion) {
            // Clear downstream selections
            setSelectedTrajectory(null);
            setSelectedGenes([]);
            setTrajectoryData({});
            fetchTrajectories(selectedSample, selectedRegion);
        } else {
            setAvailableTrajectories([]);
            setSelectedTrajectory(null);
            setSelectedGenes([]);
            setTrajectoryData({});
        }
    }, [selectedSample, selectedRegion]);

    // Fetch genes when trajectory changes
    useEffect(() => {
        if (selectedSample && selectedRegion && selectedTrajectory) {
            // Clear downstream selections
            setSelectedGenes([]);
            setTrajectoryData({});
            fetchGenes(selectedSample, selectedRegion, selectedTrajectory);
        } else {
            setAvailableGenes([]);
            setSelectedGenes([]);
            setTrajectoryData({});
        }
    }, [selectedSample, selectedRegion, selectedTrajectory]);

    const fetchRegions = async (sample_id) => {
        setRegionsLoading(true);
        try {
            const response = await fetch("/api/get_sample_regions", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ sample_id }),
            });
            const data = await response.json();
            setAvailableRegions(data);
        } catch (error) {
            console.error("Error fetching regions:", error);
            setAvailableRegions([]);
        } finally {
            setRegionsLoading(false);
        }
    };

    const fetchTrajectories = async (sample_id, region_id) => {
        setTrajectoriesLoading(true);
        try {
            const response = await fetch("/api/get_region_trajectories", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ sample_id, region_id }),
            });
            const data = await response.json();
            setAvailableTrajectories(data);
        } catch (error) {
            console.error("Error fetching trajectories:", error);
            setAvailableTrajectories([]);
        } finally {
            setTrajectoriesLoading(false);
        }
    };

    const fetchGenes = async (sample_id, region_id, trajectory_id) => {
        setGenesLoading(true);
        try {
            const response = await fetch("/api/get_trajectory_genes", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ sample_id, region_id, trajectory_id }),
            });
            const data = await response.json();
            setAvailableGenes(data);
        } catch (error) {
            console.error("Error fetching genes:", error);
            setAvailableGenes([]);
        } finally {
            setGenesLoading(false);
        }
    };

    const fetchTrajectoryData = async (sample_id, region_id, trajectory_id, genes) => {
        setLoading(true);
        try {
            const response = await fetch("/api/get_spata2_trajectory_data", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ 
                    sample_id, 
                    region_id, 
                    trajectory_id, 
                    selected_genes: genes 
                }),
            });
            const data = await response.json();
            setTrajectoryData(data);
        } catch (error) {
            console.error("Error fetching trajectory data:", error);
            setTrajectoryData({});
        } finally {
            setLoading(false);
        }
    };

    const handleAdd = () => {
        if (!selectedSample) {
            message.warning("Please select a sample first");
            return;
        }
        if (!selectedRegion) {
            message.warning("Please select a region first");
            return;
        }
        if (!selectedTrajectory) {
            message.warning("Please select a trajectory first");
            return;
        }
        if (selectedGenes.length === 0) {
            message.warning("Please select at least one gene");
            return;
        }

        fetchTrajectoryData(selectedSample, selectedRegion, selectedTrajectory, selectedGenes);
        
        // Notify parent about gene selection for Kosara display
        if (onGeneSelection && kosaraDisplayEnabled) {
            onGeneSelection([...selectedGenes], selectedSample);
        }
    };

    // Flatten sample options for Select component
    const sampleOptions = samplesData.flatMap(group => {
        // Handle both selectOptions format (nested) and selectedSamples format (flat)
        if (group.options) {
            // selectOptions format: [{text: "2µm", options: [{value, label}, ...]}, ...]
            return group.options || [];
        } else {
            // selectedSamples format: [{id, name}, ...]
            return [{value: group.id, label: group.name}];
        }
    });

    // Calculate chart height - now always the same since we use one chart
    const getChartHeight = () => {
        if (Object.keys(trajectoryData).length === 0) return containerHeight;
        return containerHeight - 32; // Account for controls
    };

    const chartHeight = getChartHeight();

    // Handle mouse movement over trajectory chart with throttling
    const handleTrajectoryMouseMove = useCallback((normalizedPosition, xValue) => {
        if (!onTrajectoryGuidelineChange || !selectedSample) return;

        const now = Date.now();
        const THROTTLE_MS = 16; // ~60fps
        const lastMove = lastMouseMoveRef.current;

        // Throttle updates to prevent excessive re-renders
        if (now - lastMove.time < THROTTLE_MS) return;

        // Only update if values have changed significantly (prevent floating point drift)
        const positionChanged = Math.abs((lastMove.position || 0) - normalizedPosition) > 0.001;
        const xValueChanged = Math.abs((lastMove.xValue || 0) - xValue) > 0.001;

        if (!positionChanged && !xValueChanged) return;

        // Update our tracking reference
        lastMouseMoveRef.current = { time: now, position: normalizedPosition, xValue: xValue };

        onTrajectoryGuidelineChange({
            sampleId: selectedSample,
            position: normalizedPosition,
            xValue: xValue,
            isVertical: false,
            visible: true
        });
    }, [onTrajectoryGuidelineChange, selectedSample]);

    // Handle mouse leave from trajectory chart
    const handleTrajectoryMouseLeave = useCallback(() => {
        if (onTrajectoryGuidelineChange) {
            // Reset our tracking reference
            lastMouseMoveRef.current = { time: 0, position: null, xValue: null };
            onTrajectoryGuidelineChange({
                visible: false
            });
        }
    }, [onTrajectoryGuidelineChange]);

    // Get selected gene names for chart display
    const selectedGeneNames = selectedGenes.filter(gene => trajectoryData[gene]);

    // Memoize LineChart props to prevent unnecessary re-renders
    const singleGeneChartProps = useMemo(() => ({
        data: trajectoryData[selectedGeneNames[0]]?.data,
        xAccessor: d => d.x,
        yAccessor: d => d.y,
        showErrorBands: true,
        yMinAccessor: d => d.ymin,
        yMaxAccessor: d => d.ymax,
        margin: { top: 30, right: 20, bottom: 50, left: 60 },
        lineColor: "#e74c3c",
        errorBandOpacity: 0.3,
        onMouseMove: handleTrajectoryMouseMove,
        onMouseLeave: handleTrajectoryMouseLeave
    }), [trajectoryData, selectedGeneNames, handleTrajectoryMouseMove, handleTrajectoryMouseLeave]);

    const multiGeneChartProps = useMemo(() => ({
        datasets: selectedGeneNames
            .filter(gene => trajectoryData[gene])
            .map(gene => ({
                data: trajectoryData[gene].data,
                xAccessor: d => d.x,
                yAccessor: d => d.y,
                yMinAccessor: d => d.ymin,
                yMaxAccessor: d => d.ymax,
                label: gene,
                lineColor: undefined
            })),
        showErrorBands: true,
        showLegend: true,
        margin: { top: 30, right: 20, bottom: 40, left: 60 },
        errorBandOpacity: 0.3,
        onMouseMove: handleTrajectoryMouseMove,
        onMouseLeave: handleTrajectoryMouseLeave
    }), [trajectoryData, selectedGeneNames, handleTrajectoryMouseMove, handleTrajectoryMouseLeave]);


    return (
        <div ref={containerRef} className="trajectory-viewer" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
            {/* Control Panel */}
            <div style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexShrink: 0,
                padding: "8px 10px 8px 10px",
                flexWrap: "wrap",
                gap: "8px"
            }}>
                <div style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "flex-end",
                    gap: "8px",
                    flexWrap: "wrap",
                    flex: 1
                }}>
                    {/* Sample Selector */}
                    <Select
                        size="small"
                        placeholder="Select Sample"
                        style={{ width: "120px", minWidth: "120px" }}
                        value={selectedSample}
                        onChange={setSelectedSample}
                        filterOption={(input, option) =>
                            option.children.toLowerCase().indexOf(input.toLowerCase()) >= 0
                        }
                    >
                        {sampleOptions.map(sample => (
                            <Option key={sample.value} value={sample.value}>
                                {sample.label}
                            </Option>
                        ))}
                    </Select>

                    {/* Region Selector */}
                    <Select
                        size="small"
                        placeholder="Select Region"
                        style={{ width: "120px", minWidth: "120px" }}
                        value={selectedRegion}
                        onChange={setSelectedRegion}
                        disabled={!selectedSample || regionsLoading}
                        loading={regionsLoading}
                        filterOption={(input, option) =>
                            option.children.toLowerCase().indexOf(input.toLowerCase()) >= 0
                        }
                    >
                        {availableRegions.map(region => (
                            <Option key={region.id} value={region.id}>
                                {region.name}
                            </Option>
                        ))}
                    </Select>

                    {/* Trajectory Selector */}
                    <Select
                        size="small"
                        placeholder="Select Trajectory"
                        style={{ width: "120px", minWidth: "120px" }}
                        value={selectedTrajectory}
                        onChange={setSelectedTrajectory}
                        disabled={!selectedRegion || trajectoriesLoading}
                        loading={trajectoriesLoading}
                        filterOption={(input, option) =>
                            option.children.toLowerCase().indexOf(input.toLowerCase()) >= 0
                        }
                    >
                        {availableTrajectories.map(trajectory => (
                            <Option key={trajectory.id} value={trajectory.id}>
                                {trajectory.name}
                            </Option>
                        ))}
                    </Select>

                    {/* Gene Selector (Multiple) */}
                    <Select
                        size="small"
                        mode="multiple"
                        placeholder="Select Genes"
                        style={{ width: "150px", minWidth: "150px" }}
                        value={selectedGenes}
                        onChange={setSelectedGenes}
                        disabled={!selectedTrajectory || genesLoading}
                        loading={genesLoading}
                        showSearch
                        filterOption={(input, option) =>
                            option.children.toLowerCase().indexOf(input.toLowerCase()) >= 0
                        }
                        maxTagCount="responsive"
                    >
                        {availableGenes.map(gene => (
                            <Option key={gene} value={gene}>
                                {gene}
                            </Option>
                        ))}
                    </Select>

                    {/* Add Button */}
                    <Button
                        size="small"
                        type="primary"
                        onClick={handleAdd}
                        disabled={!selectedSample || !selectedRegion || !selectedTrajectory || selectedGenes.length === 0 || loading}
                        loading={loading}
                        style={{ flexShrink: 0 }}
                    >
                        Add
                    </Button>
                </div>
            </div>

            {/* Charts Container */}
            <div
                style={{
                    flex: 1,
                    overflowY: "hidden",
                    overflowX: "hidden",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                }}
            >
                {loading && (
                    <Spin size="large" />
                )}

                {!loading && Object.keys(trajectoryData).length === 0 && (
                    <Empty
                        description="Select sample, region, trajectory, and genes, then click Add to view trajectory analysis"
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                    />
                )}

                {!loading && Object.keys(trajectoryData).length > 0 && selectedGeneNames.length === 0 && (
                    <Empty
                        description="No trajectory data available for selected genes"
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                    />
                )}

                {!loading && selectedGeneNames.length > 0 && Object.keys(trajectoryData).length > 0 && (
                    <div
                        style={{
                            backgroundColor: "#f9f9f9",
                            height: `${chartHeight}px`,
                            display: "flex",
                            flexDirection: "column",
                            width: "100%",
                            borderRadius: "8px",
                        }}
                    >
                        {selectedGeneNames.length === 1 ? (
                            // Single gene: use original approach
                            <LineChart {...singleGeneChartProps} />
                        ) : (
                            // Multiple genes: combine into single chart
                            <LineChart {...multiGeneChartProps} />
                        )}
                    </div>
                )}
            </div>
        </div>
    );
});

TrajectoryViewer.displayName = 'TrajectoryViewer';