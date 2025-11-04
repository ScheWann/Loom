import React, { useRef, useEffect, useState } from "react";
import * as d3 from "d3";
import { COLOR_BREWER2_PALETTE } from "./Utils";

const COLORS = COLOR_BREWER2_PALETTE;

export const LineChart = ({
  data,
  datasets,
  xAccessor,
  yAccessor,
  margin = { top: 40, right: 30, bottom: 50, left: 60 },
  showErrorBands = true,
  yMinAccessor,
  yMaxAccessor,
  errorBandOpacity = 0.3,
  lineColor = "#1d72b8",
  showLegend = false,
  onMouseMove,
  onMouseLeave,
}) => {
  const svgRef = useRef();
  const containerRef = useRef();
  const [dimensions, setDimensions] = useState({ width: 400, height: 200 });

  // Detect container size changes
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Initial measurement
    const updateDimensions = () => {
      const rect = container.getBoundingClientRect();
      setDimensions({
        width: Math.max(rect.width, 200),
        height: Math.max(rect.height, 150),
      });
    };

    // Measure immediately
    updateDimensions();

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setDimensions({
          width: Math.max(width, 200),
          height: Math.max(height, 150),
        });
      }
    });

    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, []);

  // Handle array of numbers or array of objects, or multiple datasets
  let allDatasets = [];

  if (datasets && datasets.length > 0) {
    // Multiple datasets mode
    allDatasets = datasets;
  } else if (data) {
    // Single dataset mode (backward compatibility)
    let processedData, xAcc, yAcc;
    if (typeof data[0] === "number") {
      processedData = data.map((y, i) => ({ x: i, y }));
      xAcc = (d) => d.x;
      yAcc = (d) => d.y;
    } else {
      processedData = data;
      xAcc = xAccessor;
      yAcc = yAccessor;
    }

    allDatasets = [{
      data: processedData,
      xAccessor: xAcc,
      yAccessor: yAcc,
      yMinAccessor,
      yMaxAccessor,
      lineColor,
    }];
  }

  useEffect(() => {
    if (!allDatasets || allDatasets.length === 0) return;

    d3.select(svgRef.current).selectAll("*").remove();

    // Calculate space needed for legend
    const legendHeight = showLegend ? 25 : 0; // Space for legend

    // Use full parent height for SVG
    const svgHeight = dimensions.height;

    // Adjust margin to account for legend space at bottom
    const adjustedMargin = {
      ...margin,
      bottom: margin.bottom + legendHeight + (legendHeight > 0 ? 0 : 0) // Add legend space to bottom margin
    };

    const innerWidth = dimensions.width - adjustedMargin.left - adjustedMargin.right;
    const innerHeight = svgHeight - adjustedMargin.top - adjustedMargin.bottom;

    if (innerWidth <= 0 || innerHeight <= 0) return;

    // Collect all x and y values from all datasets
    const allXValues = [];
    const allYValues = [];
    const allYMinValues = [];
    const allYMaxValues = [];

    allDatasets.forEach(dataset => {
      console.log(dataset);
      if (dataset.data && dataset.data.length > 0) {
        const xValues = dataset.data.map(dataset.xAccessor);
        const yValues = dataset.data.map(dataset.yAccessor);
        allXValues.push(...xValues);
        allYValues.push(...yValues);

        if (showErrorBands && dataset.yMinAccessor && dataset.yMaxAccessor) {
          const yMinValues = dataset.data.map(dataset.yMinAccessor);
          const yMaxValues = dataset.data.map(dataset.yMaxAccessor);
          allYMinValues.push(...yMinValues);
          allYMaxValues.push(...yMaxValues);
        }
      }
    });

    // Calculate domains
    const xDomain = d3.extent(allXValues);
    let yDomain;
    if (showErrorBands && allYMinValues.length > 0 && allYMaxValues.length > 0) {
      yDomain = [
        d3.min([...allYValues, ...allYMinValues]),
        d3.max([...allYValues, ...allYMaxValues])
      ];
    } else {
      yDomain = d3.extent(allYValues);
    }

    const xScale = d3.scaleLinear().domain(xDomain).nice().range([0, innerWidth]);
    const yScale = d3.scaleLinear().domain(yDomain).nice().range([innerHeight, 0]);

    // Color scale for multiple datasets
    const colorScale = d3.scaleOrdinal(COLORS);

    const svg = d3
      .select(svgRef.current)
      .attr("width", dimensions.width)
      .attr("height", svgHeight);

    const g = svg
      .append("g")
      .attr("transform", `translate(${adjustedMargin.left},${adjustedMargin.top})`);

    // Render each dataset
    allDatasets.forEach((dataset, index) => {
      if (!dataset.data || dataset.data.length === 0) return;

      const datasetColor = dataset.lineColor || colorScale(index);

      // Create line generator for this dataset
      const line = d3
        .line()
        .x((d) => xScale(dataset.xAccessor(d)))
        .y((d) => yScale(dataset.yAccessor(d)))
        .curve(d3.curveMonotoneX);

      // Create area generator for error bands if available
      const area = showErrorBands && dataset.yMinAccessor && dataset.yMaxAccessor ? d3.area()
        .x((d) => xScale(dataset.xAccessor(d)))
        .y0((d) => yScale(dataset.yMinAccessor(d)))
        .y1((d) => yScale(dataset.yMaxAccessor(d)))
        .curve(d3.curveMonotoneX) : null;

      // Add error band first (so it appears behind the line)
      if (area) {
        g.append("path")
          .datum(dataset.data)
          .attr("fill", datasetColor)
          .attr("fill-opacity", errorBandOpacity)
          .attr("d", area);
      }

      // Add line
      g.append("path")
        .datum(dataset.data)
        .attr("fill", "none")
        .attr("stroke", datasetColor)
        .attr("stroke-width", 2)
        .attr("d", line);
    });

    // Add axes
    g.append("g")
      .attr("transform", `translate(0,${innerHeight})`)
      .call(d3.axisBottom(xScale));

    g.append("g").call(d3.axisLeft(yScale));

    // Add labels
    svg
      .append("text")
      .attr("x", adjustedMargin.left + innerWidth / 2)
      .attr("y", adjustedMargin.top + innerHeight + 35)
      .attr("text-anchor", "middle")
      .attr("font-size", 12)
      .text("Distance along Trajectory[mm]");

    svg
      .append("text")
      .attr("transform", `rotate(-90)`)
      .attr("x", -svgHeight / 2.5)
      .attr("y", 25)
      .attr("text-anchor", "middle")
      .attr("font-size", 12)
      .text("Estimated Expression");

    // Add legend for datasets
    if (showLegend) {
      const legend = svg.append("g")
        .attr("transform", `translate(${adjustedMargin.left}, ${svgHeight - legendHeight - 5})`);

      const legendSpacing = Math.min(innerWidth / allDatasets.length, 60);

      allDatasets.forEach((dataset, index) => {
        const legendGroup = legend.append("g")
          .attr("transform", `translate(${index * legendSpacing}, 0)`);

        const datasetColor = dataset.lineColor || colorScale(index);

        legendGroup.append("line")
          .attr("x1", 0)
          .attr("x2", 15)
          .attr("y1", 10)
          .attr("y2", 10)
          .attr("stroke", datasetColor)
          .attr("stroke-width", 2);

        legendGroup.append("text")
          .attr("x", 20)
          .attr("y", 10)
          .attr("dy", "0.35em")
          .attr("font-size", 10)
          .text(dataset.label || `Dataset ${index + 1}`);
      });
    }

    // Add invisible overlay for mouse interaction
    if (onMouseMove || onMouseLeave) {
      const overlay = g.append("rect")
        .attr("class", "overlay")
        .attr("width", innerWidth)
        .attr("height", innerHeight)
        .style("fill", "none")
        .style("pointer-events", "all");

      // Add vertical guideline
      const guideline = g.append("line")
        .attr("class", "guideline")
        .style("stroke", "#666")
        .style("stroke-width", 1)
        .style("stroke-dasharray", "3,3")
        .style("pointer-events", "none")
        .style("opacity", 0);

      if (onMouseMove) {
        overlay.on("mousemove", function(event) {
          const [mouseX] = d3.pointer(event);
          const xValue = xScale.invert(mouseX);
          
          // Update guideline position
          guideline
            .attr("x1", mouseX)
            .attr("x2", mouseX)
            .attr("y1", 0)
            .attr("y2", innerHeight)
            .style("opacity", 1);

          // Call parent callback with normalized position (0-1)
          const normalizedPosition = mouseX / innerWidth;
          onMouseMove(normalizedPosition, xValue);
        });
      }

      if (onMouseLeave) {
        // Leaving the overlay (inner plotting area)
        overlay.on("mouseleave", function() {
          guideline.style("opacity", 0);
          onMouseLeave();
        });

        // Also handle leaving the entire SVG (e.g., moving into margins or outside the component)
        svg.on("mouseleave", function() {
          guideline.style("opacity", 0);
          onMouseLeave();
        });

        // Defensive: handle cases where the pointer leaves the document/window rapidly
        svg.on("mouseout", function(event) {
          const related = event.relatedTarget;
          if (!related || !(this.contains && this.contains(related))) {
            guideline.style("opacity", 0);
            onMouseLeave();
          }
        });
      }
    }
  }, [allDatasets, dimensions, margin, showErrorBands, errorBandOpacity, showLegend]);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%' }}>
      <svg ref={svgRef}></svg>
    </div>
  );
};
