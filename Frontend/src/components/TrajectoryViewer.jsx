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
    const [trajectoryDataSets, setTrajectoryDataSets] = useState([]); // Array of trajectory datasets
    const [loading, setLoading] = useState(false);
    const [regionsLoading, setRegionsLoading] = useState(false);
    const [trajectoriesLoading, setTrajectoriesLoading] = useState(false);
    const [genesLoading, setGenesLoading] = useState(false);
    const containerRef = useRef();
    const chartContainerRef = useRef();
    const [chartContainerHeight, setChartContainerHeight] = useState(300);

    // Throttle mouse move events to prevent excessive updates
    const lastMouseMoveRef = useRef({ time: 0, position: null, xValue: null });

    // Expose refresh function to parent
    useImperativeHandle(ref, () => ({
        refreshRegions: (sampleIdToRefresh) => {
            if (sampleIdToRefresh && selectedSample === sampleIdToRefresh) {
                fetchRegions(selectedSample);
            }
        },
        refreshTrajectories: (sampleIdToRefresh, regionIdToRefresh) => {
            if (sampleIdToRefresh && selectedSample === sampleIdToRefresh && 
                regionIdToRefresh && selectedRegion === regionIdToRefresh) {
                fetchTrajectories(selectedSample, selectedRegion);
            }
        }
    }), [selectedSample, selectedRegion]);

    // Track chart container height dynamically
    useEffect(() => {
        const updateChartHeight = () => {
            if (chartContainerRef.current) {
                const rect = chartContainerRef.current.getBoundingClientRect();
                const newHeight = Math.max(rect.height, 200); // Minimum height of 200px
                setChartContainerHeight(newHeight);
            }
        };

        // Use a slight delay to avoid feedback loops
        const timeoutId = setTimeout(updateChartHeight, 100);
        
        const resizeObserver = new ResizeObserver(() => {
            clearTimeout(timeoutId);
            setTimeout(updateChartHeight, 100);
        });
        
        if (chartContainerRef.current) {
            resizeObserver.observe(chartContainerRef.current);
        }

        return () => {
            clearTimeout(timeoutId);
            resizeObserver.disconnect();
        };
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
            setTrajectoryDataSets([]);
            fetchRegions(selectedSample);
        } else {
            setAvailableRegions([]);
            setSelectedRegion(null);
            setSelectedTrajectory(null);
            setSelectedGenes([]);
            setTrajectoryDataSets([]);
        }
    }, [selectedSample]);

    // Fetch trajectories when region changes
    useEffect(() => {
        if (selectedSample && selectedRegion) {
            // Clear downstream selections
            setSelectedTrajectory(null);
            setSelectedGenes([]);
            // Don't clear trajectoryDataSets here - keep existing charts
            fetchTrajectories(selectedSample, selectedRegion);
        } else {
            setAvailableTrajectories([]);
            setSelectedTrajectory(null);
            setSelectedGenes([]);
            // Don't clear trajectoryDataSets here either
        }
    }, [selectedSample, selectedRegion]);

    // Fetch genes when trajectory changes
    useEffect(() => {
        if (selectedSample && selectedRegion && selectedTrajectory) {
            // Clear downstream selections
            setSelectedGenes([]);
            // Don't clear trajectoryDataSets here - keep existing charts
            fetchGenes(selectedSample, selectedRegion, selectedTrajectory);
        } else {
            setAvailableGenes([]);
            setSelectedGenes([]);
            // Don't clear trajectoryDataSets here either
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
            
            // Create a new dataset entry
            const newDataset = {
                id: Date.now(), // Simple unique ID
                sample_id,
                region_id,
                trajectory_id,
                genes: [...genes],
                data,
                title: `${genes.join(', ')} (${sample_id} - Region ${region_id} - Trajectory ${trajectory_id})`
            };
            
            // Add to existing datasets
            setTrajectoryDataSets(prev => [...prev, newDataset]);
        } catch (error) {
            console.error("Error fetching trajectory data:", error);
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
        
        // Clear the gene selection for next input
        setSelectedGenes([]);
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

    // Use dynamic chart height based on available space
    const chartHeight = chartContainerHeight;
    
    // Calculate individual chart height based on number of charts
    const getIndividualChartHeight = () => {
        if (trajectoryDataSets.length === 0) return chartHeight;
        const padding = 4; // Container padding
        const gap = 0; // Gap between charts
        const totalGaps = (trajectoryDataSets.length - 1) * gap;
        const availableHeight = chartHeight - (padding * 2) - totalGaps;
        const heightPerChart = Math.max(availableHeight / trajectoryDataSets.length, 200); // Minimum 200px per chart
        return heightPerChart;
    };

    // Handle mouse movement over trajectory chart with throttling
    const handleTrajectoryMouseMove = useCallback((normalizedPosition, xValue, trajectoryInfo = null) => {
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
            visible: true,
            trajectoryInfo: trajectoryInfo // Pass through trajectory-specific information
        });
    }, [onTrajectoryGuidelineChange, selectedSample]);

    // Handle mouse leave from trajectory chart
    const handleTrajectoryMouseLeave = useCallback((trajectoryInfo = null) => {
        if (onTrajectoryGuidelineChange) {
            // Reset our tracking reference
            lastMouseMoveRef.current = { time: 0, position: null, xValue: null };
            onTrajectoryGuidelineChange({
                visible: false,
                trajectoryInfo: trajectoryInfo // Pass through trajectory-specific information
            });
        }
    }, [onTrajectoryGuidelineChange]);

    // Get selected gene names for chart display
    const selectedGeneNames = selectedGenes.filter(gene => 
        trajectoryDataSets.length > 0 && 
        trajectoryDataSets[0].data && 
        trajectoryDataSets[0].data[gene]
    );

    // Function to remove a trajectory dataset
    const removeTrajectoryDataset = (datasetId) => {
        setTrajectoryDataSets(prev => prev.filter(dataset => dataset.id !== datasetId));
    };

    // Function to create chart props for a specific dataset
    const createChartProps = (dataset) => {
        const { data, genes, sample_id, region_id, trajectory_id } = dataset;
        const availableGenes = genes.filter(gene => data[gene]);
        
        // Create trajectory-specific mouse handlers
        const handleSpecificTrajectoryMouseMove = (normalizedPosition, xValue) => {
            handleTrajectoryMouseMove(normalizedPosition, xValue, {
                sample_id,
                region_id, 
                trajectory_id
            });
        };

        const handleSpecificTrajectoryMouseLeave = () => {
            handleTrajectoryMouseLeave({
                sample_id,
                region_id,
                trajectory_id
            });
        };
        
        if (availableGenes.length === 1) {
            // Single gene chart - use datasets format to ensure label is passed
            return {
                datasets: [{
                    data: data[availableGenes[0]]?.data,
                    xAccessor: d => d.x,
                    yAccessor: d => d.y,
                    yMinAccessor: d => d.ymin,
                    yMaxAccessor: d => d.ymax,
                    label: availableGenes[0],
                    lineColor: "#e74c3c"
                }],
                showErrorBands: true,
                showLegend: true,
                margin: { top: 30, right: 20, bottom: 50, left: 60 },
                errorBandOpacity: 0.3,
                onMouseMove: handleSpecificTrajectoryMouseMove,
                onMouseLeave: handleSpecificTrajectoryMouseLeave
            };
        } else {
            // Multi-gene chart
            return {
                datasets: availableGenes
                    .filter(gene => data[gene])
                    .map(gene => ({
                        data: data[gene].data,
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
                onMouseMove: handleSpecificTrajectoryMouseMove,
                onMouseLeave: handleSpecificTrajectoryMouseLeave
            };
        }
    };


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
                ref={chartContainerRef}
                style={{
                    flex: 1,
                    overflowY: "hidden",
                    overflowX: "hidden",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    minHeight: "200px",
                }}
            >
                {loading && (
                    <Spin size="large" />
                )}

                {!loading && trajectoryDataSets.length === 0 && (
                    <Empty
                        description="Select sample, region, trajectory, and genes, then click Add to view trajectory analysis"
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                    />
                )}

                {!loading && trajectoryDataSets.length > 0 && (
                    <div
                        style={{
                            width: "100%",
                            height: "100%",
                            overflowY: "auto",
                            display: "flex",
                            flexDirection: "column",
                            gap: "16px",
                            padding: "8px",
                        }}
                    >
                        {trajectoryDataSets.map((dataset) => {
                            const availableGenes = dataset.genes.filter(gene => dataset.data[gene]);
                            if (availableGenes.length === 0) return null;
                            
                            const chartProps = createChartProps(dataset);
                            const isSingleGene = availableGenes.length === 1;
                            const individualChartHeight = getIndividualChartHeight();
                            
                            return (
                                <div
                                    key={dataset.id}
                                    style={{
                                        backgroundColor: "#f9f9f9",
                                        minHeight: `${individualChartHeight}px`,
                                        height: `${individualChartHeight}px`,
                                        display: "flex",
                                        flexDirection: "column",
                                        borderRadius: "8px",
                                        overflow: "hidden",
                                        position: "relative",
                                        flexShrink: 0,
                                    }}
                                >
                                    {/* Close button positioned absolutely in upper right corner */}
                                    <Button
                                        type="text"
                                        size="small"
                                        onClick={() => removeTrajectoryDataset(dataset.id)}
                                        style={{
                                            position: "absolute",
                                            top: "4px",
                                            right: "4px",
                                            padding: "0 4px",
                                            height: "20px",
                                            minWidth: "20px",
                                            fontSize: "14px",
                                            color: "#999",
                                            backgroundColor: "rgba(255, 255, 255, 0.8)",
                                            borderRadius: "50%",
                                            zIndex: 10,
                                        }}
                                    >
                                        ×
                                    </Button>
                                    
                                    {/* Chart content */}
                                    <div style={{ width: "100%", height: "100%", overflow: "hidden" }}>
                                        {isSingleGene ? (
                                            <LineChart {...chartProps} />
                                        ) : (
                                            <LineChart {...chartProps} />
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
});

TrajectoryViewer.displayName = 'TrajectoryViewer';