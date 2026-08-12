import React, { useRef, useEffect, useState, useCallback, useMemo, useImperativeHandle, forwardRef } from "react";
import { Select, Button, Row, Col, message, Spin, Empty, Switch } from "antd";
import { CloseOutlined } from "@ant-design/icons";
import { LineChart } from "./LineChart";

const { Option } = Select;

// Main trajectory viewer component
export const TrajectoryViewer = forwardRef(({ sampleId, samples, kosaraDisplayEnabled, onKosaraDisplayToggle, onGeneSelection, onTrajectoryGuidelineChange, onTrajectoryAnalysisComplete, regionColorMappings = {}, umapDataSets = [] }, ref) => {
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

    // Track latest cascade selections to prevent stale async responses from polluting options.
    const selectedSampleRef = useRef(null);
    const selectedRegionRef = useRef(null);
    const selectedTrajectoryRef = useRef(null);
    const regionsRequestIdRef = useRef(0);
    const trajectoriesRequestIdRef = useRef(0);
    const genesRequestIdRef = useRef(0);

    // Throttle mouse move events to prevent excessive updates
    const lastMouseMoveRef = useRef({ time: 0, position: null, xValue: null });

    // Selections restored from the example. The cascade effects below would otherwise clear
    // them and refetch options the backend has never computed.
    const exampleSelectionRef = useRef(null);

    const isExampleSelection = (sample, region, trajectory) => {
        const restored = exampleSelectionRef.current;
        if (!restored) return false;

        return (
            restored.selectedSample === sample &&
            (region === undefined || restored.selectedRegion === region) &&
            (trajectory === undefined || restored.selectedTrajectory === trajectory)
        );
    };

    // Any manual selector change hands control back to the normal fetch cascade.
    const clearExampleSelection = () => {
        exampleSelectionRef.current = null;
    };

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
        },
        clearAreaRelatedData: (sampleIdToClear, regionIdToClear) => {
            if (!sampleIdToClear || !regionIdToClear) {
                return;
            }

            // Remove charts tied to the deleted area.
            setTrajectoryDataSets(prev => prev.filter(dataset => {
                const sameSample = dataset.sample_id === sampleIdToClear;
                const sameRegion = String(dataset.region_id) === String(regionIdToClear);
                return !(sameSample && sameRegion);
            }));

            // Drop deleted region from region selector options.
            setAvailableRegions(prev => prev.filter(region => {
                const regionId = region?.id;
                const regionName = region?.name;
                return String(regionId) !== String(regionIdToClear) && String(regionName) !== String(regionIdToClear);
            }));

            // If the deleted area is currently selected, clear all downstream selectors/options.
            if (selectedSample === sampleIdToClear && String(selectedRegion) === String(regionIdToClear)) {
                setSelectedRegion(null);
                setAvailableTrajectories([]);
                setSelectedTrajectory(null);
                setAvailableGenes([]);
                setSelectedGenes([]);
            }
        },
        applyExampleSnapshot: (snapshot) => {
            if (!snapshot) return;

            // Invalidate in-flight requests so a late response cannot overwrite the
            // restored options.
            regionsRequestIdRef.current += 1;
            trajectoriesRequestIdRef.current += 1;
            genesRequestIdRef.current += 1;
            setRegionsLoading(false);
            setTrajectoriesLoading(false);
            setGenesLoading(false);

            exampleSelectionRef.current = {
                selectedSample: snapshot.selectedSample ?? null,
                selectedRegion: snapshot.selectedRegion ?? null,
                selectedTrajectory: snapshot.selectedTrajectory ?? null
            };

            setAvailableRegions(snapshot.availableRegions || []);
            setAvailableTrajectories(snapshot.availableTrajectories || []);
            setAvailableGenes(snapshot.availableGenes || []);
            setTrajectoryDataSets(snapshot.trajectoryDataSets || []);
            setSelectedSample(snapshot.selectedSample ?? null);
            setSelectedRegion(snapshot.selectedRegion ?? null);
            setSelectedTrajectory(snapshot.selectedTrajectory ?? null);
            setSelectedGenes(snapshot.selectedGenes || []);
        },
        clearExampleSelection
    }), [selectedSample, selectedRegion]);

    // Use passed samples and update selected sample when sampleId changes
    useEffect(() => {
        if (samples) {
            setSamplesData(samples);
        }
        if (sampleId) {
            setSelectedSample(sampleId);
        }
    }, [sampleId, samples]);

    useEffect(() => {
        selectedSampleRef.current = selectedSample;
    }, [selectedSample]);

    useEffect(() => {
        selectedRegionRef.current = selectedRegion;
    }, [selectedRegion]);

    useEffect(() => {
        selectedTrajectoryRef.current = selectedTrajectory;
    }, [selectedTrajectory]);

    // Fetch regions when sample changes
    useEffect(() => {
        if (isExampleSelection(selectedSample)) return;

        if (selectedSample) {
            // Clear downstream selections
            setAvailableRegions([]);
            setSelectedRegion(null);
            setAvailableTrajectories([]);
            setSelectedTrajectory(null);
            setAvailableGenes([]);
            setSelectedGenes([]);
            fetchRegions(selectedSample);
        } else {
            setAvailableRegions([]);
            setSelectedRegion(null);
            setSelectedTrajectory(null);
            setSelectedGenes([]);
        }
    }, [selectedSample]);

    // Fetch trajectories when region changes
    useEffect(() => {
        if (isExampleSelection(selectedSample, selectedRegion)) return;

        if (selectedSample && selectedRegion) {
            // Clear downstream selections
            setAvailableTrajectories([]);
            setSelectedTrajectory(null);
            setAvailableGenes([]);
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
        if (isExampleSelection(selectedSample, selectedRegion, selectedTrajectory)) return;

        if (selectedSample && selectedRegion && selectedTrajectory) {
            // Clear downstream selections
            setAvailableGenes([]);
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
        const requestId = ++regionsRequestIdRef.current;
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

            // Ignore stale responses from previous sample selections.
            if (requestId !== regionsRequestIdRef.current || selectedSampleRef.current !== sample_id) {
                return;
            }

            setAvailableRegions(Array.isArray(data) ? data : []);
        } catch (error) {
            console.error("Error fetching regions:", error);

            if (requestId === regionsRequestIdRef.current && selectedSampleRef.current === sample_id) {
                setAvailableRegions([]);
            }
        } finally {
            if (requestId === regionsRequestIdRef.current && selectedSampleRef.current === sample_id) {
                setRegionsLoading(false);
            }
        }
    };

    const fetchTrajectories = async (sample_id, region_id) => {
        const requestId = ++trajectoriesRequestIdRef.current;
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

            // Ignore stale responses if sample/region changed while request was in flight.
            if (
                requestId !== trajectoriesRequestIdRef.current ||
                selectedSampleRef.current !== sample_id ||
                selectedRegionRef.current !== region_id
            ) {
                return;
            }

            setAvailableTrajectories(Array.isArray(data) ? data : []);
        } catch (error) {
            console.error("Error fetching trajectories:", error);

            if (
                requestId === trajectoriesRequestIdRef.current &&
                selectedSampleRef.current === sample_id &&
                selectedRegionRef.current === region_id
            ) {
                setAvailableTrajectories([]);
            }
        } finally {
            if (
                requestId === trajectoriesRequestIdRef.current &&
                selectedSampleRef.current === sample_id &&
                selectedRegionRef.current === region_id
            ) {
                setTrajectoriesLoading(false);
            }
        }
    };

    const fetchGenes = async (sample_id, region_id, trajectory_id) => {
        const requestId = ++genesRequestIdRef.current;
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

            // Ignore stale responses if any parent selection changed.
            if (
                requestId !== genesRequestIdRef.current ||
                selectedSampleRef.current !== sample_id ||
                selectedRegionRef.current !== region_id ||
                selectedTrajectoryRef.current !== trajectory_id
            ) {
                return;
            }

            setAvailableGenes(Array.isArray(data) ? data : []);
        } catch (error) {
            console.error("Error fetching genes:", error);

            if (
                requestId === genesRequestIdRef.current &&
                selectedSampleRef.current === sample_id &&
                selectedRegionRef.current === region_id &&
                selectedTrajectoryRef.current === trajectory_id
            ) {
                setAvailableGenes([]);
            }
        } finally {
            if (
                requestId === genesRequestIdRef.current &&
                selectedSampleRef.current === sample_id &&
                selectedRegionRef.current === region_id &&
                selectedTrajectoryRef.current === trajectory_id
            ) {
                setGenesLoading(false);
            }
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
        const region = availableRegions.find((item) => String(item.id) === String(region_id));
        const regionName = region?.name || dataset.region_name || region_id;
        const matchingUmap = umapDataSets.find((item) =>
            item.sampleId === sample_id &&
            (String(item.areaName) === String(regionName) || String(item.areaName) === String(region_id))
        );
        const areaColor = regionColorMappings[`${sample_id}::${regionName}`]
            || regionColorMappings[`${sample_id}::${region_id}`]
            || matchingUmap?.areaColor;
        
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
                margin: { top: 20, right: 14, bottom: 50, left: 50 },
                errorBandOpacity: 0.3,
                areaColor,
                areaName: regionName,
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
                margin: { top: 20, right: 14, bottom: 40, left: 50 },
                errorBandOpacity: 0.3,
                areaColor,
                areaName: regionName,
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
                padding: "3px 0 2px 8px",
                flexWrap: "wrap",
                gap: "8px"
            }}>
                <div style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "flex-end",
                    columnGap: "3px",
                    rowGap: "3px",
                    flexWrap: "wrap",
                    flex: 1
                }}>
                    {/* Sample Selector */}
                    <Select
                        size="small"
                        placeholder="Select Sample"
                        style={{ width: "120px", minWidth: "120px" }}
                        value={selectedSample}
                        onChange={(value) => {
                            clearExampleSelection();
                            setSelectedSample(value);
                        }}
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
                        onChange={(value) => {
                            clearExampleSelection();
                            setSelectedRegion(value);
                        }}
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
                        onChange={(value) => {
                            clearExampleSelection();
                            setSelectedTrajectory(value);
                        }}
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
                        className="sample-multi-select"
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
                    flex: "1 1 0",
                    minHeight: 0,
                    overflowY: "hidden",
                    overflowX: "hidden",
                    display: "flex",
                    position: "relative",
                }}
            >
                {loading && (
                    <div
                        style={{
                            position: "absolute",
                            inset: 0,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                        }}
                    >
                        <Spin size="large" />
                    </div>
                )}

                {!loading && trajectoryDataSets.length === 0 && (
                    <div
                        style={{
                            position: "absolute",
                            inset: 0,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                        }}
                    >
                        <Empty
                            description="Select sample, region, trajectory, and genes, then click Add to view trajectory analysis"
                            image={Empty.PRESENTED_IMAGE_SIMPLE}
                        />
                    </div>
                )}

                {!loading && trajectoryDataSets.length > 0 && (
                    <div
                        style={{
                            width: "100%",
                            height: "100%",
                            overflow: "hidden",
                            display: "flex",
                            flexDirection: "column",
                            gap: "6px",
                            padding: 0,
                        }}
                    >
                        {trajectoryDataSets.map((dataset) => {
                            const availableGenes = dataset.genes.filter(gene => dataset.data[gene]);
                            if (availableGenes.length === 0) return null;
                            
                            const chartProps = createChartProps(dataset);
                            const isSingleGene = availableGenes.length === 1;
                            
                            return (
                                <div
                                    key={dataset.id}
                                    style={{
                                        backgroundColor: "var(--app-surface-subtle)",
                                        flex: "1 1 0",
                                        minHeight: 0,
                                        display: "flex",
                                        flexDirection: "column",
                                        borderRadius: "8px",
                                        overflow: "hidden",
                                        position: "relative",
                                    }}
                                >
                                    {/* Close button positioned absolutely in upper right corner */}
                                    <Button
                                        type="text"
                                        size="small"
                                        icon={<CloseOutlined />}
                                        onClick={() => removeTrajectoryDataset(dataset.id)}
                                        aria-label="Close spatial trajectory chart"
                                        style={{
                                            position: "absolute",
                                            top: "5px",
                                            right: "2px",
                                            zIndex: 10,
                                            color: "var(--app-text-muted)",
                                            width: "20px",
                                            height: "20px",
                                            minWidth: "20px",
                                            padding: 0,
                                        }}
                                    />
                                    
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
