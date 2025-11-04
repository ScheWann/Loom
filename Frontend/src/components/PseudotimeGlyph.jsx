import React, { useRef, useEffect, useState, useMemo } from 'react';
import * as d3 from 'd3';
import { Empty, Spin, Checkbox, Tooltip } from 'antd';
import { COLOR_BREWER2_PALETTE } from "./Utils";

const COLORS = COLOR_BREWER2_PALETTE;

export const PseudotimeGlyph = ({
    adata_umap_title,
    pseudotimeData,
    pseudotimeLoading,
    isSelected = false,
    onSelectionChange,
    geneExpressionData = null,
    clusterColors = null,
    trajectoryIndex,
    umapParameters = null,
    areaColor,
    areaName,
}) => {
    const containerRef = useRef();
    const svgRef = useRef(null);
    const [dimensions, setDimensions] = useState({ width: 300, height: 300 });
    const [selectedTrajectory, setSelectedTrajectory] = useState(0); // Default to first trajectory (index 0)

    // Ensure selectedTrajectory is valid when pseudotimeData changes
    useEffect(() => {
        if (pseudotimeData) {
            let trajectoryCount = 0;

            if (pseudotimeData.trajectory_objects && Array.isArray(pseudotimeData.trajectory_objects)) {
                trajectoryCount = pseudotimeData.trajectory_objects.length;
            }

            if (trajectoryCount > 0 && selectedTrajectory >= trajectoryCount) {
                setSelectedTrajectory(0); // Reset to first trajectory if current selection is out of bounds
            }
        }
    }, [pseudotimeData, selectedTrajectory]);

    // Generate a unique ID for this component instance
    const [componentId] = useState(() => `pseudotime-glyph-${Math.random().toString(36).substr(2, 9)}`);

    // Get the gene expression data for the selected trajectory
    const selectedGeneData = useMemo(() => {
        if (!geneExpressionData || !Array.isArray(geneExpressionData)) {
            return null;
        }

        // Find the gene expression data for the selected trajectory
        const selectedData = geneExpressionData.find(data => {
            const dataTrajectoryId = data.trajectory_id;

            // Handle different trajectory ID formats
            if (typeof dataTrajectoryId === 'string') {
                if (dataTrajectoryId.includes('_')) {
                    // Format: "glyphIndex_trajectoryIndex"
                    const parts = dataTrajectoryId.split('_');
                    const trajectoryIndexPart = parseInt(parts[parts.length - 1]);
                    return trajectoryIndexPart === selectedTrajectory;
                } else {
                    // Simple string format
                    return parseInt(dataTrajectoryId) === selectedTrajectory;
                }
            } else {
                // Numeric trajectory ID
                return dataTrajectoryId === selectedTrajectory;
            }
        });

        if (selectedData) {
            return selectedData.gene_expression_data;
        } else {
            return null;
        }
    }, [geneExpressionData, selectedTrajectory, trajectoryIndex]);

    // Detect container size changes
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const updateDimensions = () => {
            const rect = container.getBoundingClientRect();
            setDimensions({
                width: Math.max(rect.width || 400, 300),
                height: Math.max(rect.height || 400, 300),
            });
        };

        // Initial measurement
        updateDimensions();

        const resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const { width, height } = entry.contentRect;
                setDimensions({
                    width: Math.max(width, 300),
                    height: Math.max(height, 300),
                });
            }
        });

        resizeObserver.observe(container);
        return () => resizeObserver.disconnect();
    }, []);

    useEffect(() => {
        // Check if we have valid pseudotime data in either structure
        let hasValidData = false;

        if (pseudotimeData) {
            if (pseudotimeData.trajectory_objects && Array.isArray(pseudotimeData.trajectory_objects) && pseudotimeData.trajectory_objects.length > 0) {
                hasValidData = true;
            }
        }

        if (hasValidData && dimensions.width > 0 && dimensions.height > 0) {
            createGlyph(pseudotimeData);
        }
    }, [pseudotimeData, dimensions, geneExpressionData, clusterColors, selectedTrajectory, selectedGeneData]);

    // Cleanup tooltip on unmount
    useEffect(() => {
        return () => {
            d3.select("body").selectAll(`.pseudotime-tooltip-${componentId}`).remove();
        };
    }, [componentId]);

    // Helper function to position tooltip within viewport
    const positionTooltip = (event, tooltip) => {
        const tooltipWidth = 300; // max-width set in CSS
        const tooltipHeight = 100; // estimated height

        let left = event.clientX + 15;
        let top = event.clientY - 10;

        // Check right boundary
        if (left + tooltipWidth > window.innerWidth) {
            left = event.clientX - tooltipWidth - 15;
        }

        // Check bottom boundary
        if (top + tooltipHeight > window.innerHeight) {
            top = event.clientY - tooltipHeight - 15;
        }

        // Check top boundary
        if (top < 0) {
            top = 10;
        }

        // Check left boundary
        if (left < 0) {
            left = 10;
        }

        tooltip.style("left", left + "px")
            .style("top", top + "px");
    };

    const createGlyph = (dataToUse) => {
        const svg = d3.select(svgRef.current);
        svg.selectAll("*").remove();

        // If no data, just clear the SVG and return
        if (!pseudotimeData) {
            return;
        }

        // Check if we have valid data in either structure
        let hasValidData = false;
        if (pseudotimeData.trajectory_objects && Array.isArray(pseudotimeData.trajectory_objects) && pseudotimeData.trajectory_objects.length > 0) {
            hasValidData = true;
        } else if (Array.isArray(pseudotimeData) && pseudotimeData.length > 0) {
            hasValidData = true;
        }

        if (!hasValidData) {
            return;
        }

        const { width, height } = dimensions;
        const margin = { top: 10, right: 15, bottom: 15, left: 15 };
        const innerWidth = width - margin.left - margin.right;
        const innerHeight = height - margin.top - margin.bottom;
        const centerX = innerWidth / 2;
        const centerY = innerHeight / 2;

        // Create main group
        const g = svg.append("g")
            .attr("transform", `translate(${margin.left}, ${margin.top})`);

        // Create tooltip (remove existing ones first to avoid duplicates)
        d3.select("body").selectAll(`.pseudotime-tooltip-${componentId}`).remove();
        const tooltip = d3.select("body")
            .append("div")
            .attr("class", `pseudotime-tooltip-${componentId}`)
            .style("position", "fixed")
            .style("visibility", "hidden")
            .style("background", "rgba(0, 0, 0, 0.9)")
            .style("color", "white")
            .style("padding", "10px")
            .style("border-radius", "6px")
            .style("font-size", "12px")
            .style("pointer-events", "none")
            .style("z-index", "9999")
            .style("max-width", "300px")
            .style("box-shadow", "0 4px 8px rgba(0,0,0,0.3)")
            .style("border", "1px solid rgba(255,255,255,0.2)");

        // Draw horizontal dividing line between gene expression (top) and cell trajectories (bottom)
        const axisLength = Math.min(innerWidth, innerHeight) * 0.98;
        g.append("line")
            .attr("x1", centerX - axisLength / 2)
            .attr("y1", centerY)
            .attr("x2", centerX + axisLength / 2)
            .attr("y2", centerY)
            .attr("stroke", "#333")
            .attr("stroke-width", 3)
            .attr("opacity", 0.8);

        // Process trajectory data
        let trajectories, clusterOrder;
        if (dataToUse.trajectory_objects && dataToUse.cluster_order) {
            trajectories = dataToUse.trajectory_objects;
            clusterOrder = dataToUse.cluster_order;
        } else {
            // Invalid structure
            console.warn('Invalid pseudotime data structure:', dataToUse);
            return;
        }

        const maxPseudotime = Math.max(...trajectories.flatMap(traj => {
            // Handle both 'pseudotimes' and 'pseudotime' property names
            const pseudotimeArray = traj.pseudotimes || traj.pseudotime || [];
            return pseudotimeArray.map(pt => parseFloat(pt));
        }));

        const minPseudotime = Math.min(...trajectories.flatMap(traj => {
            const pseudotimeArray = traj.pseudotimes || traj.pseudotime || [];
            return pseudotimeArray.map(pt => parseFloat(pt));
        }));

        // Color scale for different cell states/clusters
        const allClusters = clusterOrder ?
            clusterOrder.map(cluster => cluster.toString()) :
            [...new Set(trajectories.flatMap(traj => traj.path))];

        // Create structured data object for bottom section
        const structuredData = {
            trajectory_objects: trajectories,
            cluster_order: clusterOrder
        };

        // Use cluster colors from UMAP if available, otherwise use default colors
        let clusterColorScale;
        if (clusterColors) {
            // Create a color scale using the colors from the UMAP
            // Handle both full cluster names and numeric keys
            const colorRange = allClusters.map(cluster => {
                // Try the full cluster name first
                if (clusterColors[cluster]) {
                    return clusterColors[cluster];
                }
                // If not found, try extracting numeric part and use that as key
                const clusterNumber = cluster.toString().replace(/\D/g, '');
                return clusterColors[clusterNumber] || "#999";
            });
            clusterColorScale = d3.scaleOrdinal()
                .domain(allClusters)
                .range(colorRange);
        } else {
            // Fallback to default color scheme
            clusterColorScale = d3.scaleOrdinal(COLORS)
                .domain(allClusters);
        }

        // Add time point 0 circle at center
        g.append("circle")
            .attr("cx", centerX)
            .attr("cy", centerY)
            .attr("r", 8)
            .attr("fill", "#fff")
            .attr("stroke", "#333")
            .attr("stroke-width", 2)
            .attr("opacity", 0.9);

        // Add time point label - show actual minimum time if available
        g.append("text")
            .attr("x", centerX)
            .attr("y", centerY + 2)
            .attr("text-anchor", "middle")
            .attr("font-size", "5px")
            .attr("font-weight", "bold")
            .attr("fill", "#333")
            .text(`t${minPseudotime.toFixed(1)}`);

        // Create bottom section - macroscopic cell trajectories
        createBottomSection(g, structuredData, centerX, centerY, axisLength, maxPseudotime, minPseudotime, clusterColorScale, tooltip, selectedTrajectory, setSelectedTrajectory);

        // Create top section - gene expression gauge
        createTopSection(g, selectedGeneData, centerX, centerY, axisLength, maxPseudotime, minPseudotime, tooltip, selectedTrajectory);

        // Add title with UMAP parameters tooltip
        const titleText = svg.append("text")
            .attr("x", width / 2)
            .attr("y", height - 5)
            .attr("text-anchor", "middle")
            .attr("font-size", "12px")
            .attr("font-weight", "bold")
            .attr("fill", "#333")
            .style("cursor", "pointer")
            .text(adata_umap_title);

        // Add tooltip functionality for UMAP parameters
        if (umapParameters) {
            titleText
                .on("mouseover", function(event) {
                    const tooltipContent = `
                        <div style="font-size: 12px; line-height: 1.4;">
                            <div style="font-weight: bold; margin-bottom: 4px; color: #fff;">UMAP Parameters:</div>
                            <div style="color: #ccc;">Neighbors: ${umapParameters.n_neighbors}</div>
                            <div style="color: #ccc;">PCAs: ${umapParameters.n_pcas}</div>
                            <div style="color: #ccc;">Resolution: ${umapParameters.resolutions}</div>
                        </div>
                    `;
                    
                    tooltip.html(tooltipContent)
                        .style("visibility", "visible");
                    
                    positionTooltip(event, tooltip);
                })
                .on("mousemove", function(event) {
                    positionTooltip(event, tooltip);
                })
                .on("mouseout", function() {
                    tooltip.style("visibility", "hidden");
                });
        }
    };

    const createBottomSection = (g, trajectoryDataStructure, centerX, centerY, axisLength, maxPseudotime, minPseudotime, clusterColorScale, tooltip, selectedTrajectory, setSelectedTrajectory) => {
        const bottomSection = g.append("g").attr("class", "bottom-section");
        const maxRadius = axisLength / 2 - 15;

        // Draw light brown background for the lower semicircle (soil-like color)
        const arc = d3.arc()
            .innerRadius(0)
            .outerRadius(maxRadius)
            .startAngle(Math.PI / 2)
            .endAngle(Math.PI * 1.5);

        bottomSection.append("path")
            .attr("d", arc)
            .attr("transform", `translate(${centerX}, ${centerY})`)
            .attr("fill", "#D2B48C")
            .attr("opacity", 0.2)
            .attr("stroke", "none")
            .style("cursor", "pointer");

        // Use cluster_order if available, otherwise find all unique clusters across all trajectories
        let sortedClusters;
        if (trajectoryDataStructure.cluster_order && Array.isArray(trajectoryDataStructure.cluster_order)) {
            // Use the provided cluster_order for positioning
            sortedClusters = trajectoryDataStructure.cluster_order.map(cluster => parseInt(cluster));
        }
        const numLines = sortedClusters.length;

        // Create radial lines (avoiding horizontal lines)
        // Use mid-bin angles like in the semicircle visualization for bottom half
        const step = Math.PI / Math.max(numLines, 1);
        const angles = [];
        for (let i = 0; i < numLines; i++) {
            // Bottom semicircle: from 0 to π (right to left counterclockwise)
            angles.push(step / 2.0 + (i * step));
        }

        // Create a mapping from cluster ID to angle
        const clusterToAngle = new Map();
        sortedClusters.forEach((cluster, index) => {
            clusterToAngle.set(cluster, angles[index]);
        });

        // Draw radial lines for each cluster
        sortedClusters.forEach((cluster, index) => {
            const angle = angles[index];
            const x = maxRadius * Math.cos(angle);
            const y = maxRadius * Math.sin(angle);

            bottomSection.append("line")
                .attr("x1", centerX)
                .attr("y1", centerY)
                .attr("x2", centerX + x)
                .attr("y2", centerY + y)
                .attr("stroke", "#CCCCCC")
                .attr("stroke-width", 1)
                .attr("opacity", 0.6);

            // Add cluster labels at the end of each line
            bottomSection.append("text")
                .attr("x", centerX + x * 1.1)
                .attr("y", centerY + y * 1.1)
                .attr("text-anchor", "middle")
                .attr("dominant-baseline", "central")
                .attr("font-size", "10px")
                .attr("fill", "#555")
                .text(cluster.toString());
        });

        // Add concentric circles for time scale
        const timeScaleFractions = [0.25, 0.5, 0.75, 1.0];
        timeScaleFractions.forEach(fraction => {
            const timeValue = maxPseudotime * fraction;
            const radius = (8 + (maxRadius - 8) * fraction);

            // Draw semicircle arc for time indication (bottom half)
            const timeArc = d3.arc()
                .innerRadius(radius)
                .outerRadius(radius)
                .startAngle(0)           // Start from right (0 radians)
                .endAngle(Math.PI);      // End at left (π radians)

            bottomSection.append("path")
                .attr("d", timeArc)
                .attr("transform", `translate(${centerX}, ${centerY})`)
                .attr("fill", "none")
                .attr("stroke", "#E0E0E0")
                .attr("stroke-width", 0.5)
                .attr("stroke-dasharray", "2,2")
                .attr("opacity", 0.7);
        });

        // Scale for converting pseudotime to radial distance
        const radiusScale = d3.scaleLinear()
            .domain([minPseudotime, maxPseudotime])
            .range([8, maxRadius]); // Start from time point 0 circle edge (radius 8)

        // Color scale for different trajectories
        const trajectoryColors = COLORS;

        // Draw each trajectory
        const trajectories = trajectoryDataStructure.trajectory_objects || trajectoryDataStructure;
        trajectories.forEach((trajectory, trajIndex) => {
            const { path } = trajectory;
            // Handle both 'pseudotimes' and 'pseudotime' property names
            const pseudotimes = trajectory.pseudotimes || trajectory.pseudotime || [];
            const trajectoryColor = trajectoryColors[trajIndex % trajectoryColors.length];

            // Build interpolated points for smooth curves
            const trajectoryPoints = [];

            for (let i = 0; i < path.length; i++) {
                const cluster = parseInt(path[i]);
                const pseudotime = parseFloat(pseudotimes[i]);
                const angle = clusterToAngle.get(cluster);
                const radius = radiusScale(pseudotime);

                if (angle !== undefined) {
                    trajectoryPoints.push({
                        x: centerX + radius * Math.cos(angle),
                        y: centerY + radius * Math.sin(angle),
                        cluster: cluster,
                        pseudotime: pseudotime,
                        angle: angle,
                        radius: radius
                    });
                }
            }

            // Create smooth interpolated path between trajectory points
            if (trajectoryPoints.length > 1) {
                const pathData = [];

                for (let i = 0; i < trajectoryPoints.length - 1; i++) {
                    const current = trajectoryPoints[i];
                    const next = trajectoryPoints[i + 1];

                    // Number of interpolation points based on time difference
                    const timeDiff = Math.abs(next.pseudotime - current.pseudotime);
                    const numPoints = Math.max(12, Math.floor(60 * timeDiff / maxPseudotime));

                    for (let j = 0; j <= numPoints; j++) {
                        const t = j / numPoints;
                        const interpPseudotime = current.pseudotime + t * (next.pseudotime - current.pseudotime);
                        const interpAngle = current.angle + t * (next.angle - current.angle);
                        const interpRadius = radiusScale(interpPseudotime);

                        pathData.push({
                            x: centerX + interpRadius * Math.cos(interpAngle),
                            y: centerY + interpRadius * Math.sin(interpAngle)
                        });
                    }
                }

                // Draw trajectory path
                const line = d3.line()
                    .x(d => d.x)
                    .y(d => d.y)
                    .curve(d3.curveCardinal);

                const isSelected = trajIndex === selectedTrajectory;
                const strokeWidth = isSelected ? 5 : 3;
                const opacity = isSelected ? 1 : 0.2;

                // Apply grey color to non-selected trajectories
                const finalColor = isSelected ? trajectoryColor : "#CCCCCC";

                bottomSection.append("path")
                    .datum(pathData)
                    .attr("class", `trajectory-path trajectory-path-${trajIndex}`)
                    .attr("d", line)
                    .attr("fill", "none")
                    .attr("stroke", finalColor)
                    .attr("stroke-width", strokeWidth)
                    .attr("opacity", opacity)
                    .style("cursor", "pointer")
                    .on("mouseover", function (event) {
                        const isCurrentlySelected = trajIndex === selectedTrajectory;
                        const selectionText = isCurrentlySelected ? "Currently selected" : "Click to select";
                        tooltip.style("visibility", "visible")
                            .html(`<strong>Trajectory ${trajIndex + 1}</strong><br/>Path: ${path.join(' → ')}<br/>Time range: ${pseudotimes[0]?.toFixed(3) || 'N/A'} - ${pseudotimes[pseudotimes.length - 1]?.toFixed(3) || 'N/A'}<br/>${selectionText}`);
                        positionTooltip(event, tooltip);

                        // Highlight this trajectory on hover
                        if (!isSelected) {
                            // Restore original color and increase prominence for non-selected trajectories
                            d3.select(this)
                                .attr("stroke", trajectoryColor)
                                .attr("stroke-width", 4)
                                .attr("opacity", 1);
                        }
                    })
                    .on("mousemove", function (event) {
                        positionTooltip(event, tooltip);
                    })
                    .on("mouseout", function () {
                        tooltip.style("visibility", "hidden");
                        // Restore original appearance
                        if (!isSelected) {
                            d3.select(this)
                                .attr("stroke", "#CCCCCC")
                                .attr("stroke-width", 3)
                                .attr("opacity", 0.2);
                        }
                    })
                    .on("click", function () {
                        setSelectedTrajectory(trajIndex);
                    });
            }

            // Draw node markers at each time point
            trajectoryPoints.forEach((point, pointIndex) => {
                const isEndpoint = pointIndex === trajectoryPoints.length - 1;
                const isSelected = trajIndex === selectedTrajectory;

                // Get the correct cluster color, handling different cluster ID formats
                let clusterColor = "#999"; // fallback color
                if (clusterColors) {
                    // Try different formats for the cluster ID
                    const clusterId = point.cluster;
                    const clusterStr = clusterId.toString();
                    
                    // Try the numeric cluster ID first
                    if (clusterColors[clusterId]) {
                        clusterColor = clusterColors[clusterId];
                    }
                    // Try the string version
                    else if (clusterColors[clusterStr]) {
                        clusterColor = clusterColors[clusterStr];
                    }
                    // Try with "Cluster " prefix
                    else if (clusterColors[`Cluster ${clusterId}`]) {
                        clusterColor = clusterColors[`Cluster ${clusterId}`];
                    }
                    // Try extracting numeric part if it's a string
                    else {
                        const numericPart = clusterStr.replace(/\D/g, '');
                        if (clusterColors[numericPart]) {
                            clusterColor = clusterColors[numericPart];
                        }
                    }
                } else {
                    // Fallback to the color scale if no clusterColors provided
                    clusterColor = clusterColorScale(point.cluster);
                }

                // Use grey color for non-selected trajectories' nodes
                const nodeColor = isSelected ? clusterColor : "#CCCCCC";
                const originalNodeColor = clusterColor;

                if (isEndpoint) {
                    // Draw star for endpoints
                    const starElement = drawStar(bottomSection, point.x, point.y, 6, nodeColor, isSelected ? 0.9 : 0.6, `trajectory-node-${trajIndex}`);
                    
                    // Add data attribute for cluster information to help with legend hover
                    starElement.attr('data-cluster', point.cluster);

                    // Add hover effects for stars
                    if (!isSelected) {
                        starElement
                            .style("cursor", "pointer")
                            .on("mouseover", function (event) {
                                tooltip.style("visibility", "visible")
                                    .html(`<strong>Cluster ${point.cluster}</strong><br/>Pseudotime: ${point.pseudotime.toFixed(3)}<br/>Trajectory: ${trajIndex + 1}`);
                                positionTooltip(event, tooltip);

                                // Restore original color on hover
                                d3.select(this)
                                    .attr("fill", originalNodeColor)
                                    .attr("opacity", 1);
                            })
                            .on("mousemove", function (event) {
                                positionTooltip(event, tooltip);
                            })
                            .on("mouseout", function () {
                                tooltip.style("visibility", "hidden");

                                // Restore grey color
                                d3.select(this)
                                    .attr("fill", "#CCCCCC")
                                    .attr("opacity", 0.2);
                            });
                    } else {
                        // Add tooltip for selected trajectory stars
                        starElement
                            .style("cursor", "pointer")
                            .on("mouseover", function (event) {
                                tooltip.style("visibility", "visible")
                                    .html(`<strong>Cluster ${point.cluster}</strong><br/>Pseudotime: ${point.pseudotime.toFixed(3)}<br/>Trajectory: ${trajIndex + 1}`);
                                positionTooltip(event, tooltip);
                            })
                            .on("mousemove", function (event) {
                                positionTooltip(event, tooltip);
                            })
                            .on("mouseout", function () {
                                tooltip.style("visibility", "hidden");
                            });
                    }
                } else {
                    // Draw circle for intermediate points
                    bottomSection.append("circle")
                        .attr("class", `trajectory-node-${trajIndex}`)
                        .attr("data-cluster", point.cluster) // Add data attribute for cluster information
                        .attr("cx", point.x)
                        .attr("cy", point.y)
                        .attr("r", 4)
                        .attr("fill", nodeColor)
                        .attr("stroke", "#fff")
                        .attr("stroke-width", 1)
                        .attr("opacity", isSelected ? 1 : 0.2)
                        .style("cursor", "pointer")
                        .on("mouseover", function (event) {
                            tooltip.style("visibility", "visible")
                                .html(`<strong>Cluster ${point.cluster}</strong><br/>Pseudotime: ${point.pseudotime.toFixed(3)}<br/>Trajectory: ${trajIndex + 1}`);
                            positionTooltip(event, tooltip);

                            // Restore original color on hover for non-selected trajectories
                            if (!isSelected) {
                                d3.select(this)
                                    .attr("fill", originalNodeColor)
                                    .attr("opacity", 1);
                            }
                        })
                        .on("mousemove", function (event) {
                            positionTooltip(event, tooltip);
                        })
                        .on("mouseout", function () {
                            tooltip.style("visibility", "hidden");

                            // Restore grey color for non-selected trajectories
                            if (!isSelected) {
                                d3.select(this)
                                    .attr("fill", "#CCCCCC")
                                    .attr("opacity", 0.2);
                            }
                        });
                }
            });
        });
    };

    const createTopSection = (g, geneData, centerX, centerY, axisLength, maxPseudotime, minPseudotime, tooltip, selectedTrajectory) => {
        const maxRadius = axisLength / 2 - 15;
        const topSection = g.append("g").attr("class", "top-section");

        // Left arc for Low Expression (red)
        const lowExprArc = d3.arc()
            .innerRadius(8)
            .outerRadius(maxRadius)
            .startAngle(Math.PI * 1.5)
            .endAngle(Math.PI * 1.6);

        topSection.append("path")
            .attr("d", lowExprArc)
            .attr("transform", `translate(${centerX}, ${centerY})`)
            .attr("fill", "red")
            .attr("opacity", 0.1)
            .attr("stroke", "none");

        // Right arc for High Expression (green)
        const highExprArc = d3.arc()
            .innerRadius(8)
            .outerRadius(maxRadius)
            .startAngle(Math.PI * 2.4)
            .endAngle(Math.PI * 2.5);

        topSection.append("path")
            .attr("d", highExprArc)
            .attr("transform", `translate(${centerX}, ${centerY})`)
            .attr("fill", "green")
            .attr("opacity", 0.1)
            .attr("stroke", "none");

        // Add concentric circles for time progression using trajectory data time range
        // These should always be shown as a time reference
        const trajectoryTimeRange = maxPseudotime - minPseudotime;
        const numTimeCircles = 4;
        for (let i = 1; i <= numTimeCircles; i++) {
            const time = minPseudotime + (i / numTimeCircles) * trajectoryTimeRange;
            const radius = 8 + ((time - minPseudotime) / trajectoryTimeRange) * (maxRadius - 8);

            // Draw complete circles
            topSection.append("circle")
                .attr("cx", centerX)
                .attr("cy", centerY)
                .attr("r", radius)
                .attr("fill", "none")
                .attr("stroke", "black")
                .attr("stroke-width", 1)
                .attr("opacity", 0.2);

            // Add time labels at the top of each circle
            topSection.append("text")
                .attr("x", centerX)
                .attr("y", centerY - radius - 5)
                .attr("text-anchor", "middle")
                .attr("font-size", "8px")
                .attr("fill", "#666")
                .text(`t${time.toFixed(1)}`);
        }

        // Add expression level indicators for upper semicircle (always show these)
        topSection.append("text")
            .attr("x", centerX - maxRadius * 0.7)
            .attr("y", centerY - 5)
            .attr("text-anchor", "middle")
            .attr("font-size", "10px")
            .attr("fill", "#666")
            .text("Low Expr");

        topSection.append("text")
            .attr("x", centerX + maxRadius * 0.7)
            .attr("y", centerY - 5)
            .attr("text-anchor", "middle")
            .attr("font-size", "10px")
            .attr("fill", "#666")
            .text("High Expr");

        // Only proceed with gene expression specific elements if data is provided
        if (!geneData || !Array.isArray(geneData) || geneData.length === 0) {
            return;
        }

        // Draw upper semicircle background for gene expression area
        // Time point scale (radial distance represents time progression)
        // Use the same scaling as concentric circles and trajectory data
        const timeScale = d3.scaleLinear()
            .domain([minPseudotime, maxPseudotime])
            .range([8, maxRadius]); // Start from time point 0 circle edge (radius 8)

        // Expression scale (angular position - higher expression = more to the right)
        // Upper half only: from left (π) to right (2π) of the upper semicircle
        const expressionScale = d3.scaleLinear()
            .domain([0, 1])
            .range([Math.PI, 2 * Math.PI]); // From left side (180°) to right side (360°) through upper half

        // Gene colors using custom color scheme
        const geneColors = COLORS;

        geneData.forEach((geneInfo, geneIndex) => {
            const color = geneColors[geneIndex % geneColors.length];

            // Create expression points where angular position is determined by expression level
            const expressionPoints = geneInfo.timePoints.map((timePoint, i) => {
                // Radius is determined by time point (progression outward)
                const radius = timeScale(timePoint);
                // Angle is determined by expression level (higher = more to the right)
                const angle = expressionScale(geneInfo.expressions[i]);

                return {
                    x: centerX + Math.cos(angle) * radius,
                    y: centerY + Math.sin(angle) * radius,
                    timePoint: timePoint,
                    expression: geneInfo.expressions[i],
                    angle: angle,
                    radius: radius
                };
            });

            // Customizable curve generation function for handling angular wraparound
            const generateCustomCurve = (points, options = {}) => {
                if (points.length < 2) return null;

                const settings = {
                    samplesPerSegment: options.samplesPerSegment || 24,
                    bulgeFactor: options.bulgeFactor ?? 0.18, // 0..1 of radial gap
                };

                // Helpers
                const normalizeAngle = (angle) => {
                    let a = angle;
                    while (a < 0) a += 2 * Math.PI;
                    while (a >= 2 * Math.PI) a -= 2 * Math.PI;
                    return a;
                };

                const unwrapToShortestUpperHalf = (from, to) => {
                    // Keep path across the shortest angular distance
                    let a0 = normalizeAngle(from);
                    let a1 = normalizeAngle(to);
                    let diff = a1 - a0;
                    if (diff > Math.PI) a1 -= 2 * Math.PI;
                    else if (diff < -Math.PI) a1 += 2 * Math.PI;
                    return { a0, a1 };
                };

                let pathData = `M ${points[0].x} ${points[0].y}`;

                for (let i = 1; i < points.length; i++) {
                    const currentPoint = points[i - 1];
                    const nextPoint = points[i];

                    // Radii for concentric bounds
                    const rCurrent = Math.hypot(currentPoint.x - centerX, currentPoint.y - centerY);
                    const rNext = Math.hypot(nextPoint.x - centerX, nextPoint.y - centerY);
                    const rMin = Math.min(rCurrent, rNext);
                    const rMax = Math.max(rCurrent, rNext);

                    // Angles, constrained to the upper half [π, 2π]
                    const angCurrent = Math.atan2(currentPoint.y - centerY, currentPoint.x - centerX);
                    const angNext = Math.atan2(nextPoint.y - centerY, nextPoint.x - centerX);
                    const { a0, a1 } = unwrapToShortestUpperHalf(angCurrent, angNext);

                    // Generate interpolated points that stay between rMin..rMax and in upper half
                    const n = Math.max(2, settings.samplesPerSegment);
                    for (let s = 1; s < n; s++) {
                        const t = s / n;

                        // Interpolate angle along the shortest path
                        let a = a0 + (a1 - a0) * t;
                        let aNorm = normalizeAngle(a);
                        // Force to upper half if numerical artifacts occur
                        if (aNorm < Math.PI) aNorm = 2 * Math.PI - aNorm;

                        // Interpolate radius with optional smooth bulge, then clamp to [rMin, rMax]
                        const rLinear = rCurrent + (rNext - rCurrent) * t;
                        const gap = rMax - rMin;
                        const rBulge = rLinear + gap * settings.bulgeFactor * Math.sin(Math.PI * t);
                        const r = Math.max(rMin, Math.min(rMax, rBulge));

                        const x = centerX + Math.cos(aNorm) * r;
                        const y = centerY + Math.sin(aNorm) * r; // sin(aNorm) <= 0 in [π, 2π]
                        pathData += ` L ${x} ${y}`;
                    }

                    // Ensure we land exactly on the next point
                    pathData += ` L ${nextPoint.x} ${nextPoint.y}`;
                }

                return pathData;
            };

            // Prepare points for custom curve (including starting point if needed)
            let curvePoints = [...expressionPoints];

            // Add starting point from time 0 circle edge if first point is not at time 0
            if (expressionPoints.length > 0 && expressionPoints[0].radius > 8) {
                const firstPoint = expressionPoints[0];
                const angle = Math.atan2(firstPoint.y - centerY, firstPoint.x - centerX);
                const startX = centerX + Math.cos(angle) * 8;
                const startY = centerY + Math.sin(angle) * 8;

                curvePoints = [
                    { x: startX, y: startY },
                    ...expressionPoints
                ];
            }

            // Calculate average expression for this gene (normalized between 0 and 1)
            const avgExpression = geneInfo.expressions.reduce((a, b) => a + b, 0) / geneInfo.expressions.length;

            // Draw custom curve through all points
            if (curvePoints.length > 1) {
                // Configuration for curve behavior - can be customized based on needs
                const curveOptions = {
                    angularThreshold: Math.PI / 3,      // 60 degrees - when to use convex curves
                    convexMultiplier: 1.3,              // How much to extend convex curves
                    minConvexExtension: 25,             // Minimum extension for convex curves
                    normalCurveMultiplier: 1.15,        // Normal curve extension
                    useShortestPath: true               // Use shortest angular path
                };

                const customPath = generateCustomCurve(curvePoints, curveOptions);

                if (customPath) {
                    const curvePath = topSection.append("path")
                        .attr("d", customPath)
                        .attr("stroke", color)
                        .attr("stroke-width", 3)
                        .attr("fill", "none")
                        .attr("opacity", 0.6)
                        .attr("stroke-linecap", "round")
                        .attr("stroke-linejoin", "round")
                        .style("cursor", "pointer");

                    // Create average expression radius indicator (initially hidden)
                    // The angle is already constrained to upper half (π to 2π) by expressionScale
                    const avgAngle = expressionScale(avgExpression);
                    const avgEndX = centerX + Math.cos(avgAngle) * maxRadius;
                    const avgEndY = centerY + Math.sin(avgAngle) * maxRadius;
                    
                    const avgRadiusIndicator = topSection.append("line")
                        .attr("class", `avg-expression-radius-${geneIndex}`)
                        .attr("x1", centerX)
                        .attr("y1", centerY)
                        .attr("x2", avgEndX)
                        .attr("y2", avgEndY)
                        .attr("stroke", color)
                        .attr("stroke-width", 2)
                        .attr("stroke-dasharray", "5,3")
                        .attr("opacity", 0)
                        .style("pointer-events", "none");

                    // Add a small circle at the end of the radius to make it more visible
                    const avgRadiusEndPoint = topSection.append("circle")
                        .attr("class", `avg-expression-endpoint-${geneIndex}`)
                        .attr("cx", avgEndX)
                        .attr("cy", avgEndY)
                        .attr("r", 3)
                        .attr("fill", color)
                        .attr("stroke", "#fff")
                        .attr("stroke-width", 1)
                        .attr("opacity", 0)
                        .style("pointer-events", "none");

                    curvePath
                        .on("mouseover", function (event) {
                            d3.select(this)
                                .attr("stroke-width", 4)
                                .attr("opacity", 1);

                            // Show the average expression radius indicator
                            avgRadiusIndicator
                                .attr("opacity", 0.8);
                            avgRadiusEndPoint
                                .attr("opacity", 0.9);

                            const minExpression = Math.min(...geneInfo.expressions);
                            const maxExpression = Math.max(...geneInfo.expressions);
                            const avgExpressionFormatted = avgExpression.toFixed(2);
                            const timeSpan = `${geneInfo.timePoints[0].toFixed(4)} - ${geneInfo.timePoints[geneInfo.timePoints.length - 1].toFixed(4)}`;

                            tooltip.style("visibility", "visible")
                                .html(`
                                <div><strong>Gene Expression: ${geneInfo.gene}</strong></div>
                                <div>Time span: ${timeSpan}</div>
                                <div>Expression range: ${minExpression.toFixed(2)} - ${maxExpression.toFixed(2)}</div>
                                <div>Average expression: ${avgExpressionFormatted}</div>
                                <div style="font-style: italic; color: #ccc; font-size: 11px;">Dashed line shows average expression level</div>
                            `);
                            positionTooltip(event, tooltip);
                        })
                        .on("mousemove", function (event) {
                            positionTooltip(event, tooltip);
                        })
                        .on("mouseout", function () {
                            d3.select(this)
                                .attr("stroke-width", 3)
                                .attr("opacity", 0.6);
                            
                            // Hide the average expression radius indicator
                            avgRadiusIndicator
                                .attr("opacity", 0);
                            avgRadiusEndPoint
                                .attr("opacity", 0);
                            
                            tooltip.style("visibility", "hidden");
                        });
                }
            }

            // Draw all points
            expressionPoints.forEach((point, i) => {
                topSection.append("circle")
                    .attr("cx", point.x)
                    .attr("cy", point.y)
                    .attr("r", 3)
                    .attr("fill", color)
                    .attr("stroke", "#fff")
                    .attr("opacity", 0.6)
                    .style("cursor", "pointer")
                    .on("mouseover", function (event) {
                        d3.select(this)
                            .attr("r", 5)
                            .attr("opacity", 1);

                        // Show the average expression radius indicator
                        topSection.select(`.avg-expression-radius-${geneIndex}`)
                            .attr("opacity", 0.8);
                        topSection.select(`.avg-expression-endpoint-${geneIndex}`)
                            .attr("opacity", 0.9);

                        const avgExpressionFormatted = avgExpression.toFixed(2);
                        tooltip.style("visibility", "visible")
                            .html(`
                                <div><strong>Gene Expression Point</strong></div>
                                <div>Gene: ${geneInfo.gene}</div>
                                <div>Time: ${point.timePoint.toFixed(2)}</div>
                                <div>Expression: ${point.expression.toFixed(3)}</div>
                                <div>Average expression: ${avgExpressionFormatted}</div>
                                <div style="font-style: italic; color: #ccc; font-size: 11px;">Dashed line shows average expression level</div>
                            `);
                        positionTooltip(event, tooltip);
                    })
                    .on("mousemove", function (event) {
                        positionTooltip(event, tooltip);
                    })
                    .on("mouseout", function () {
                        d3.select(this)
                            .attr("r", 3)
                            .attr("opacity", 0.6);
                        
                        // Hide the average expression radius indicator
                        topSection.select(`.avg-expression-radius-${geneIndex}`)
                            .attr("opacity", 0);
                        topSection.select(`.avg-expression-endpoint-${geneIndex}`)
                            .attr("opacity", 0);
                        
                        tooltip.style("visibility", "hidden");
                    });
            });
        });

        // Add selected trajectory indicator if gene data is available
        if (geneData && Array.isArray(geneData) && geneData.length > 0) {
            const selectedData = geneData.find(data => {
                const dataTrajectoryId = data.trajectory_id;
                if (typeof dataTrajectoryId === 'string') {
                    if (dataTrajectoryId.includes('_')) {
                        const parts = dataTrajectoryId.split('_');
                        const trajectoryIndexPart = parseInt(parts[parts.length - 1]);
                        return trajectoryIndexPart === selectedTrajectory;
                    } else {
                        return parseInt(dataTrajectoryId) === selectedTrajectory;
                    }
                } else {
                    return dataTrajectoryId === selectedTrajectory;
                }
            });
        }
    };

    const drawStar = (parent, cx, cy, radius, color, opacity = 1, className = '') => {
        const starPoints = 5;
        const angle = Math.PI / starPoints;
        let path = "";

        for (let i = 0; i < 2 * starPoints; i++) {
            const r = i % 2 === 0 ? radius : radius * 0.5;
            const x = cx + Math.cos(i * angle) * r;
            const y = cy + Math.sin(i * angle) * r;
            path += i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`;
        }
        path += " Z";

        return parent.append("path")
            .attr("class", className)
            .attr("d", path)
            .attr("fill", color)
            .attr("stroke", "#fff")
            .attr("stroke-width", 1)
            .attr("opacity", opacity);
    };

    return (
        <div ref={containerRef} style={{ width: "100%", height: "100%", position: "relative", boxSizing: 'border-box' }}>
            {/* Color bar for area selection */}
            {areaColor && (
                <div
                    style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        right: 0,
                        height: "4px",
                        backgroundColor: areaColor,
                        zIndex: 10,
                        boxShadow: "0 1px 2px rgba(0,0,0,0.1)"
                    }}
                    title={areaName ? `Region: ${areaName}` : "Selected Region"}
                />
            )}
            
            {/* Checkbox in upper left corner */}
            <div style={{
                position: 'absolute',
                top: areaColor ? '9px' : '5px', // Adjust position if color bar is present
                left: '5px',
                zIndex: 999,
                backgroundColor: 'rgba(255, 255, 255, 0.8)',
                borderRadius: '4px',
                padding: '2px'
            }}>
                <Checkbox
                    checked={isSelected}
                    onChange={(e) => onSelectionChange && onSelectionChange(e.target.checked)}
                    size="small"
                />
            </div>
            {/* Legend in upper right corner */}
            {(() => {
                // Build legend items from pseudotime data
                const legendItems = (() => {
                    if (!pseudotimeData || !pseudotimeData.trajectory_objects || !Array.isArray(pseudotimeData.trajectory_objects)) return [];
                    const tc = COLORS;
                    return pseudotimeData.trajectory_objects.map((traj, i) => ({
                        index: i,
                        name: traj.name || `Trajectory ${i + 1}`,
                        color: tc[i % tc.length],
                        sequence: Array.isArray(traj.path) ? traj.path.join(' \u2192 ') : '',
                        coverage: traj.coverage || 0,
                        validCells: traj.valid_cells || 0,
                        totalCells: traj.total_cells || 0
                    }));
                })();

                const handleLegendEnter = (hoveredIndex) => {
                    const svg = d3.select(svgRef.current);
                    
                    // Update all trajectories
                    legendItems.forEach((item, index) => {
                        const path = svg.select(`.trajectory-path-${index}`);
                        const nodes = svg.selectAll(`.trajectory-node-${index}`);
                        
                        if (!path.empty()) {
                            if (index === hoveredIndex) {
                                // Highlight the hovered trajectory path
                                path.attr('stroke', COLORS[index % COLORS.length])
                                    .attr('stroke-width', 4)
                                    .attr('opacity', 1);
                                
                                // Highlight the hovered trajectory nodes - restore original colors
                                nodes.each(function(d, i) {
                                    const node = d3.select(this);
                                    // Get the original color from cluster colors or use trajectory color
                                    let originalColor = COLORS[index % COLORS.length];
                                    if (clusterColors) {
                                        // Try to get cluster-specific color if available
                                        const clusterAttr = node.attr('data-cluster');
                                        if (clusterAttr && clusterColors[clusterAttr]) {
                                            originalColor = clusterColors[clusterAttr];
                                        }
                                    }
                                    node.attr('fill', originalColor).attr('opacity', 1);
                                });
                            } else {
                                // Reduce transparency for all other trajectories (including selected)
                                path.attr('stroke', '#CCCCCC')
                                    .attr('stroke-width', 3)
                                    .attr('opacity', 0.2);
                                
                                // Reduce transparency for all other trajectory nodes
                                nodes.attr('fill', '#CCCCCC').attr('opacity', 0.2);
                            }
                        }
                    });
                };
                const handleLegendLeave = (i) => {
                    const svg = d3.select(svgRef.current);
                    
                    // Restore original appearance for all trajectories
                    legendItems.forEach((item, index) => {
                        const path = svg.select(`.trajectory-path-${index}`);
                        const nodes = svg.selectAll(`.trajectory-node-${index}`);
                        
                        if (!path.empty()) {
                            if (index === selectedTrajectory) {
                                // Restore selected trajectory path appearance
                                path.attr('stroke', COLORS[index % COLORS.length])
                                    .attr('stroke-width', 5)
                                    .attr('opacity', 1);
                                
                                // Restore selected trajectory nodes appearance with original colors
                                nodes.each(function(d, i) {
                                    const node = d3.select(this);
                                    let originalColor = COLORS[index % COLORS.length];
                                    if (clusterColors) {
                                        const clusterAttr = node.attr('data-cluster');
                                        if (clusterAttr && clusterColors[clusterAttr]) {
                                            originalColor = clusterColors[clusterAttr];
                                        }
                                    }
                                    node.attr('fill', originalColor).attr('opacity', 1);
                                });
                            } else {
                                // Restore non-selected trajectory path appearance
                                path.attr('stroke', '#CCCCCC')
                                    .attr('stroke-width', 3)
                                    .attr('opacity', 0.2);
                                
                                // Restore non-selected trajectory nodes appearance
                                nodes.attr('fill', '#CCCCCC').attr('opacity', 0.2);
                            }
                        }
                    });
                };

                if (legendItems.length === 0) return null;

                return (
                    <div style={{
                        position: 'absolute',
                        top: areaColor ? '34px' : '30px', // Adjust position if color bar is present
                        right: '5px',
                        zIndex: 999,
                        backgroundColor: 'rgba(255, 255, 255, 0.7)',
                        borderRadius: '4px',
                        padding: '3px 6px',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
                        maxWidth: '48%'
                    }}>
                        {legendItems.map(item => (
                            <div
                                key={item.index}
                                onMouseEnter={() => handleLegendEnter(item.index)}
                                onMouseLeave={() => handleLegendLeave(item.index)}
                                onClick={() => setSelectedTrajectory(item.index)}
                                style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px', cursor: 'pointer' }}
                            >
                                <div style={{ width: 8, height: 8, backgroundColor: item.color, flexShrink: 0 }} />
                                <Tooltip placement="left" title={
                                    <div>
                                        <div>Clusters: {item.sequence}</div>
                                        <div>Coverage: {(item.coverage * 100).toFixed(1)}% ({item.validCells}/{item.totalCells} cells)</div>
                                    </div>
                                }>
                                    <span style={{ fontSize: '10px', color: '#333', fontWeight: item.index === selectedTrajectory ? 600 : 400 }}>
                                        {item.name}
                                    </span>
                                </Tooltip>
                            </div>
                        ))}
                    </div>
                );
            })()}
            {pseudotimeLoading && (
                <div style={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)'
                }}>
                    <Spin size="large" />
                </div>
            )}
            {!pseudotimeLoading && (() => {
                if (!pseudotimeData) return true;

                if (pseudotimeData.trajectory_objects && Array.isArray(pseudotimeData.trajectory_objects)) {
                    return pseudotimeData.trajectory_objects.length === 0;
                } else if (Array.isArray(pseudotimeData)) {
                    return pseudotimeData.length === 0;
                }

                return true;
            })() ? (
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '100%',
                    height: '100%'
                }}>
                    <Empty
                        description="No pseudotime data available"
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                    />
                </div>
            ) : (
                <svg
                    ref={svgRef}
                    width={dimensions.width}
                    height={dimensions.height}
                    viewBox={`0 0 ${dimensions.width} ${dimensions.height}`}
                    style={{
                        width: '100%',
                        height: '100%',
                        display: 'block',
                        backgroundColor: '#f9f9f9'
                    }}
                    preserveAspectRatio="xMidYMid meet"
                />
            )}
        </div>
    );
};