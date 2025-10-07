import React, { useRef, useEffect, useState } from "react";
import { Spin, Empty, Input, Button } from "antd";
import { CloseOutlined } from "@ant-design/icons";
import * as d3 from "d3";
import { COLOR_PALETTE } from "./Utils";

export const GOAnalysisWindow = ({
    visible,
    setVisible,
    loading,
    data,
    position, // {x, y} - position where the cluster was clicked
    title = "GO Analysis Results",
    setCellName,
    cellIds = [],
    coordinatesData,
    setCellTypesData,
    setSelectedCellTypes,
    setCellTypeColors,
    sampleId // Add sampleId prop
}) => {
    const tooltipRef = useRef();
    const svgRef = useRef();
    const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });
    const [inputCellName, setInputCellName] = useState("");

    const confirmCellName = () => {
        if (inputCellName.trim() && cellIds.length > 0) {
            const newCellTypeName = inputCellName.trim();

            // Create object mapping each cellId to the inputCellName
            const newCellNames = {};
            cellIds.forEach(cellId => {
                newCellNames[cellId] = newCellTypeName;
            });

            // Update setCellName with the new mappings
            setCellName(prevCellNames => ({
                ...prevCellNames,
                ...newCellNames
            }));

            // Update cell types data to reflect the reallocation
            setCellTypesData(prevCellTypesData => {
                // Find which original cell types these cells belonged to
                const originalCellTypes = {};

                // Get all cell data across samples to find original cell types
                const allCells = Object.values(coordinatesData || {}).flat();

                cellIds.forEach(cellId => {
                    const cell = allCells.find(c => c.id === cellId);
                    if (cell && cell.cell_type) {
                        originalCellTypes[cell.cell_type] = (originalCellTypes[cell.cell_type] || 0) + 1;
                    }
                });

                // Get the current sample's cell types data (cellTypesData is an object keyed by sampleId)
                const currentSampleCellTypes = prevCellTypesData[sampleId] || [];
                
                // Create new cell types array with updated counts
                let updatedCellTypes = [...currentSampleCellTypes];

                // Reduce counts for original cell types
                Object.entries(originalCellTypes).forEach(([cellType, count]) => {
                    const cellTypeIndex = updatedCellTypes.findIndex(ct => ct.name === cellType);
                    if (cellTypeIndex !== -1) {
                        updatedCellTypes[cellTypeIndex] = {
                            ...updatedCellTypes[cellTypeIndex],
                            count: Math.max(0, updatedCellTypes[cellTypeIndex].count - count)
                        };
                    }
                });

                // Remove cell types with zero count
                updatedCellTypes = updatedCellTypes.filter(ct => ct.count > 0);

                // Add or update the new cell type
                const newCellTypeIndex = updatedCellTypes.findIndex(ct => ct.name === newCellTypeName);
                if (newCellTypeIndex !== -1) {
                    // Update existing cell type count
                    updatedCellTypes[newCellTypeIndex] = {
                        ...updatedCellTypes[newCellTypeIndex],
                        count: updatedCellTypes[newCellTypeIndex].count + cellIds.length
                    };
                } else {
                    // Add new cell type
                    updatedCellTypes.push({
                        name: newCellTypeName,
                        count: cellIds.length
                    });
                }

                // Sort by count (descending)
                updatedCellTypes = updatedCellTypes.sort((a, b) => b.count - a.count);
                
                // Return updated object with the modified sample data
                return {
                    ...prevCellTypesData,
                    [sampleId]: updatedCellTypes
                };
            });

            // Update selected cell types to include the new cell type if it doesn't exist
            setSelectedCellTypes(prevSelected => {
                const sampleSelectedTypes = prevSelected[sampleId] || [];
                if (!sampleSelectedTypes.includes(newCellTypeName)) {
                    return {
                        ...prevSelected,
                        [sampleId]: [...sampleSelectedTypes, newCellTypeName]
                    };
                }
                return prevSelected;
            });

            // Set color for new cell type if it doesn't have one
            setCellTypeColors(prevColors => {
                if (!prevColors[newCellTypeName]) {
                    const colorIndex = Object.keys(prevColors).length % COLOR_PALETTE.length;
                    return {
                        ...prevColors,
                        [newCellTypeName]: COLOR_PALETTE[colorIndex]
                    };
                }
                return prevColors;
            });

            // Clear the input and close the window
            setInputCellName("");
            setVisible(false);
        }
    };

    // Calculate tooltip position with boundary detection
    useEffect(() => {
        if (!visible || !position || !tooltipRef.current) return;

        const tooltip = tooltipRef.current;
        const tooltipWidth = 500;
        const tooltipHeight = 500;
        const padding = 20;

        // Get viewport dimensions
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        let x = position.x + 20; // Default: 20px to the right of click
        let y = position.y - tooltipHeight / 2; // Center vertically on click

        // Boundary detection - horizontal
        if (x + tooltipWidth + padding > viewportWidth) {
            x = position.x - tooltipWidth - 20; // Show to the left instead
        }
        if (x < padding) {
            x = padding; // Ensure it doesn't go off the left edge
        }

        // Boundary detection - vertical
        if (y < padding) {
            y = padding; // Don't go above viewport
        }
        if (y + tooltipHeight + padding > viewportHeight) {
            y = viewportHeight - tooltipHeight - padding; // Don't go below viewport
        }

        setTooltipPosition({ x, y });
    }, [visible, position]);

    // Create D3 chart
    useEffect(() => {
        if (!data || loading || !visible || !svgRef.current) return;

        // Clear previous chart
        d3.select(svgRef.current).selectAll("*").remove();

        const margin = { top: 10, right: 10, bottom: 10, left: 50 };
        const width = 500 - margin.left - margin.right;
        const height = 200 - margin.top - margin.bottom;

        const sortedData = data.sort((a, b) => b.combined_score - a.combined_score);

        if (sortedData.length === 0) return;

        // Add activity labels to data
        const dataWithActivityLabels = sortedData.map((d, index) => ({
            ...d,
            activityLabel: `Activity${index + 1}`
        }));

        // Scales
        const xScale = d3
            .scaleLinear()
            .domain([0, d3.max(dataWithActivityLabels, (d) => d.combined_score)])
            .range([0, width]);

        const yScale = d3
            .scaleBand()
            .domain(dataWithActivityLabels.map((d) => d.activityLabel))
            .range([0, height])
            .padding(0.1);

        const svg = d3
            .select(svgRef.current)
            .attr("width", width + margin.left + margin.right)
            .attr("height", height + margin.top + margin.bottom);

        const g = svg
            .append("g")
            .attr("transform", `translate(${margin.left},${margin.top})`);

        // Create bars
        g.selectAll(".bar")
            .data(dataWithActivityLabels)
            .enter()
            .append("rect")
            .attr("class", "bar")
            .attr("x", 0)
            .attr("y", (d) => yScale(d.activityLabel))
            .attr("width", (d) => xScale(d.combined_score))
            .attr("height", yScale.bandwidth())
            .attr("fill", "#1890ff")
            .attr("opacity", 0.8)
            .attr("cursor", "pointer")
            .on("mouseover", (event, d) => {
                d3.select(event.currentTarget).attr("opacity", 1);

                // Create mini tooltip
                const miniTooltip = d3
                    .select("body")
                    .append("div")
                    .attr("class", "mini-tooltip")
                    .style("position", "absolute")
                    .style("background", "rgba(255, 255, 255, 0.9)")
                    .style("box-shadow", "0 4px 12px rgba(0, 0, 0, 0.15)")
                    .style("color", "black")
                    .style("padding", "8px 12px")
                    .style("border-radius", "6px")
                    .style("font-size", "12px")
                    .style("pointer-events", "none")
                    .style("z-index", 1001)
                    .style("max-width", "300px")
                    .style("word-wrap", "break-word")
                    .style("line-height", "1.4");

                miniTooltip
                    .html(
                        `
                        <strong>${d.term}</strong><br/><br/>
                        <strong>Combined Score:</strong> ${d.combined_score ? d.combined_score.toFixed(3) : 'N/A'}<br/>
                        <strong>Adjusted P-value:</strong> ${d.adjusted_p_value ? d.adjusted_p_value.toFixed(6) : 'N/A'}<br/>
                        <strong>Odds Ratio:</strong> ${d.odds_ratio ? d.odds_ratio.toFixed(3) : 'N/A'}<br/>
                        <strong>Genes:</strong> ${d.genes || 'N/A'}
                        `
                    )
                    .style("left", event.pageX + 10 + "px")
                    .style("top", event.pageY - 10 + "px");
            })
            .on("mouseout", (event) => {
                d3.select(event.currentTarget).attr("opacity", 1);
                d3.selectAll(".mini-tooltip").remove();
            });

        // Add Y axis
        g.append("g")
            .call(d3.axisLeft(yScale))
            .selectAll("text")
            .style("font-size", "10px")
    }, [data, loading, visible]);

    if (!visible) return null;

    return (
        <div
            ref={tooltipRef}
            style={{
                position: "fixed",
                left: `${tooltipPosition.x}px`,
                top: `${tooltipPosition.y}px`,
                width: "500px",
                maxHeight: "400px",
                background: "white",
                border: "1px solid #d9d9d9",
                borderRadius: "8px",
                boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)",
                zIndex: 1000,
                overflow: "hidden",
            }}
        >
            {/* Header */}
            <div
                style={{
                    padding: "5px 10px 5px 10px",
                    borderBottom: "1px solid #f0f0f0",
                    background: "#fafafa",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                }}
            >
                <div 
                    style={{ 
                        fontSize: "14px", 
                        fontWeight: "600", 
                        color: "#262626"
                    }}
                >
                    {title}
                </div>
                <CloseOutlined
                    style={{ cursor: "pointer", color: "#8c8c8c", fontSize: "12px" }}
                    onClick={() => setVisible(false)}
                />
            </div>

            {/* Content */}
            <div style={{ padding: "16px" }}>
                {/* Input and Button Row */}
                <div style={{
                    display: "flex",
                    gap: "8px",
                    marginBottom: "9px",
                    alignItems: "center"
                }}>
                    <Input
                        size="small"
                        placeholder="Enter Cell Name"
                        value={inputCellName}
                        onChange={(e) => setInputCellName(e.target.value)}
                        onPressEnter={confirmCellName}
                        style={{ flex: 1 }}
                    />
                    <Button
                        size="small"
                        type="primary"
                        onClick={confirmCellName}
                        disabled={!inputCellName.trim()}
                    >
                        Confirm
                    </Button>
                </div>

                {/* Chart Area */}
                <div
                    style={{
                        display: "flex",
                        justifyContent: "center",
                        alignItems: "center",
                        minHeight: "200px",
                    }}
                >
                    {loading ? (
                        <div
                            style={{
                                display: "flex",
                                flexDirection: "column",
                                alignItems: "center",
                                gap: "12px",
                            }}
                        >
                            <Spin size="large" />
                            <div style={{ fontSize: "13px", color: "#666" }}>
                                Loading GO Analysis...
                            </div>
                        </div>
                    ) : data && data.length > 0 ? (
                        <svg ref={svgRef}></svg>
                    ) : (
                        <Empty
                            description="No GO analysis data available"
                            image={Empty.PRESENTED_IMAGE_SIMPLE}
                        />
                    )}
                </div>
            </div>
        </div>
    );
};
