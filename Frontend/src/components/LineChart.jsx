import React, { useRef, useEffect, useState } from "react";
import * as d3 from "d3";
import { COLOR_BREWER2_PALETTE } from "./Utils";

const COLORS = COLOR_BREWER2_PALETTE;

const LEGEND_FONT = "10px sans-serif";
const LEGEND_SWATCH_WIDTH = 15; // Colored line in front of the label
const LEGEND_LABEL_OFFSET = 20; // Where the label starts within an item
const LEGEND_ITEM_GAP = 28; // Breathing room between two genes
const LEGEND_ROW_HEIGHT = 16;

// Measuring the labels beats guessing a fixed column width: gene names vary in length,
// and a fixed width leaves long names almost touching the next entry.
const measureLabelWidth = (() => {
  let context;
  return (text) => {
    if (!context) {
      context = document.createElement("canvas").getContext("2d");
      context.font = LEGEND_FONT;
    }
    return context.measureText(text).width;
  };
})();

// Place legend entries left to right, wrapping to another row when they run out of width.
const layoutLegend = (datasets, availableWidth) => {
  let x = 0;
  let row = 0;

  const items = datasets.map((dataset, index) => {
    const label = dataset.label || `Dataset ${index + 1}`;
    const width = LEGEND_LABEL_OFFSET + measureLabelWidth(label);

    if (x > 0 && x + width > availableWidth) {
      x = 0;
      row += 1;
    }

    const item = { label, x, row };
    x += width + LEGEND_ITEM_GAP;
    return item;
  });

  return { items, rows: datasets.length > 0 ? row + 1 : 0 };
};

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
        width: Math.max(rect.width, 160),
        height: Math.max(rect.height, 100),
      });
    };

    // Measure immediately
    updateDimensions();

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setDimensions({
          width: Math.max(width, 160),
          height: Math.max(height, 100),
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

    // Use full parent height for SVG
    const svgHeight = dimensions.height;
    const innerWidth = dimensions.width - margin.left - margin.right;

    // Lay the legend out first: how many rows it needs decides how much bottom margin
    // the plot has to give up.
    const legend = showLegend ? layoutLegend(allDatasets, innerWidth) : { items: [], rows: 0 };
    const legendHeight = legend.rows > 0 ? legend.rows * LEGEND_ROW_HEIGHT + 6 : 0;

    // In a short panel the fixed margins eat the whole plot, so drop the axis titles and
    // the padding they need rather than squeezing the plot down to nothing.
    const compact = svgHeight < 240;

    const adjustedMargin = {
      ...margin,
      top: compact ? 12 : margin.top,
      bottom: (compact ? 24 : margin.bottom) + legendHeight,
    };
    const innerHeight = svgHeight - adjustedMargin.top - adjustedMargin.bottom;

    if (innerWidth <= 0 || innerHeight <= 0) return;

    // Collect all x and y values from all datasets
    const allXValues = [];
    const allYValues = [];
    const allYMinValues = [];
    const allYMaxValues = [];

    allDatasets.forEach(dataset => {
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
      .call(d3.axisBottom(xScale).ticks(compact ? 5 : 10));

    g.append("g").call(d3.axisLeft(yScale).ticks(compact ? 4 : 10));

    // Add labels
    if (!compact) {
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
    }

    // Add legend for datasets
    if (legend.items.length > 0) {
      const legendRoot = svg.append("g")
        .attr("transform", `translate(${adjustedMargin.left}, ${svgHeight - legendHeight})`);

      legend.items.forEach((item, index) => {
        const legendGroup = legendRoot.append("g")
          .attr("transform", `translate(${item.x}, ${item.row * LEGEND_ROW_HEIGHT})`);

        const datasetColor = allDatasets[index].lineColor || colorScale(index);

        legendGroup.append("line")
          .attr("x1", 0)
          .attr("x2", LEGEND_SWATCH_WIDTH)
          .attr("y1", 8)
          .attr("y2", 8)
          .attr("stroke", datasetColor)
          .attr("stroke-width", 2);

        legendGroup.append("text")
          .attr("x", LEGEND_LABEL_OFFSET)
          .attr("y", 8)
          .attr("dy", "0.35em")
          .attr("font-size", 10)
          .text(item.label);
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
